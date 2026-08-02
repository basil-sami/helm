import { Router } from "express";
import { all } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { buildPanel, readiness, fitModel } from "../mmm.js";

// ═══ MMM ROUTES (Wave 3·G) ═══════════════════════════════════════════

export const mmmRouter = Router();
mmmRouter.use(requireAuth);

// The readiness panel is the honest headline: how far from a model you can trust.
mmmRouter.get("/readiness", requirePerm("analytics", "read"), async (req, res, next) => {
  try { res.json(await readiness({ outcomeKey: req.query.outcomeKey || "leads_new_30d" })); }
  catch (e) { next(e); }
});

mmmRouter.post("/panel", requirePerm("analytics"), async (req, res, next) => {
  try {
    const out = await buildPanel({ outcomeKey: req.body?.outcomeKey || "leads_new_30d" });
    if (!out.ok) return res.status(200).json(out);
    logAudit(req, "mmm.panel", "mmm_weeks", null, { weeks: out.weeks });
    res.json(out);
  } catch (e) { next(e); }
});

mmmRouter.post("/fit", requirePerm("analytics"), async (req, res, next) => {
  try {
    const out = await fitModel({
      outcomeKey: req.body?.outcomeKey || "leads_new_30d",
      decay: Math.min(0.9, Math.max(0, Number(req.body?.decay ?? 0.4))),
      userId: req.user.id,
    });
    if (!out.ok) return res.status(200).json(out);
    logAudit(req, "mmm.fit", "mmm_runs", out.id, { directional: out.directional });
    res.status(201).json(out);
  } catch (e) { next(e); }
});

mmmRouter.get("/runs", requirePerm("analytics", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT r.id, r."outcomeKey", r.weeks, r."aboveFloor", r.diagnostics, r.contributions,
              r."createdAt", u.name AS "runByName"
       FROM mmm_runs r LEFT JOIN users u ON u.id = r."runById"
       ORDER BY r."createdAt" DESC LIMIT 20`));
  } catch (e) { next(e); }
});

mmmRouter.get("/weeks", requirePerm("analytics", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT "weekStart", outcome, spend, controls, completeness FROM mmm_weeks
       WHERE "outcomeKey" = $1 ORDER BY "weekStart" DESC LIMIT 160`,
      [req.query.outcomeKey || "leads_new_30d"]));
  } catch (e) { next(e); }
});
