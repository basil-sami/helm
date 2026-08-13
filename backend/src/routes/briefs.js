import { Router } from "express";
import { get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";

export const briefsRouter = Router();
briefsRouter.use(requireAuth);

briefsRouter.get("/:campaignId", requirePerm("campaigns", "read"), async (req, res, next) => {
  try {
    res.json(await get(
      `SELECT b.*, p.name AS "personaName", pr.name AS "productName"
       FROM campaign_briefs b
       LEFT JOIN personas p ON p.id = b."personaId"
       LEFT JOIN products pr ON pr.id = b."productId"
       WHERE b."campaignId" = $1`, [req.params.campaignId]) || null);
  } catch (e) { next(e); }
});

// Upsert (one brief per campaign). Close-out = sending learnings (+closedAt).
briefsRouter.post("/:campaignId", requirePerm("campaigns"), async (req, res, next) => {
  const b = req.body || {};
  try {
    if (!(await get(`SELECT 1 FROM campaigns WHERE id = $1`, [req.params.campaignId]))) return res.status(404).json({ error: "Campaign not found" });
    const row = await get(
      `INSERT INTO campaign_briefs ("campaignId", objective, "personaId", "productId", "keyMessage", "keyMessageAr", offer, "kpiMetric", "kpiTarget", channels, learnings, "closedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT ("campaignId") DO UPDATE SET
         objective = EXCLUDED.objective, "personaId" = EXCLUDED."personaId", "productId" = EXCLUDED."productId",
         "keyMessage" = EXCLUDED."keyMessage", "keyMessageAr" = EXCLUDED."keyMessageAr", offer = EXCLUDED.offer,
         "kpiMetric" = EXCLUDED."kpiMetric", "kpiTarget" = EXCLUDED."kpiTarget", channels = EXCLUDED.channels,
         learnings = COALESCE(EXCLUDED.learnings, campaign_briefs.learnings),
         "closedAt" = COALESCE(EXCLUDED."closedAt", campaign_briefs."closedAt")
       RETURNING *`,
      [req.params.campaignId, b.objective || null, b.personaId || null, b.productId || null,
       b.keyMessage || null, b.keyMessageAr || null, b.offer || null, b.kpiMetric || null, b.kpiTarget ?? null,
       JSON.stringify(Array.isArray(b.channels) ? b.channels : []),
       b.learnings || null, b.learnings ? new Date().toISOString() : null]
    );
    logAudit(req, "briefs.upsert", "campaign_briefs", row.id, { campaignId: req.params.campaignId });
    res.status(201).json(row);
  } catch (e) { next(e); }
});
