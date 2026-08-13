import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";

export const planningRouter = Router();
planningRouter.use(requireAuth);

const METRICS = ["PIPELINE_USD", "WON_USD", "LEADS_COUNT", "WON_COUNT", "CONTENT_PUBLISHED", "SPEND_USD", "CUSTOM"];

// Live "current" value for an objective, within its date window where given.
async function currentFor(o) {
  const a = [];
  const win = (col) => {
    let c = "";
    if (o.startDate) { a.push(o.startDate); c += ` AND ${col} >= $${a.length}`; }
    if (o.endDate) { a.push(o.endDate); c += ` AND ${col} <= $${a.length}`; }
    return c;
  };
  let row;
  switch (o.metric) {
    case "PIPELINE_USD":
      row = await get(`SELECT COALESCE(SUM("valueUsd"),0)::float8 v FROM leads WHERE stage NOT IN ('WON','LOST')${win('"createdAt"')}`, a); break;
    case "WON_USD":
      row = await get(`SELECT COALESCE(SUM("valueUsd"),0)::float8 v FROM leads WHERE stage='WON'${win('"updatedAt"')}`, a); break;
    case "LEADS_COUNT":
      row = await get(`SELECT COUNT(*)::float8 v FROM leads WHERE 1=1${win('"createdAt"')}`, a); break;
    case "WON_COUNT":
      row = await get(`SELECT COUNT(*)::float8 v FROM leads WHERE stage='WON'${win('"updatedAt"')}`, a); break;
    case "CONTENT_PUBLISHED":
      row = await get(`SELECT COUNT(*)::float8 v FROM content_items WHERE status='PUBLISHED'${win('"createdAt"')}`, a); break;
    case "SPEND_USD":
      row = await get(`SELECT COALESCE(SUM("amountUsd"),0)::float8 v FROM budget_entries WHERE kind='SPENT'${win('COALESCE(date,"createdAt")')}`, a); break;
    default:
      return Number(o.manualCurrent) || 0;
  }
  return row.v;
}

// Pace = progress vs time elapsed in the window.
function pace(progress, start, end) {
  if (progress >= 1) return "achieved";
  if (!start || !end) return progress >= 0.5 ? "on_track" : "at_risk";
  const now = Date.now(), s = new Date(start).getTime(), e = new Date(end).getTime();
  const elapsed = e > s ? Math.min(1, Math.max(0, (now - s) / (e - s))) : 1;
  if (progress >= elapsed * 0.85) return "on_track";
  if (progress >= elapsed * 0.6) return "at_risk";
  return "off_track";
}

export async function objectivesWithProgress() {
  const rows = await all(`SELECT o.*, u.name AS "ownerName"
    FROM objectives o LEFT JOIN users u ON u.id = o."ownerId"
    WHERE o.status <> 'ARCHIVED' ORDER BY o."endDate" NULLS LAST, o."createdAt" DESC`);
  const out = [];
  for (const o of rows) {
    const current = await currentFor(o);
    const target = Number(o.targetValue) || 0;
    const progress = target > 0 ? current / target : 0;
    out.push({ ...o, current, progress: Math.round(progress * 1000) / 1000, pace: pace(progress, o.startDate, o.endDate) });
  }
  return out;
}

planningRouter.get("/objectives", requirePerm("planning", "read"), async (_req, res, next) => {
  try { res.json(await objectivesWithProgress()); } catch (e) { next(e); }
});

planningRouter.post("/objectives", requirePerm("planning"), async (req, res, next) => {
  const { label, labelAr, metric, targetValue, manualCurrent, startDate, endDate, businessUnit, ownerId } = req.body;
  if (!label) return res.status(400).json({ error: "label is required" });
  if (metric && !METRICS.includes(metric)) return res.status(400).json({ error: "Invalid metric" });
  try {
    const row = await get(
      `INSERT INTO objectives (label, "labelAr", metric, "targetValue", "manualCurrent", "startDate", "endDate", "businessUnit", "ownerId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [label, labelAr || null, metric || "CUSTOM", Number(targetValue) || 0, Number(manualCurrent) || 0,
       startDate || null, endDate || null, businessUnit || null, ownerId || null]
    );
    res.status(201).json(row);
  } catch (e) { next(e); }
});

planningRouter.patch("/objectives/:id", requirePerm("planning"), async (req, res, next) => {
  const sets = [], params = [];
  const push = (col, val) => { params.push(val); sets.push(`"${col}" = $${params.length}`); };
  for (const f of ["label", "labelAr", "metric", "targetValue", "manualCurrent", "startDate", "endDate", "businessUnit", "ownerId", "status"]) {
    if (req.body[f] !== undefined) push(f, req.body[f] === "" ? null : req.body[f]);
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields" });
  try {
    params.push(req.params.id);
    await run(`UPDATE objectives SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    res.json(await get("SELECT * FROM objectives WHERE id = $1", [req.params.id]));
  } catch (e) { next(e); }
});

planningRouter.delete("/objectives/:id", requirePerm("planning"), async (req, res, next) => {
  try { await run("DELETE FROM objectives WHERE id = $1", [req.params.id]); res.status(204).end(); }
  catch (e) { next(e); }
});
