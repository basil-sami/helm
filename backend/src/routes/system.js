import { Router } from "express";
import express from "express";
import { all, get } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { rateLimit } from "../security.js";
import { errorSummary, healthReport, recordError, RETAIN_DAYS } from "../observability.js";

// ═══ SYSTEM (Wave 3·A) ═══════════════════════════════════════════════
// One place an admin can answer "is it healthy, and what broke?" without
// shell access to the host.

export const systemRouter = Router();
systemRouter.use(requireAuth, requireAdmin);

systemRouter.get("/health", async (_req, res, next) => {
  try { res.json(await healthReport()); } catch (e) { next(e); }
});

systemRouter.get("/errors", async (req, res, next) => {
  try {
    res.json({
      retainDays: RETAIN_DAYS,
      groups: await errorSummary({ days: Number(req.query.days) || 7 }),
    });
  } catch (e) { next(e); }
});

// One fault group, expanded — the individual occurrences behind the count.
systemRouter.get("/errors/:fingerprint", async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT e.at, e.level, e.route, e.method, e.status, e.message, e.stack,
              e."requestId", e."userAgent", e."payloadDigest", u.name AS "userName"
       FROM error_log e LEFT JOIN users u ON u.id = e."userId"
       WHERE e.fingerprint = $1 ORDER BY e.at DESC LIMIT 20`, [req.params.fingerprint]));
  } catch (e) { next(e); }
});

// The scattered feeds, gathered: connectors, mail, AI-to-come, all in one view.
systemRouter.get("/activity", async (_req, res, next) => {
  try {
    const [runs, mail, digests] = await Promise.all([
      all(`SELECT platform, kind, status, detail, at FROM integration_runs ORDER BY at DESC LIMIT 15`).catch(() => []),
      all(`SELECT "to", subject, status, error, "createdAt" AS at FROM mail_log ORDER BY "createdAt" DESC LIMIT 15`).catch(() => []),
      all(`SELECT channel, status, "createdAt" AS at FROM digest_log ORDER BY "createdAt" DESC LIMIT 10`).catch(() => []),
    ]);
    res.json({ integrations: runs, mail, digests });
  } catch (e) { next(e); }
});

// ── the browser fault beacon ─────────────────────────────────────────
// Half of "it's broken" is a render error the server never saw. Public by
// necessity, so it is rate-limited hard and stores nothing it is handed
// beyond a message and a location.
export const clientErrorRouter = Router();
const beaconLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, message: "Too many reports" });

clientErrorRouter.post("/", beaconLimit, express.json({ limit: "16kb" }), async (req, res) => {
  const { message, route, stack } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required" });
  await recordError({
    level: "CLIENT",
    route: route ? String(route).slice(0, 200) : null,
    method: "CLIENT",
    status: 0,
    message: String(message).slice(0, 300),
    stack: stack ? String(stack).slice(0, 2000) : null,
    requestId: req.requestId,
    userAgent: req.headers["user-agent"],
  });
  res.status(204).end();
});
