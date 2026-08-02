import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";
import { aiStatus } from "../ai.js";

// ═══ AI ROUTES (Wave 3·C) ════════════════════════════════════════════
// Everything here produces a draft. Nothing here commits one.

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get("/status", requireAdmin, async (_req, res, next) => {
  try { res.json(await aiStatus()); } catch (e) { next(e); }
});

aiRouter.post("/explain/:alertId", requirePerm("analytics"), async (req, res, next) => {
  try {
    const { explainAnomaly } = await import("../ai-features.js");
    const out = await explainAnomaly(req.params.alertId, { userId: req.user.id });
    if (!out.ok) return res.status(out.abstained ? 200 : 400).json(out);
    logAudit(req, "ai.explain", "insights", out.insight.id, { alertId: req.params.alertId });
    res.status(201).json(out);
  } catch (e) { next(e); }
});

aiRouter.post("/brief/:requestId", requirePerm("studio"), async (req, res, next) => {
  try {
    const { draftBrief } = await import("../ai-features.js");
    const out = await draftBrief(req.params.requestId);
    if (!out.ok) return res.status(out.abstained ? 200 : 400).json(out);
    logAudit(req, "ai.brief", "creative_briefs", out.brief?.id || null, null);
    res.status(201).json(out);
  } catch (e) { next(e); }
});

// Drafts waiting on a person — the disposal half of "AI drafts, humans dispose".
aiRouter.get("/drafts", requirePerm("analytics", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT i.*, m.name AS "alertLabel" FROM insights i
       LEFT JOIN metric_alerts a ON a.id = i."alertId"
       LEFT JOIN metrics m ON m.key = a."metricKey"
       WHERE i.status = 'DRAFT' ORDER BY i."createdAt" DESC LIMIT 50`));
  } catch (e) { next(e); }
});

aiRouter.post("/drafts/:id/decide", requirePerm("analytics"), async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["PUBLISHED", "DISMISSED"].includes(status)) {
      return res.status(400).json({ error: "status must be PUBLISHED or DISMISSED" });
    }
    const row = await get(`SELECT * FROM insights WHERE id = $1 AND status = 'DRAFT'`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    await run(`UPDATE insights SET status = $2 WHERE id = $1`, [row.id, status]);
    logAudit(req, "ai.draft.decide", "insights", row.id, { status });
    res.json(await get(`SELECT * FROM insights WHERE id = $1`, [row.id]));
  } catch (e) { next(e); }
});
