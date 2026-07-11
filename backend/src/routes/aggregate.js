import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (_req, res, next) => {
  try {
    const num = (v) => Number(v || 0);
    const [
      activeCampaigns, totalCampaigns, openTasks,
      upcomingEvents, contentDue, spent, planned, byChannel,
      byStage, won, openPipe, setting,
    ] = await Promise.all([
      get("SELECT COUNT(*)::int AS n FROM campaigns WHERE status = 'ACTIVE'"),
      get("SELECT COUNT(*)::int AS n FROM campaigns"),
      get("SELECT COUNT(*)::int AS n FROM tasks WHERE status <> 'DONE'"),
      all(`SELECT e.*, u.name AS "ownerName" FROM events e LEFT JOIN users u ON u.id = e."ownerId"
           WHERE e.status IN ('PLANNED','CONFIRMED','RUNNING') ORDER BY e."startDate" ASC NULLS LAST LIMIT 5`),
      all(`SELECT ci.*, c.name AS "campaignName" FROM content_items ci LEFT JOIN campaigns c ON c.id = ci."campaignId"
           WHERE ci.status IN ('IDEA','IN_PROGRESS','REVIEW') ORDER BY ci."scheduledAt" ASC NULLS LAST LIMIT 6`),
      get(`SELECT COALESCE(SUM("amountUsd"),0) AS usd, COALESCE(SUM("amountSdg"),0) AS sdg FROM budget_entries WHERE kind = 'SPENT'`),
      get(`SELECT COALESCE(SUM("amountUsd"),0) AS usd, COALESCE(SUM("amountSdg"),0) AS sdg FROM budget_entries WHERE kind = 'PLANNED'`),
      all(`SELECT channel, COALESCE(SUM("amountUsd"),0) AS usd, COALESCE(SUM("amountSdg"),0) AS sdg
           FROM budget_entries WHERE kind = 'SPENT' GROUP BY channel ORDER BY usd DESC`),
      all(`SELECT stage, COUNT(*)::int AS count, COALESCE(SUM("valueUsd"),0) AS usd, COALESCE(SUM("valueSdg"),0) AS sdg
           FROM leads GROUP BY stage`),
      get(`SELECT COALESCE(SUM("valueUsd"),0) AS usd, COALESCE(SUM("valueSdg"),0) AS sdg FROM leads WHERE stage = 'WON'`),
      get(`SELECT COALESCE(SUM("valueUsd"),0) AS usd, COALESCE(SUM("valueSdg"),0) AS sdg
           FROM leads WHERE stage IN ('NEW','QUALIFIED','PROPOSAL','NEGOTIATION')`),
      get("SELECT * FROM settings WHERE id = 1"),
    ]);

    res.json({
      kpis: {
        activeCampaigns: activeCampaigns.n, totalCampaigns: totalCampaigns.n,
        openTasks: openTasks.n, upcomingEventCount: upcomingEvents.length,
      },
      budget: {
        spentUsd: num(spent.usd), spentSdg: num(spent.sdg),
        plannedUsd: num(planned.usd), plannedSdg: num(planned.sdg),
        byChannel: byChannel.map((r) => ({ channel: r.channel, usd: num(r.usd), sdg: num(r.sdg) })),
      },
      pipeline: {
        byStage: byStage.map((r) => ({ stage: r.stage, count: r.count, usd: num(r.usd), sdg: num(r.sdg) })),
        wonUsd: num(won.usd), wonSdg: num(won.sdg), openUsd: num(openPipe.usd), openSdg: num(openPipe.sdg),
      },
      upcomingEvents, contentDue,
      setting: { ...(setting || {}), usdToSdgRate: num(setting?.usdToSdgRate) },
    });
  } catch (e) { next(e); }
});

export const settingsRouter = Router();
settingsRouter.use(requireAuth);
settingsRouter.get("/", async (_req, res, next) => {
  try { res.json(await get("SELECT * FROM settings WHERE id = 1")); } catch (e) { next(e); }
});
settingsRouter.patch("/", requireAdmin, async (req, res, next) => {
  const sets = [], params = [];
  if (req.body.usdToSdgRate !== undefined) { params.push(Number(req.body.usdToSdgRate)); sets.push(`"usdToSdgRate" = $${params.length}`); }
  if (req.body.orgName !== undefined) { params.push(req.body.orgName); sets.push(`"orgName" = $${params.length}`); }
  if (req.body.orgNameAr !== undefined) { params.push(req.body.orgNameAr); sets.push(`"orgNameAr" = $${params.length}`); }
  if (req.body.staleLeadDays !== undefined) { params.push(Math.max(1, parseInt(req.body.staleLeadDays, 10) || 3)); sets.push(`"staleLeadDays" = $${params.length}`); }
  if (req.body.customerReviewDays !== undefined) { params.push(Math.max(7, parseInt(req.body.customerReviewDays, 10) || 90)); sets.push(`"customerReviewDays" = $${params.length}`); }
  try {
    if (sets.length) await run(`UPDATE settings SET ${sets.join(", ")} WHERE id = 1`, params);
    logAudit(req, "settings.update", "settings");
    res.json(await get("SELECT * FROM settings WHERE id = 1"));
  } catch (e) { next(e); }
});
