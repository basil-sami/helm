import { Router } from "express";
import { all } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireAdmin);

auditRouter.get("/", async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  try {
    res.json(await all(
      `SELECT id, "actorName", action, entity, "entityId", meta, "createdAt"
       FROM audit_log ORDER BY "createdAt" DESC LIMIT $1`, [limit]));
  } catch (e) { next(e); }
});
