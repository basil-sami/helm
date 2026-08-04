import { Router } from "express";
import { crudRouter } from "../crud.js";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";
import { computeMetric, paceFor, CATALOG } from "../metrics-engine.js";
import { runDailyPulse, bootAnalytics } from "../dailypulse.js";

// ── ANALYTICS CORE (Wave 1·C) — routes on the measurement brain ──────
// Governance: everyone with `analytics: read` sees everything; writes
// (targets, alerts, dashboards, catalog edits, report runs) are admin
// via the module's write level — which only the admin bypass grants.

const jsonFix = (...keys) => async (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};
const parseJ = (v, fb) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? fb); } catch { return fb; } };
let booted = null;
const ensureBoot = () => (booted ||= bootAnalytics());

// ── The catalog ──────────────────────────────────────────────────────
export const metricsRouter = Router();
metricsRouter.use(requireAuth, async (_req, _res, next) => { await ensureBoot(); next(); });

metricsRouter.get("/", requirePerm("analytics", "read"), async (_req, res, next) => {
  try {
    res.json(await all(`SELECT * FROM metrics ORDER BY category, key`));
  } catch (e) { next(e); }
});

metricsRouter.get("/:key/value", requirePerm("analytics", "read"), async (req, res, next) => {
  try {
    const row = await get(`SELECT key FROM metrics WHERE key = $1`, [req.params.key]);
    if (!row) return res.status(404).json({ error: "Unknown metric" });
    res.json(await computeMetric(req.params.key));
  } catch (e) { next(e); }
});

metricsRouter.get("/:key/series", requirePerm("analytics", "read"), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 90, 400);
    res.json(await all(
      `SELECT date, value FROM metric_snapshots
       WHERE "metricKey" = $1 AND dims = '{}'::jsonb AND date >= CURRENT_DATE - $2::int
       ORDER BY date ASC`, [req.params.key, days]));
  } catch (e) { next(e); }
});

metricsRouter.get("/:key/slices", requirePerm("analytics", "read"), async (req, res, next) => {
  try {
    // W4·A: a metric may now carry more than one dimension (leads slice by
    // source AND by campaign), so callers filter with ?dim=. Without it the
    // endpoint returns every slice, which is what it always did.
    const dimName = typeof req.query.dim === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(req.query.dim)
      ? req.query.dim : null;
    const where = dimName ? `AND dims ? $3` : "";
    const latest = await get(
      `SELECT MAX(date) AS d FROM metric_snapshots WHERE "metricKey" = $1 AND dims <> '{}'::jsonb
        ${dimName ? "AND dims ? $2" : ""}`,
      dimName ? [req.params.key, dimName] : [req.params.key]);
    if (!latest?.d) return res.json([]);
    res.json(await all(
      `SELECT dims, value FROM metric_snapshots WHERE "metricKey" = $1 AND dims <> '{}'::jsonb AND date = $2
       ${where} ORDER BY value DESC`,
      dimName ? [req.params.key, latest.d, dimName] : [req.params.key, latest.d]));
  } catch (e) { next(e); }
});

// Catalog edits (activate/deactivate, rename, tune composite weights).
metricsRouter.patch("/:key", requireAdmin, async (req, res, next) => {
  try {
    const allowed = ["name", "nameAr", "description", "descriptionAr", "active", "source"];
    const sets = [], vals = [];
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      vals.push(k === "source" && typeof req.body[k] === "object" ? JSON.stringify(req.body[k]) : req.body[k]);
      sets.push(`"${k}" = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(req.params.key);
    const row = await get(`UPDATE metrics SET ${sets.join(", ")} WHERE key = $${vals.length} RETURNING *`, vals);
    if (!row) return res.status(404).json({ error: "Unknown metric" });
    logAudit(req, "metrics.update", "metrics", row.key, { fields: sets.length });
    res.json(row);
  } catch (e) { next(e); }
});

// Manual trigger for the whole nightly heartbeat.
metricsRouter.post("/run-daily", requireAdmin, async (req, res, next) => {
  try {
    const out = await runDailyPulse();
    logAudit(req, "analytics.run_daily", "metric_snapshots", null, { snapshots: out.snapshots, alerts: out.alertsFired });
    res.json(out);
  } catch (e) { next(e); }
});

// ── Targets & pacing ─────────────────────────────────────────────────
export const targetsExtraRouter = Router();
targetsExtraRouter.use(requireAuth, requirePerm("analytics", "read"));
targetsExtraRouter.get("/pacing", async (_req, res, next) => {
  try {
    const rows = await all(
      `SELECT t.*, m.name AS "metricName", m."nameAr" AS "metricNameAr", m.unit, m.direction
       FROM metric_targets t JOIN metrics m ON m.key = t."metricKey"
       WHERE t."periodEnd" >= CURRENT_DATE ORDER BY t."periodEnd" ASC`);
    res.json(await Promise.all(rows.map(async (t) => ({ ...t, ...(await paceFor(t)) }))));
  } catch (e) { next(e); }
});

export const targetsRouter = crudRouter({
  table: "metric_targets",
  module: "analytics",
  fields: ["metricKey", "dims", "periodStart", "periodEnd", "target", "ownerId"],
  listSql: `SELECT t.*, m.name AS "metricName", m."nameAr" AS "metricNameAr", m.unit
            FROM metric_targets t JOIN metrics m ON m.key = t."metricKey" ORDER BY t."periodEnd" DESC`,
  validateCreate: async (data) => {
    if (!(await get(`SELECT 1 FROM metrics WHERE key = $1`, [data.metricKey]))) return "Unknown metricKey";
    if (!data.periodStart || !data.periodEnd || data.periodEnd < data.periodStart) return "Invalid period";
    return jsonFix("dims")(data);
  },
  validateUpdate: jsonFix("dims"),
});

// ── Anomaly alerts ───────────────────────────────────────────────────
export const alertsRouter = crudRouter({
  table: "metric_alerts",
  module: "analytics",
  fields: ["metricKey", "dims", "condition", "threshold", "windowDays", "audience", "active"],
  listSql: `SELECT a.*, m.name AS "metricName", m."nameAr" AS "metricNameAr", m.unit
            FROM metric_alerts a JOIN metrics m ON m.key = a."metricKey" ORDER BY a."createdAt" DESC`,
  validateCreate: async (data) => {
    if (!(await get(`SELECT 1 FROM metrics WHERE key = $1`, [data.metricKey]))) return "Unknown metricKey";
    if (data.threshold === undefined || Number.isNaN(Number(data.threshold))) return "threshold is required";
    return jsonFix("dims", "audience")(data);
  },
  validateUpdate: jsonFix("dims", "audience"),
});

// ── Dashboards (role-aware defaults ship seeded) ─────────────────────
export const dashboardsEnsure = Router();
dashboardsEnsure.use(async (_req, _res, next) => { await ensureBoot(); next(); });
export const dashboardsRouter = crudRouter({
  table: "dashboards",
  module: "analytics",
  fields: ["name", "nameAr", "role", "widgets", "shared", "isDefault", "departmentId"],
  orderBy: `"isDefault" DESC, "createdAt" DESC`,
  validateCreate: jsonFix("widgets"),
  validateUpdate: jsonFix("widgets"),
});

// ── The reports engine: immutable snapshots from the catalog ─────────
const REPORT_TEMPLATES = {
  monthly_board: {
    name: "Monthly board pack", nameAr: "حزمة مجلس الإدارة الشهرية",
    keys: ["pulse_index", "pulse_demand", "pulse_engagement", "pulse_brand", "pulse_customer", "pulse_ops",
      "leads_new_30d", "pipeline_value", "won_value_30d", "win_rate_90d", "cpl_usd_30d", "romi_pct_90d",
      "form_submissions_30d", "form_cvr_pct_30d", "posts_published_30d", "er_pct_30d", "reach_30d",
      "mentions_30d", "sentiment_avg_30d", "nps_90d", "csat_avg_90d", "budget_utilization_pct"],
  },
};

async function valueAround(key, onOrBefore) {
  const r = await get(
    `SELECT value FROM metric_snapshots WHERE "metricKey" = $1 AND dims = '{}'::jsonb AND date <= $2
     ORDER BY date DESC LIMIT 1`, [key, onOrBefore]);
  return r ? Number(r.value) : null;
}

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.get("/templates", requirePerm("analytics", "read"), (_req, res) => {
  res.json(Object.entries(REPORT_TEMPLATES).map(([key, t]) => ({ key, name: t.name, nameAr: t.nameAr })));
});
reportsRouter.get("/", requirePerm("analytics", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT r.id, r."templateKey", r.period, r."generatedAt", u.name AS "generatedByName"
       FROM report_runs r LEFT JOIN users u ON u.id = r."generatedById" ORDER BY r."generatedAt" DESC LIMIT 50`));
  } catch (e) { next(e); }
});
reportsRouter.get("/:id", requirePerm("analytics", "read"), async (req, res, next) => {
  try {
    const r = await get(`SELECT * FROM report_runs WHERE id = $1`, [req.params.id]);
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  } catch (e) { next(e); }
});
reportsRouter.post("/run", requirePerm("analytics", "write"), async (req, res, next) => {
  try {
    await ensureBoot();
    const { templateKey = "monthly_board", period } = req.body || {};
    const tpl = REPORT_TEMPLATES[templateKey];
    if (!tpl) return res.status(400).json({ error: "Unknown templateKey" });
    if (!/^\d{4}-\d{2}$/.test(period || "")) return res.status(400).json({ error: "period must be YYYY-MM" });
    const [y, mo] = period.split("-").map(Number);
    const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);       // last day of month
    const prevEnd = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10); // last day of previous month
    const items = [];
    for (const key of tpl.keys) {
      const m = await get(`SELECT key, name, "nameAr", category, unit, direction FROM metrics WHERE key = $1`, [key]);
      if (!m) continue;
      let value = await valueAround(key, end);
      if (value === null) value = (await computeMetric(key)).value; // no history yet → live
      const prev = await valueAround(key, prevEnd);
      const deltaPct = prev === null || prev === 0 ? null : Math.round(((value - prev) / Math.abs(prev)) * 1000) / 10;
      items.push({ ...m, value, prev, deltaPct });
    }
    const snapshot = { template: { key: templateKey, ...tpl, keys: undefined }, period, end, items };
    const row = await get(
      `INSERT INTO report_runs ("templateKey", period, snapshot, "generatedById") VALUES ($1,$2,$3,$4) RETURNING *`,
      [templateKey, period, JSON.stringify(snapshot), req.user.id]);
    logAudit(req, "reports.run", "report_runs", row.id, { templateKey, period });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// ── Overview: the Pulse Index front door ─────────────────────────────
export const analyticsOverviewRouter = Router();
analyticsOverviewRouter.use(requireAuth, requirePerm("analytics", "read"));
analyticsOverviewRouter.get("/overview", async (_req, res, next) => {
  try {
    await ensureBoot();
    const pulse = await computeMetric("pulse_index");
    const areaMeta = await all(`SELECT key, name, "nameAr" FROM metrics WHERE category = 'PULSE' AND key <> 'pulse_index'`);
    const areas = [];
    for (const a of areaMeta) {
      const c = await computeMetric(a.key);
      areas.push({ key: a.key, name: a.name, nameAr: a.nameAr, value: c.value, components: c.components || [] });
    }
    // Top movers: latest snapshot vs ≥7 days earlier
    const movers = await all(
      `WITH latest AS (
         SELECT DISTINCT ON ("metricKey") "metricKey", date, value FROM metric_snapshots
         WHERE dims = '{}'::jsonb ORDER BY "metricKey", date DESC),
       prior AS (
         SELECT DISTINCT ON (s."metricKey") s."metricKey", s.value FROM metric_snapshots s
         JOIN latest l ON l."metricKey" = s."metricKey"
         WHERE s.dims = '{}'::jsonb AND s.date <= l.date - 7 ORDER BY s."metricKey", s.date DESC)
       SELECT m.key, m.name, m."nameAr", m.unit, m.direction, l.value AS current, p.value AS previous,
              ROUND(((l.value - p.value) / ABS(p.value) * 100)::numeric, 1)::float8 AS "deltaPct"
       FROM latest l JOIN prior p ON p."metricKey" = l."metricKey" AND p.value <> 0
       JOIN metrics m ON m.key = l."metricKey" AND m.category <> 'PULSE'
       ORDER BY ABS((l.value - p.value) / ABS(p.value)) DESC LIMIT 6`).catch(() => []);
    const alerts = await all(
      `SELECT a."metricKey", a.condition, a.threshold, a."lastFiredAt", m.name AS "metricName", m."nameAr" AS "metricNameAr"
       FROM metric_alerts a JOIN metrics m ON m.key = a."metricKey"
       WHERE a."lastFiredAt" >= now() - interval '7 days' ORDER BY a."lastFiredAt" DESC LIMIT 5`);
    res.json({ pulse: { value: pulse.value, components: pulse.components || [] }, areas, movers, alerts });
  } catch (e) { next(e); }
});

export { CATALOG };
