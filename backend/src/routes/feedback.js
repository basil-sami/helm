import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth, requirePerm("leads", "read"));

feedbackRouter.get("/", async (_req, res, next) => {
  try {
    const [items, avg] = await Promise.all([
      all(`SELECT f.*, c.company FROM feedback f LEFT JOIN customers c ON c.id = f."customerId"
           ORDER BY f."createdAt" DESC LIMIT 100`),
      get(`SELECT AVG(score)::float8 AS avg, COUNT(*)::int AS n FROM feedback`),
    ]);
    res.json({ avg: avg?.avg ? Math.round(avg.avg * 10) / 10 : null, count: avg?.n || 0, items });
  } catch { res.json({ avg: null, count: 0, items: [] }); }
});
