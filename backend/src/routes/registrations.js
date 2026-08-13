import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";

// Mounted at /api/events (distinct paths from the CRUD router) + /api/registrations.
export const eventRegsRouter = Router();
eventRegsRouter.use(requireAuth);

eventRegsRouter.get("/:id/registrations", requirePerm("events", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT r.*, l.company, l."contactName", l.phone
       FROM event_registrations r JOIN leads l ON l.id = r."leadId"
       WHERE r."eventId" = $1 ORDER BY r."createdAt" DESC`, [req.params.id]));
  } catch (e) { next(e); }
});

eventRegsRouter.post("/:id/registrations", requirePerm("events"), async (req, res, next) => {
  try {
    if (!(await get(`SELECT 1 FROM leads WHERE id = $1`, [req.body?.leadId]))) return res.status(400).json({ error: "Unknown lead" });
    if (await get(`SELECT 1 FROM event_registrations WHERE "eventId" = $1 AND "leadId" = $2`, [req.params.id, req.body.leadId])) {
      return res.status(409).json({ error: "Already registered" });
    }
    const row = await get(
      `INSERT INTO event_registrations ("eventId", "leadId", source) VALUES ($1,$2,'MANUAL') RETURNING *`,
      [req.params.id, req.body.leadId]);
    logAudit(req, "events.register", "event_registrations", row.id);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

export const regsRouter = Router();
regsRouter.use(requireAuth);
regsRouter.patch("/:id/checkin", requirePerm("events"), async (req, res, next) => {
  try {
    await run(`UPDATE event_registrations SET status = 'ATTENDED', "checkedInAt" = now() WHERE id = $1`, [req.params.id]);
    const row = await get(`SELECT * FROM event_registrations WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    logAudit(req, "events.checkin", "event_registrations", req.params.id);
    res.json(row);
  } catch (e) { next(e); }
});
