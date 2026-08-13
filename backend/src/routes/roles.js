import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin, invalidateRoleCache, PERM_MODULES } from "../auth.js";
import { logAudit } from "../audit.js";

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

const KEY_RE = /^[A-Z][A-Z0-9_]{1,29}$/;
const LEVELS = ["none", "read", "write"];

function sanitizePerms(raw = {}) {
  const out = { admin: !!raw.admin };
  for (const m of PERM_MODULES) out[m] = LEVELS.includes(raw[m]) ? raw[m] : "none";
  return out;
}

// Everyone signed-in can list roles (needed for the user-form role picker).
rolesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await all(`SELECT r.*, (SELECT COUNT(*)::int FROM users u WHERE u.role = r.key) AS "userCount"
                        FROM roles r ORDER BY r.builtin DESC, r."createdAt" ASC`));
  } catch (e) { next(e); }
});

rolesRouter.post("/", requireAdmin, async (req, res, next) => {
  const { key, label, labelAr, permissions } = req.body || {};
  if (!KEY_RE.test(key || "")) return res.status(400).json({ error: "Key must be A–Z, 0–9, _ (2–30 chars, starts with a letter)" });
  if (!label) return res.status(400).json({ error: "Label is required" });
  try {
    if (await get("SELECT 1 FROM roles WHERE key = $1", [key])) return res.status(409).json({ error: "Role key already exists" });
    const row = await get(
      `INSERT INTO roles (key, label, "labelAr", permissions, builtin)
       VALUES ($1,$2,$3,$4,false) RETURNING *`,
      [key, label, labelAr || null, JSON.stringify(sanitizePerms(permissions))]
    );
    invalidateRoleCache();
    logAudit(req, "roles.create", "roles", row.id, { key });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

rolesRouter.patch("/:id", requireAdmin, async (req, res, next) => {
  try {
    const role = await get("SELECT * FROM roles WHERE id = $1", [req.params.id]);
    if (!role) return res.status(404).json({ error: "Not found" });
    if (role.builtin) return res.status(403).json({ error: "Built-in roles are locked" });
    const sets = [], params = [];
    const push = (col, val) => { params.push(val); sets.push(`"${col}" = $${params.length}`); };
    if (req.body.label !== undefined) push("label", req.body.label);
    if (req.body.labelAr !== undefined) push("labelAr", req.body.labelAr || null);
    if (req.body.permissions !== undefined) push("permissions", JSON.stringify(sanitizePerms(req.body.permissions)));
    if (!sets.length) return res.status(400).json({ error: "No valid fields" });
    params.push(req.params.id);
    await run(`UPDATE roles SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    invalidateRoleCache();
    logAudit(req, "roles.update", "roles", req.params.id);
    res.json(await get("SELECT * FROM roles WHERE id = $1", [req.params.id]));
  } catch (e) { next(e); }
});

rolesRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const role = await get("SELECT * FROM roles WHERE id = $1", [req.params.id]);
    if (!role) return res.status(404).json({ error: "Not found" });
    if (role.builtin) return res.status(403).json({ error: "Built-in roles are locked" });
    const inUse = await get("SELECT COUNT(*)::int AS n FROM users WHERE role = $1", [role.key]);
    if (inUse.n > 0) return res.status(409).json({ error: `Role is assigned to ${inUse.n} user(s)` });
    await run("DELETE FROM roles WHERE id = $1", [req.params.id]);
    invalidateRoleCache();
    logAudit(req, "roles.delete", "roles", req.params.id, { key: role.key });
    res.status(204).end();
  } catch (e) { next(e); }
});
