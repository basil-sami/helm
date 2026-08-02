import { Router } from "express";
import { all } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { forecastMetric, targetArrival, budgetScenario, backtestAccuracy } from "../forecast.js";

// ═══ FORECAST ROUTES (Wave 3·F) ══════════════════════════════════════
// Nothing here is stored. A forecast is a view of the data, not a fact
// about it — so it is recomputed, never cached into a table someone
// later mistakes for a record.

export const forecastRouter = Router();
forecastRouter.use(requireAuth);

forecastRouter.get("/metric/:key", requirePerm("analytics", "read"), async (req, res, next) => {
  try {
    res.json(await forecastMetric(req.params.key, {
      horizon: Math.min(Number(req.query.horizon) || 14, 60),
      days: Math.min(Number(req.query.days) || 90, 365),
    }));
  } catch (e) { next(e); }
});

forecastRouter.get("/targets", requirePerm("analytics", "read"), async (_req, res, next) => {
  try {
    const targets = await all(
      `SELECT id FROM metric_targets WHERE "periodEnd" >= CURRENT_DATE ORDER BY "periodEnd" LIMIT 20`);
    const out = [];
    for (const t of targets) out.push(await targetArrival(t.id));
    res.json(out);
  } catch (e) { next(e); }
});

forecastRouter.get("/targets/:id", requirePerm("analytics", "read"), async (req, res, next) => {
  try { res.json(await targetArrival(req.params.id)); } catch (e) { next(e); }
});

forecastRouter.get("/scenario-seed", requirePerm("analytics", "read"), async (_req, res, next) => {
  try {
    const { budgetScenario } = await import("../forecast.js");
    res.json(await budgetScenario({ shifts: [] }));
  } catch (e) { next(e); }
});

forecastRouter.post("/scenario", requirePerm("analytics"), async (req, res, next) => {
  try {
    const { shifts } = req.body || {};
    if (!Array.isArray(shifts) || !shifts.length) {
      return res.status(400).json({ error: "shifts must be a non-empty array of { from, to, pct | amountUsd }" });
    }
    res.json(await budgetScenario({ shifts, days: Math.min(Number(req.body.days) || 90, 365) }));
  } catch (e) { next(e); }
});

forecastRouter.get("/accuracy/:key", requirePerm("analytics", "read"), async (req, res, next) => {
  try { res.json(await backtestAccuracy(req.params.key)); } catch (e) { next(e); }
});
