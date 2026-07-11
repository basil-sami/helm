import { Router } from "express";
import { z } from "zod";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin, hashPassword, DEFAULT_ROLE_PERMS } from "../auth.js";
import { logAudit } from "../audit.js";

// A role is valid if it exists in the roles table, or is a built-in
// (fallback for live DBs where the roles migration hasn't run yet).
async function roleExists(key) {
  try {
    if (await get("SELECT 1 FROM roles WHERE key = $1", [key])) return true;
  } catch { /* roles table missing pre-migration */ }
  return Object.prototype.hasOwnProperty.call(DEFAULT_ROLE_PERMS, key);
}

export const usersRouter = Router();
usersRouter.use(requireAuth);

// List active users — available to all signed-in users (for assignee dropdowns).
usersRouter.get("/", async (req, res, next) => {
  try {
    if (req.user?.permissions?.admin) {
      return res.json(await all(`SELECT id, name, email, role, "titleAr", active, "createdAt" FROM users ORDER BY "createdAt" ASC`));
    }
    // Non-admins get a minimal directory (enough for assignee/owner pickers) — no emails.
    res.json(await all(`SELECT id, name, role, "titleAr", active FROM users WHERE active = true ORDER BY name ASC`));
  } catch (e) { next(e); }
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.string().min(2).max(30),
  titleAr: z.string().optional().nullable(),
});

// Create user — Head of Marketing only.
usersRouter.post("/", requireAdmin, async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid user data", detail: parsed.error.issues?.[0]?.message });
  try {
    if (!(await roleExists(parsed.data.role))) return res.status(400).json({ error: "Unknown role" });
    const exists = await get("SELECT id FROM users WHERE email = $1", [parsed.data.email]);
    if (exists) return res.status(409).json({ error: "Email already in use" });
    const row = await get(
      `INSERT INTO users (name, email, "passwordHash", role, "titleAr")
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, "titleAr", active, "createdAt"`,
      [parsed.data.name, parsed.data.email, hashPassword(parsed.data.password), parsed.data.role, parsed.data.titleAr || null]
    );
    logAudit(req, "users.create", "users", row.id, { role: parsed.data.role });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// Update user — Head only. Optional password reset.
usersRouter.patch("/:id", requireAdmin, async (req, res, next) => {
  const sets = [], params = [];
  const push = (col, val) => { params.push(val); sets.push(`"${col}" = $${params.length}`); };
  if (req.body.name !== undefined) push("name", req.body.name);
  if (req.body.role !== undefined) {
    if (!(await roleExists(req.body.role))) return res.status(400).json({ error: "Unknown role" });
    push("role", req.body.role);
  }
  if (req.body.titleAr !== undefined) push("titleAr", req.body.titleAr || null);
  if (req.body.active !== undefined) push("active", !!req.body.active);
  if (req.body.password) {
    if (typeof req.body.password !== "string" || req.body.password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    push("passwordHash", hashPassword(req.body.password));
    push("mustChangePassword", true); // force rotation on next login
    sets.push(`"tokenVersion" = "tokenVersion" + 1`); // revoke existing sessions
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });
  try {
    params.push(req.params.id);
    await run(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    logAudit(req, "users.update", "users", req.params.id);
    res.json(await get(`SELECT id, name, email, role, "titleAr", active, "createdAt" FROM users WHERE id = $1`, [req.params.id]));
  } catch (e) { next(e); }
});

// Deactivate (soft delete) — Head only; never hard-delete to preserve references.
usersRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot deactivate yourself" });
  try {
    await run(`UPDATE users SET active = false WHERE id = $1`, [req.params.id]);
    logAudit(req, "users.deactivate", "users", req.params.id);
    res.status(204).end();
  } catch (e) { next(e); }
});
