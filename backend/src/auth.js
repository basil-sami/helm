import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { get } from "./db.js";
import { rateLimit } from "./security.js";
import { totpVerify } from "./totp.js";

const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" ? "" : "helm-dev-secret-change-me");
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production. Add it to your environment variables.");
}
const TOKEN_TTL = "7d";

// ── Roles & permissions ──────────────────────────────────────────────
// permissions shape: { admin: bool, <module>: "none" | "read" | "write" }
export const PERM_MODULES = [
  "campaigns", "content", "leads", "events", "budget", "tasks",
  "social", "intel", "planning", "analytics", "brain",
];
const LEVELS = ["none", "read", "write"];

const fullAccess = (admin) => ({
  admin,
  campaigns: "write", content: "write", leads: "write", events: "write",
  budget: "write", tasks: "write", social: "write", intel: "write",
  planning: "write", analytics: "read", brain: "read",
});
const memberAccess = () => ({
  admin: false,
  campaigns: "write", content: "write", leads: "write", events: "write",
  budget: "write", tasks: "write", social: "read", intel: "read",
  planning: "read", analytics: "read", brain: "read",
});

// Mirrors the seeded built-in roles — used as a fallback when the roles
// table doesn't exist yet (live DB before the migration is applied).
export const DEFAULT_ROLE_PERMS = {
  HEAD: fullAccess(true),
  DIGITAL: fullAccess(false),
  PAID_MEDIA: memberAccess(),
  EVENTS: memberAccess(),
  CONTENT_BRAND: memberAccess(),
};
const READ_ONLY = Object.fromEntries(PERM_MODULES.map((m) => [m, "read"]));

const roleCache = new Map(); // roleKey -> { perms, at }
const CACHE_MS = 15_000;
export function invalidateRoleCache() { roleCache.clear(); }

function normalizePerms(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = { admin: !!src.admin };
  for (const m of PERM_MODULES) {
    out[m] = LEVELS.includes(src[m]) ? src[m] : (out.admin ? "write" : "none");
  }
  return out;
}

export async function getPermissions(roleKey) {
  if (!roleKey) return { admin: false, ...READ_ONLY };
  const hit = roleCache.get(roleKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.perms;
  let raw = null;
  try {
    const row = await get("SELECT permissions FROM roles WHERE key = $1", [roleKey]);
    if (row) raw = typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions;
  } catch { /* roles table may not exist yet — fall back below */ }
  const perms = raw
    ? normalizePerms(raw)
    : (DEFAULT_ROLE_PERMS[roleKey] || { admin: false, ...READ_ONLY }); // unknown/deleted role → read-only
  roleCache.set(roleKey, { perms, at: Date.now() });
  return perms;
}

export function hasPerm(perms, module, level = "write") {
  if (!perms) return true; // only reachable if requireAuth was skipped
  if (perms.admin) return true;
  const v = perms[module];
  return level === "read" ? v === "read" || v === "write" : v === "write";
}

export function requirePerm(module, level = "write") {
  return (req, res, next) => {
    if (hasPerm(req.user?.permissions, module, level)) return next();
    return res.status(403).json({ error: "Insufficient permissions" });
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.permissions?.admin) return next();
  return res.status(403).json({ error: "Admin only" });
}

// Legacy helper (kept for compatibility): HEAD always passes.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user?.role === "HEAD" || roles.includes(req.user?.role)) return next();
    return res.status(403).json({ error: "Insufficient role" });
  };
}

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, v: user.tokenVersion || 0 },
    JWT_SECRET, { expiresIn: TOKEN_TTL }
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await get(`SELECT id, name, email, role, active, "tokenVersion", "mustChangePassword" FROM users WHERE id = $1`, [payload.sub]);
    if (!user || !user.active) return res.status(401).json({ error: "Invalid session" });
    if ((payload.v || 0) !== (user.tokenVersion || 0)) return res.status(401).json({ error: "Session revoked" });
    const permissions = await getPermissions(user.role);
    req.user = { id: user.id, role: user.role, name: user.name, email: user.email, permissions, mustChangePassword: !!user.mustChangePassword };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 12, message: "Too many login attempts — wait a few minutes" });

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid credentials format" });
  try {
    const user = await get("SELECT * FROM users WHERE email = $1", [parsed.data.email]);
    if (!user || !user.active) return res.status(401).json({ error: "Invalid email or password" });
    if (!bcrypt.compareSync(parsed.data.password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (user.totpEnabled) {
      if (!req.body.otp) return res.status(401).json({ error: "OTP required", otpRequired: true });
      if (!totpVerify(user.totpSecret, req.body.otp)) return res.status(401).json({ error: "Invalid OTP", otpRequired: true });
    }
    const permissions = await getPermissions(user.role);
    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, titleAr: user.titleAr, permissions, mustChangePassword: !!user.mustChangePassword, totpEnabled: !!user.totpEnabled },
    });
  } catch (e) { next(e); }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await get(`SELECT id, name, email, role, "titleAr" FROM users WHERE id = $1`, [req.user.id]);
    res.json({ user: { ...user, permissions: req.user.permissions, mustChangePassword: req.user.mustChangePassword } });
  } catch (e) { next(e); }
});
