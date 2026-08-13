import { Router } from "express";
import bcrypt from "bcryptjs";
import { get, run } from "../db.js";
import { signToken, getPermissions } from "../auth.js";
import { logAudit } from "../audit.js";
import { rateLimit } from "../security.js";

// ── Pulse installer (Wave 0) ─────────────────────────────────────────
// A fresh instance has ZERO users (the generic seed creates none).
// GET  /api/setup/status  (public) → { needsSetup, onboarded, branding }
//   branding is intentionally public: it is exactly what the login screen shows.
// POST /api/setup         (public) → creates the FIRST admin (role HEAD) and
//   returns a signed session. Hard-disabled forever once any user exists —
//   after that it always answers 403, so it can never be used to escalate.

export const setupRouter = Router();

const publicBranding = () =>
  get(`SELECT "orgName", "orgNameAr", "logoUrl", "accentColor",
              "localCurrency", "localCurrencyAr", onboarded
       FROM settings WHERE id = 1`);

setupRouter.get("/status", async (_req, res, next) => {
  try {
    const [count, s] = await Promise.all([
      get("SELECT COUNT(*)::int AS n FROM users"),
      publicBranding(),
    ]);
    const { onboarded, ...branding } = s || {};
    res.json({ needsSetup: (count?.n ?? 0) === 0, onboarded: !!onboarded, branding });
  } catch (e) { next(e); }
});

const setupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: "Too many attempts — wait a few minutes" });

setupRouter.post("/", setupLimiter, async (req, res, next) => {
  try {
    const count = await get("SELECT COUNT(*)::int AS n FROM users");
    if ((count?.n ?? 0) > 0) return res.status(403).json({ error: "Setup already completed" });

    const { name, email, password, orgName, orgNameAr } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: "name, email and password are required" });
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return res.status(400).json({ error: "Invalid email" });

    const hash = bcrypt.hashSync(String(password), 10);
    const user = await get(
      `INSERT INTO users (name, email, "passwordHash", role, active)
       VALUES ($1, lower($2), $3, 'HEAD', true)
       RETURNING id, name, email, role, "titleAr", "tokenVersion"`,
      [String(name).trim(), String(email).trim(), hash]
    );
    if (orgName || orgNameAr) {
      await run(
        `UPDATE settings SET "orgName" = COALESCE($1, "orgName"), "orgNameAr" = COALESCE($2, "orgNameAr") WHERE id = 1`,
        [orgName || null, orgNameAr || null]
      );
    }
    logAudit({ user: { id: user.id, name: user.name } }, "setup.bootstrap", "users", user.id);

    const permissions = await getPermissions(user.role);
    res.status(201).json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, titleAr: user.titleAr, permissions, mustChangePassword: false, totpEnabled: false },
    });
  } catch (e) {
    if (e.code === "23505") return res.status(403).json({ error: "Setup already completed" }); // unique-email race
    next(e);
  }
});
