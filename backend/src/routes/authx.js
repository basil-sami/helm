import { Router } from "express";
import bcrypt from "bcryptjs";
import { get, run } from "../db.js";
import { requireAuth, hashPassword } from "../auth.js";
import { logAudit } from "../audit.js";
import { newSecret, totpVerify, otpauthUrl } from "../totp.js";

export const authxRouter = Router();
authxRouter.use(requireAuth);

// Change own password → revokes every other session (tokenVersion bump).
// Returns a note; the client should re-login (its own token is revoked too).
authxRouter.post("/change-password", async (req, res, next) => {
  const { current, next: nextPw } = req.body || {};
  if (typeof nextPw !== "string" || nextPw.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  try {
    const user = await get(`SELECT "passwordHash" FROM users WHERE id = $1`, [req.user.id]);
    if (!bcrypt.compareSync(String(current || ""), user.passwordHash)) return res.status(400).json({ error: "Current password is incorrect" });
    await run(`UPDATE users SET "passwordHash" = $1, "mustChangePassword" = false, "tokenVersion" = "tokenVersion" + 1 WHERE id = $2`,
      [hashPassword(nextPw), req.user.id]);
    logAudit(req, "auth.change_password", "users", req.user.id);
    res.json({ ok: true, reauth: true });
  } catch (e) { next(e); }
});

// Sign out everywhere (self).
authxRouter.post("/logout-all", async (req, res, next) => {
  try {
    await run(`UPDATE users SET "tokenVersion" = "tokenVersion" + 1 WHERE id = $1`, [req.user.id]);
    logAudit(req, "auth.logout_all", "users", req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// TOTP 2FA — setup returns a secret (enter it in any authenticator app),
// enable confirms with a live code, disable requires the password.
authxRouter.post("/totp/setup", async (req, res, next) => {
  try {
    const secret = newSecret();
    await run(`UPDATE users SET "totpSecret" = $1, "totpEnabled" = false WHERE id = $2`, [secret, req.user.id]);
    res.json({ secret, otpauth: otpauthUrl(secret, req.user.email, "HELM حلم") });
  } catch (e) { next(e); }
});

authxRouter.post("/totp/enable", async (req, res, next) => {
  try {
    const u = await get(`SELECT "totpSecret" FROM users WHERE id = $1`, [req.user.id]);
    if (!u?.totpSecret) return res.status(400).json({ error: "Run setup first" });
    if (!totpVerify(u.totpSecret, req.body?.otp)) return res.status(400).json({ error: "Invalid code" });
    await run(`UPDATE users SET "totpEnabled" = true WHERE id = $1`, [req.user.id]);
    logAudit(req, "auth.totp_enabled", "users", req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

authxRouter.post("/totp/disable", async (req, res, next) => {
  try {
    const u = await get(`SELECT "passwordHash" FROM users WHERE id = $1`, [req.user.id]);
    if (!bcrypt.compareSync(String(req.body?.password || ""), u.passwordHash)) return res.status(400).json({ error: "Password is incorrect" });
    await run(`UPDATE users SET "totpEnabled" = false, "totpSecret" = null WHERE id = $1`, [req.user.id]);
    logAudit(req, "auth.totp_disabled", "users", req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
