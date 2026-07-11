import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth } from "../auth.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 50);
  try {
    const [items, unread] = await Promise.all([
      all(`SELECT id, type, meta, link, "readAt", "createdAt" FROM notifications
           WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT $2`, [req.user.id, limit]),
      get(`SELECT COUNT(*)::int AS n FROM notifications WHERE "userId" = $1 AND "readAt" IS NULL`, [req.user.id]),
    ]);
    res.json({ unread: unread?.n || 0, items });
  } catch (e) {
    // Pre-migration DB: behave as an empty inbox rather than a broken bell.
    res.json({ unread: 0, items: [] });
  }
});

notificationsRouter.patch("/read-all", async (req, res, next) => {
  try {
    await run(`UPDATE notifications SET "readAt" = now() WHERE "userId" = $1 AND "readAt" IS NULL`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

notificationsRouter.patch("/:id/read", async (req, res, next) => {
  try {
    await run(`UPDATE notifications SET "readAt" = now() WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
