import { Router } from "express";
import QRCode from "qrcode";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";
import { calendarFeed, seasonalOccurrences, delegationError, effectiveApprovers, toHijri } from "../calendar.js";

// ═══ W4·D · CALENDAR, APPROVAL SLA, LINK BUILDER ══════════════════════

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

/** One feed for the whole month: work, campaigns, the publishing queue, the season. */
calendarRouter.get("/feed", requirePerm("content", "read"), async (req, res, next) => {
  try {
    const from = String(req.query.from || "").slice(0, 10);
    const to = String(req.query.to || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "from and to are required as YYYY-MM-DD" });
    }
    if (new Date(to) < new Date(from)) return res.status(400).json({ error: "`to` falls before `from`" });
    const days = (new Date(to) - new Date(from)) / 86400000;
    if (days > 400) return res.status(400).json({ error: "Window too wide (max ~13 months)" });
    res.json(await calendarFeed(from, to));
  } catch (e) { next(e); }
});

/** The seasonal layer alone — used by planning surfaces and the war room. */
calendarRouter.get("/seasonal", requirePerm("content", "read"), async (req, res, next) => {
  try {
    const from = String(req.query.from || new Date().toISOString().slice(0, 10));
    const to = String(req.query.to || `${new Date().getUTCFullYear() + 1}-12-31`);
    res.json(await seasonalOccurrences(from, to));
  } catch (e) { next(e); }
});

/** Dual-calendar helper so every surface converts identically. */
calendarRouter.get("/hijri", requirePerm("content", "read"), (req, res) => {
  const d = req.query.date ? new Date(String(req.query.date)) : new Date();
  if (isNaN(d)) return res.status(400).json({ error: "Invalid date" });
  res.json({ gregorian: d.toISOString().slice(0, 10), hijri: toHijri(d) });
});

// ── Seasonal packs: per instance, never hardcoded ────────────────────
export const seasonalRouter = Router();
seasonalRouter.use(requireAuth);

seasonalRouter.get("/", requirePerm("content", "read"), async (_req, res, next) => {
  try {
    const packs = await all(`SELECT * FROM seasonal_packs ORDER BY "createdAt"`);
    const events = await all(`SELECT * FROM seasonal_events ORDER BY month NULLS LAST, day NULLS LAST`);
    res.json(packs.map((p) => ({ ...p, events: events.filter((e) => e.packId === p.id) })));
  } catch (e) { next(e); }
});

seasonalRouter.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { key, name, nameAr, region } = req.body || {};
    if (!key || !name) return res.status(400).json({ error: "A pack needs a key and a name" });
    const row = await get(
      `INSERT INTO seasonal_packs (key, name, "nameAr", region) VALUES ($1,$2,$3,$4) RETURNING *`,
      [String(key).toLowerCase(), name, nameAr || null, region || null]);
    logAudit(req, "seasonal.packCreate", "seasonal_packs", row.id, { key });
    res.status(201).json(row);
  } catch (e) {
    if (String(e.message || "").includes("unique")) return res.status(409).json({ error: "That pack key already exists" });
    next(e);
  }
});

seasonalRouter.post("/:packId/events", requireAdmin, async (req, res, next) => {
  try {
    const pack = await get(`SELECT id FROM seasonal_packs WHERE id = $1`, [req.params.packId]);
    if (!pack) return res.status(404).json({ error: "Pack not found" });
    const d = req.body || {};
    if (!d.key || !d.name) return res.status(400).json({ error: "An event needs a key and a name" });
    const cal = d.calendar || "GREGORIAN";
    if (cal === "EXPLICIT" && !d.onDate) return res.status(400).json({ error: "An explicit event needs onDate" });
    if (cal !== "EXPLICIT" && (!d.month || !d.day)) return res.status(400).json({ error: `A ${cal} event needs month and day` });
    const row = await get(
      `INSERT INTO seasonal_events ("packId", key, name, "nameAr", kind, calendar, month, day, "onDate",
         "durationDays", "leadTimeDays", notes, "notesAr")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,1),COALESCE($11,14),$12,$13) RETURNING *`,
      [pack.id, d.key, d.name, d.nameAr || null, d.kind || "CULTURAL", cal, d.month || null, d.day || null,
       d.onDate || null, d.durationDays || null, d.leadTimeDays || null, d.notes || null, d.notesAr || null]);
    logAudit(req, "seasonal.eventCreate", "seasonal_events", row.id, { key: d.key });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

seasonalRouter.delete("/events/:id", requireAdmin, async (req, res, next) => {
  try {
    await run(`DELETE FROM seasonal_events WHERE id = $1`, [req.params.id]);
    logAudit(req, "seasonal.eventDelete", "seasonal_events", req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Approval delegation ──────────────────────────────────────────────
export const delegationRouter = Router();
delegationRouter.use(requireAuth);

delegationRouter.get("/", requirePerm("campaigns", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT d.*, a.name AS "approverName", g.name AS "delegateName"
         FROM approval_delegations d
         JOIN users a ON a.id = d."approverId"
         JOIN users g ON g.id = d."delegateId"
        ORDER BY d."fromDate" DESC LIMIT 100`));
  } catch (e) { next(e); }
});

delegationRouter.post("/", requirePerm("campaigns", "write"), async (req, res, next) => {
  try {
    const d = req.body || {};
    // A non-admin may only delegate their own approvals — otherwise the
    // feature is a way to hand yourself someone else's authority.
    if (!req.user.isAdmin && d.approverId && d.approverId !== req.user.id) {
      return res.status(403).json({ error: "You may only delegate your own approvals" });
    }
    const payload = { ...d, approverId: d.approverId || req.user.id };
    const err = await delegationError(payload);
    if (err) return res.status(400).json({ error: err });
    const row = await get(
      `INSERT INTO approval_delegations ("approverId","delegateId","fromDate","toDate",reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [payload.approverId, payload.delegateId, payload.fromDate, payload.toDate, payload.reason || null]);
    logAudit(req, "approvals.delegate", "approval_delegations", row.id, { to: payload.delegateId });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

delegationRouter.delete("/:id", requirePerm("campaigns", "write"), async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM approval_delegations WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Delegation not found" });
    if (!req.user.isAdmin && row.approverId !== req.user.id) {
      return res.status(403).json({ error: "You may only revoke your own delegations" });
    }
    await run(`UPDATE approval_delegations SET active = false WHERE id = $1`, [req.params.id]);
    logAudit(req, "approvals.undelegate", "approval_delegations", req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Who can decide for me, or I for them, today. */
delegationRouter.get("/mine", async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [givenAway, actingFor] = await Promise.all([
      all(`SELECT d.*, u.name AS "delegateName" FROM approval_delegations d JOIN users u ON u.id = d."delegateId"
            WHERE d."approverId" = $1 AND d.active = true AND d."toDate" >= $2`, [req.user.id, today]),
      all(`SELECT d.*, u.name AS "approverName" FROM approval_delegations d JOIN users u ON u.id = d."approverId"
            WHERE d."delegateId" = $1 AND d.active = true AND d."fromDate" <= $2 AND d."toDate" >= $2`, [req.user.id, today]),
    ]);
    res.json({ givenAway, actingFor });
  } catch (e) { next(e); }
});

// ── The link builder ─────────────────────────────────────────────────
// QR generation already existed, bound to media placements. This gives
// the same capability to any tracked link, plus UTM composition — which
// is what turns a shortener into attribution.
export const linkBuilderRouter = Router();
linkBuilderRouter.use(requireAuth);

const shortUrl = (req, code) => {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/$/, "")}/r/${code}`;
};

export function withUtm(url, utm = {}) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const map = { source: "utm_source", medium: "utm_medium", campaign: "utm_campaign", content: "utm_content", term: "utm_term" };
  for (const [k, param] of Object.entries(map)) {
    const v = utm[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") u.searchParams.set(param, String(v).trim());
  }
  return u.toString();
}

/** Compose a destination with UTM parameters without saving anything. */
linkBuilderRouter.post("/compose", requirePerm("campaigns", "read"), async (req, res, next) => {
  try {
    const { url, utm } = req.body || {};
    const composed = withUtm(url || "", utm || {});
    if (!composed) return res.status(400).json({ error: "A valid destination URL is required" });
    res.json({ url: composed });
  } catch (e) { next(e); }
});

/** The QR for any tracked link — the fair-day artefact. */
linkBuilderRouter.get("/:id/qr", requirePerm("campaigns", "read"), async (req, res, next) => {
  try {
    const link = await get(`SELECT * FROM tracked_links WHERE id = $1`, [req.params.id]);
    if (!link) return res.status(404).json({ error: "Link not found" });
    const url = shortUrl(req, link.code);
    const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1, color: { dark: "#1b1b1f", light: "#faf7f0" } });
    res.json({ code: link.code, url, dataUrl });
  } catch (e) { next(e); }
});

/** Presets the UI offers, so UTM naming stays consistent across a team. */
linkBuilderRouter.get("/presets", requirePerm("campaigns", "read"), async (_req, res, next) => {
  try {
    const campaigns = await all(
      `SELECT id, name FROM campaigns WHERE status IN ('PLANNING','ACTIVE','PAUSED') ORDER BY "createdAt" DESC LIMIT 50`);
    res.json({
      sources: ["facebook", "instagram", "whatsapp", "tiktok", "google", "email", "print", "event", "referral"],
      mediums: ["social", "cpc", "message", "qr", "organic", "email", "offline"],
      campaigns: campaigns.map((c) => ({ id: c.id, utm: String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })),
    });
  } catch (e) { next(e); }
});
