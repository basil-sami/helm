import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
const validTasks = (t) => Array.isArray(t) && t.length >= 1 && t.length <= 40 &&
  t.every((x) => x?.t?.ar && x?.t?.en && Number.isFinite(x.offset) && ["LOW","MEDIUM","HIGH"].includes(x.priority));

templatesRouter.get("/", async (_req, res, next) => {
  try { res.json(await all(`SELECT * FROM process_templates ORDER BY builtin DESC, "createdAt" ASC`)); }
  catch { res.json([]); /* pre-migration */ }
});

templatesRouter.post("/", requireAdmin, async (req, res, next) => {
  const { key, name, nameAr, tasks } = req.body || {};
  if (!KEY_RE.test(key || "")) return res.status(400).json({ error: "Key: a–z 0–9 _ (2–30 chars)" });
  if (!name || !validTasks(tasks)) return res.status(400).json({ error: "Name and 1–40 valid tasks required" });
  try {
    if (await get(`SELECT 1 FROM process_templates WHERE key = $1`, [key])) return res.status(409).json({ error: "Key exists" });
    const row = await get(
      `INSERT INTO process_templates (key, name, "nameAr", tasks, builtin) VALUES ($1,$2,$3,$4,false) RETURNING *`,
      [key, name, nameAr || null, JSON.stringify(tasks)]);
    logAudit(req, "templates.create", "process_templates", row.id, { key });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

templatesRouter.patch("/:id", requireAdmin, async (req, res, next) => {
  try {
    const t = await get(`SELECT * FROM process_templates WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Not found" });
    if (t.builtin) return res.status(403).json({ error: "Built-in templates are locked" });
    if (req.body.tasks !== undefined && !validTasks(req.body.tasks)) return res.status(400).json({ error: "Invalid tasks" });
    await run(
      `UPDATE process_templates SET name = COALESCE($1, name), "nameAr" = COALESCE($2, "nameAr"), tasks = COALESCE($3, tasks) WHERE id = $4`,
      [req.body.name || null, req.body.nameAr || null, req.body.tasks ? JSON.stringify(req.body.tasks) : null, req.params.id]);
    logAudit(req, "templates.update", "process_templates", req.params.id);
    res.json(await get(`SELECT * FROM process_templates WHERE id = $1`, [req.params.id]));
  } catch (e) { next(e); }
});

templatesRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const t = await get(`SELECT * FROM process_templates WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Not found" });
    if (t.builtin) return res.status(403).json({ error: "Built-in templates are locked" });
    await run(`DELETE FROM process_templates WHERE id = $1`, [req.params.id]);
    logAudit(req, "templates.delete", "process_templates", req.params.id, { key: t.key });
    res.status(204).end();
  } catch (e) { next(e); }
});
