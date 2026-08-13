import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";

// ═══ DEPARTMENTS (Wave 3·H) ══════════════════════════════════════════
// The roll-up is the reason this exists: a department head sees their own
// numbers, and the GM sees all of them side by side.

export const departmentsRouter = Router();
departmentsRouter.use(requireAuth);

departmentsRouter.get("/", requirePerm("settings", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT d.*, u.name AS "headName",
              (SELECT COUNT(*)::int FROM users x WHERE x."departmentId" = d.id) AS members
       FROM departments d LEFT JOIN users u ON u.id = d."headId"
       ORDER BY d.active DESC, d.name`));
  } catch (e) { next(e); }
});

departmentsRouter.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { name, nameAr, code, headId } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    if (code) {
      const dup = await get(`SELECT 1 FROM departments WHERE code = $1`, [code]);
      if (dup) return res.status(409).json({ error: "That code is already in use" });
    }
    const row = await get(
      `INSERT INTO departments (name, "nameAr", code, "headId") VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, nameAr || null, code || null, headId || null]);
    logAudit(req, "department.create", "departments", row.id, { name });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

departmentsRouter.patch("/:id", requireAdmin, async (req, res, next) => {
  try {
    const d = await get(`SELECT * FROM departments WHERE id = $1`, [req.params.id]);
    if (!d) return res.status(404).json({ error: "Not found" });
    for (const f of ["name", "nameAr", "code", "headId", "active"]) {
      if (req.body[f] !== undefined) {
        await run(`UPDATE departments SET "${f}" = $2 WHERE id = $1`, [d.id, req.body[f]]);
      }
    }
    res.json(await get(`SELECT * FROM departments WHERE id = $1`, [d.id]));
  } catch (e) { next(e); }
});

departmentsRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    // rows keep existing and simply become unassigned — deleting a
    // department must never delete the work done inside it
    await run(`DELETE FROM departments WHERE id = $1`, [req.params.id]);
    logAudit(req, "department.delete", "departments", req.params.id, null);
    res.status(204).end();
  } catch (e) { next(e); }
});

/**
 * The roll-up. A scoped user sees only their own row; the GM sees them
 * all, which is the entire argument for doing this as a dimension.
 */
departmentsRouter.get("/rollup", requirePerm("analytics", "read"), async (req, res, next) => {
  try {
    const scope = req.user.isAdmin ? null : req.user.departmentId;
    const rows = await all(
      `SELECT d.id, d.name, d."nameAr",
        (SELECT COUNT(*)::int FROM leads l WHERE l."departmentId" = d.id) AS leads,
        (SELECT COUNT(*)::int FROM leads l WHERE l."departmentId" = d.id AND l.stage = 'WON') AS won,
        (SELECT COUNT(*)::int FROM campaigns c WHERE c."departmentId" = d.id) AS campaigns,
        (SELECT COUNT(*)::int FROM tasks t WHERE t."departmentId" = d.id AND t.status <> 'DONE') AS "openTasks",
        (SELECT COALESCE(SUM(b."amountUsd"),0)::float8 FROM budget_entries b
           WHERE b."departmentId" = d.id AND b.kind = 'SPENT') AS "spentUsd"
       FROM departments d WHERE d.active = true
       ${scope ? `AND d.id = $1` : ""}
       ORDER BY d.name`, scope ? [scope] : []);

    const unassigned = req.user.isAdmin
      ? await get(`SELECT
           (SELECT COUNT(*)::int FROM leads WHERE "departmentId" IS NULL) AS leads,
           (SELECT COUNT(*)::int FROM campaigns WHERE "departmentId" IS NULL) AS campaigns`)
      : null;

    res.json({ departments: rows, unassigned, scoped: !!scope });
  } catch (e) { next(e); }
});
