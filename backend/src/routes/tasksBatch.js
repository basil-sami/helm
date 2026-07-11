import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { notify } from "../notify.js";
import { logAudit } from "../audit.js";
import { logActivity } from "../leadlog.js";

export const tasksBatchRouter = Router();
tasksBatchRouter.use(requireAuth);

const PRIO = ["LOW", "MEDIUM", "HIGH"];

// Atomic process creation: ONE multi-row INSERT — all tasks land or none do.
tasksBatchRouter.post("/batch", requirePerm("tasks"), async (req, res, next) => {
  const { tasks, campaignId = null, assigneeId = null, leadId = null, processKey = null } = req.body || {};
  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 40) {
    return res.status(400).json({ error: "tasks must be an array of 1–40 items" });
  }
  for (const t of tasks) {
    if (!t?.title || typeof t.title !== "string" || t.title.length > 300) return res.status(400).json({ error: "Each task needs a title (≤300 chars)" });
    if (t.priority && !PRIO.includes(t.priority)) return res.status(400).json({ error: `Invalid priority: ${t.priority}` });
  }
  try {
    if (leadId && !(await get(`SELECT 1 FROM leads WHERE id = $1`, [leadId]))) return res.status(400).json({ error: "Unknown lead" });
    const params = [];
    const rows = tasks.map((t) => {
      params.push(t.title, t.priority || "MEDIUM", t.dueDate || null, assigneeId, campaignId, leadId);
      const b = params.length;
      return `($${b - 5}, 'TODO', $${b - 4}, $${b - 3}, $${b - 2}, $${b - 1}, $${b})`;
    });
    const inserted = await all(
      `INSERT INTO tasks (title, status, priority, "dueDate", "assigneeId", "campaignId", "leadId")
       VALUES ${rows.join(", ")} RETURNING id`,
      params
    );
    logAudit(req, "tasks.batch", "tasks", null, { count: inserted.length, processKey });
    if (assigneeId && assigneeId !== req.user.id) {
      notify([assigneeId], "TASKS_ASSIGNED", { count: inserted.length, title: tasks[0].title }, "/tasks");
    }
    if (leadId) logActivity(req, leadId, "TASK", null, { count: inserted.length, processKey });
    res.status(201).json({ created: inserted.length, ids: inserted.map((r) => r.id) });
  } catch (e) { next(e); }
});
