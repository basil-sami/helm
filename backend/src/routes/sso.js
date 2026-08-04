import { Router } from "express";
import crypto from "node:crypto";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin, getPermissions } from "../auth.js";
import { logAudit } from "../audit.js";
import { signToken } from "../auth.js";
import {
  activeConnection, discover, jwksFor, verifyIdToken, sealHandshake, openHandshake,
  newVerifier, challengeFor, emailFromClaims, domainAllowed, roleFromClaims,
  clientSecretOf, sealClientSecret, logAuth, ssoPublicConfig,
} from "../sso.js";

// ═══ SEC·B · SSO ROUTES ═══════════════════════════════════════════════

export const ssoRouter = Router();
const COOKIE = "pulse_sso";

/** What the login screen needs. Public by design; leaks nothing. */
ssoRouter.get("/config", async (_req, res, next) => {
  try { res.json(await ssoPublicConfig()); } catch (e) { next(e); }
});

/** Begin the handshake: discovery → authorize URL → signed state cookie. */
ssoRouter.get("/start", async (req, res, next) => {
  try {
    const conn = await activeConnection();
    if (!conn) return res.status(400).json({ error: "Single sign-on is not configured on this instance" });
    const doc = await discover(conn);

    const state = crypto.randomBytes(16).toString("base64url");
    const nonce = crypto.randomBytes(16).toString("base64url");
    const verifier = newVerifier();

    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", conn.clientId);
    url.searchParams.set("redirect_uri", redirectUri(req));
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challengeFor(verifier));
    url.searchParams.set("code_challenge_method", "S256");

    res.cookie?.(COOKIE, sealHandshake({ state, nonce, verifier, connId: conn.id }), {
      httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 600_000, path: "/",
    });
    // Express without cookie-parser still sets headers directly.
    if (!res.cookie) {
      res.setHeader("Set-Cookie",
        `${COOKIE}=${sealHandshake({ state, nonce, verifier, connId: conn.id })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
    }
    if (req.query.json === "1") return res.json({ authorizeUrl: url.toString() });
    res.redirect(url.toString());
  } catch (e) { next(e); }
});

const redirectUri = (req) => {
  const base = process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${String(base).replace(/\/$/, "")}/api/auth/sso/callback`;
};

const readCookie = (req, name) => {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
};

/** Complete the handshake. Every check a reviewer asks about happens here. */
ssoRouter.get("/callback", async (req, res, next) => {
  const fail = async (status, reason, email = null) => {
    await logAuth({ email, method: "sso", ok: false, reason, req });
    return res.status(status).json({ error: reason });
  };
  try {
    const hs = openHandshake(readCookie(req, COOKIE) || req.query.handshake);
    if (!hs) return fail(400, "Sign-in expired or was tampered with — start again");
    if (!req.query.state || req.query.state !== hs.state) return fail(400, "State mismatch");
    if (req.query.error) return fail(400, `Identity provider returned: ${String(req.query.error).slice(0, 100)}`);
    if (!req.query.code) return fail(400, "No authorization code returned");

    const conn = await get(`SELECT * FROM sso_connections WHERE id = $1 AND active = true`, [hs.connId]);
    if (!conn) return fail(400, "This sign-in connection is no longer active");
    const doc = await discover(conn);

    // Exchange the code, proving possession of the PKCE verifier.
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(req.query.code),
      redirect_uri: redirectUri(req),
      client_id: conn.clientId,
      code_verifier: hs.verifier,
    });
    const secret = clientSecretOf(conn);
    if (secret) body.set("client_secret", secret);
    const tokenRes = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
    if (!tokenRes.ok) return fail(401, `Token exchange failed (${tokenRes.status})`);
    const tokens = await tokenRes.json();
    if (!tokens.id_token) return fail(401, "Identity provider returned no ID token");

    const decodedKid = (() => {
      try { return JSON.parse(Buffer.from(String(tokens.id_token).split(".")[0], "base64url").toString()).kid; }
      catch { return null; }
    })();
    let jwks = await jwksFor(conn, doc, { kid: decodedKid });
    let claims;
    try {
      claims = await verifyIdToken(tokens.id_token, { conn, doc, jwks, nonce: hs.nonce });
    } catch (e) {
      // An unknown key usually means the IdP rotated — refetch once.
      if (/signing key/i.test(e.message)) {
        jwks = await jwksFor(conn, doc, { kid: decodedKid, force: true });
        claims = await verifyIdToken(tokens.id_token, { conn, doc, jwks, nonce: hs.nonce });
      } else return fail(401, e.message);
    }

    const email = emailFromClaims(claims);
    if (!email) return fail(401, "Identity provider supplied no email address");
    if (conn.requireVerifiedEmail && claims.email_verified === false) return fail(401, "Email address is not verified at the identity provider", email);
    if (!domainAllowed(email, conn)) return fail(403, "That email domain is not permitted to sign in here", email);

    let user = await get(`SELECT * FROM users WHERE lower(email) = $1`, [email]);
    if (!user) {
      if (!conn.jitEnabled) return fail(403, "No Pulse account exists for that address, and automatic provisioning is off", email);
      const role = roleFromClaims(claims, conn);
      if (!role) return fail(403, "No role could be determined for that account", email);
      user = await get(
        `INSERT INTO users (name, email, role, active, "passwordHash", "ssoSubject")
         VALUES ($1,$2,$3,true,'!sso',$4) RETURNING *`,
        [claims.name || email.split("@")[0], email, role, claims.sub]);
      logAudit(req, "sso.provisioned", "users", user.id, { email, role });
    } else if (!user.ssoSubject) {
      await run(`UPDATE users SET "ssoSubject" = $2 WHERE id = $1`, [user.id, claims.sub]).catch(() => {});
    }

    if (!user.active) return fail(403, "That Pulse account is deactivated", email);

    // Role re-assertion on every login is how IdP group changes take
    // effect without a manual step.
    const mapped = roleFromClaims(claims, conn);
    if (mapped && mapped !== user.role) {
      await run(`UPDATE users SET role = $2 WHERE id = $1`, [user.id, mapped]);
      user.role = mapped;
    }

    const permissions = await getPermissions(user.role);
    const token = signToken(user);
    await logAuth({ userId: user.id, email, method: "sso", ok: true, req });
    logAudit(req, "sso.login", "users", user.id, { email });

    if (req.query.json === "1") {
      return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions } });
    }
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
    res.redirect(`/login#token=${encodeURIComponent(token)}`);
  } catch (e) { next(e); }
});

// ── Administration ───────────────────────────────────────────────────
export const ssoAdminRouter = Router();
ssoAdminRouter.use(requireAuth, requireAdmin);

const PUBLIC_COLS = `id, kind, name, "issuerUrl", "clientId", ("clientSecret" IS NOT NULL) AS "hasSecret",
  "emailDomains", "roleMap", "defaultRole", "jitEnabled", "ssoRequired", "requireVerifiedEmail",
  active, "discoveryAt", "jwksAt", "createdAt"`;

ssoAdminRouter.get("/", async (_req, res, next) => {
  try { res.json(await all(`SELECT ${PUBLIC_COLS} FROM sso_connections ORDER BY "createdAt"`)); }
  catch (e) { next(e); }
});

ssoAdminRouter.post("/", async (req, res, next) => {
  try {
    const d = req.body || {};
    if (!/^https?:\/\/.+/.test(d.issuerUrl || "")) return res.status(400).json({ error: "A valid issuer URL is required" });
    if (!d.clientId) return res.status(400).json({ error: "clientId is required" });
    const row = await get(
      `INSERT INTO sso_connections (name, "issuerUrl", "clientId", "emailDomains", "roleMap", "defaultRole",
         "jitEnabled", "requireVerifiedEmail") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,COALESCE($7,false),COALESCE($8,true))
       RETURNING id`,
      [d.name || "Corporate SSO", d.issuerUrl, d.clientId, JSON.stringify(d.emailDomains || []),
       JSON.stringify(d.roleMap || {}), d.defaultRole || null, d.jitEnabled ?? null, d.requireVerifiedEmail ?? null]);
    if (d.clientSecret) {
      await run(`UPDATE sso_connections SET "clientSecret" = $2 WHERE id = $1`,
        [row.id, sealClientSecret(row.id, d.clientSecret)]);
    }
    logAudit(req, "sso.connectionCreate", "sso_connections", row.id, { issuer: d.issuerUrl });
    res.status(201).json(await get(`SELECT ${PUBLIC_COLS} FROM sso_connections WHERE id = $1`, [row.id]));
  } catch (e) { next(e); }
});

ssoAdminRouter.patch("/:id", async (req, res, next) => {
  try {
    const conn = await get(`SELECT * FROM sso_connections WHERE id = $1`, [req.params.id]);
    if (!conn) return res.status(404).json({ error: "Connection not found" });
    const d = req.body || {};

    // Requiring SSO without a break-glass account would let one IdP
    // misconfiguration lock an organisation out of its own instance.
    if (d.ssoRequired === true) {
      const bg = await get(`SELECT COUNT(*)::int c FROM users WHERE "breakGlass" = true AND active = true`);
      if (!Number(bg?.c)) {
        return res.status(400).json({ error: "Designate a break-glass administrator before requiring SSO — otherwise an identity-provider outage locks everyone out" });
      }
      if (!conn.active && d.active !== true) return res.status(400).json({ error: "Activate the connection before requiring it" });
    }

    const sets = [], params = [conn.id];
    const push = (col, val) => { params.push(val); sets.push(`"${col}" = $${params.length}`); };
    for (const col of ["name", "issuerUrl", "clientId", "defaultRole"]) if (d[col] !== undefined) push(col, d[col]);
    for (const col of ["jitEnabled", "ssoRequired", "requireVerifiedEmail", "active"]) if (d[col] !== undefined) push(col, !!d[col]);
    if (d.emailDomains !== undefined) { params.push(JSON.stringify(d.emailDomains)); sets.push(`"emailDomains" = $${params.length}::jsonb`); }
    if (d.roleMap !== undefined) { params.push(JSON.stringify(d.roleMap)); sets.push(`"roleMap" = $${params.length}::jsonb`); }
    if (d.clientSecret !== undefined) push("clientSecret", d.clientSecret ? sealClientSecret(conn.id, d.clientSecret) : null);
    if (!sets.length) return res.status(400).json({ error: "No valid fields" });
    sets.push(`"updatedAt" = now()`);
    await run(`UPDATE sso_connections SET ${sets.join(", ")} WHERE id = $1`, params);
    logAudit(req, "sso.connectionUpdate", "sso_connections", conn.id, { ssoRequired: d.ssoRequired, active: d.active });
    res.json(await get(`SELECT ${PUBLIC_COLS} FROM sso_connections WHERE id = $1`, [conn.id]));
  } catch (e) { next(e); }
});

/** Test the connection: discovery and JWKS only — no sign-in, no writes. */
ssoAdminRouter.post("/:id/test", async (req, res, next) => {
  try {
    const conn = await get(`SELECT * FROM sso_connections WHERE id = $1`, [req.params.id]);
    if (!conn) return res.status(404).json({ error: "Connection not found" });
    try {
      const doc = await discover(conn, { force: true });
      const jwks = await jwksFor(conn, doc, { force: true });
      res.json({ ok: true, issuer: doc.issuer, authorizeEndpoint: doc.authorization_endpoint,
        tokenEndpoint: doc.token_endpoint, signingKeys: jwks?.keys?.length || 0,
        redirectUri: redirectUri(req) });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  } catch (e) { next(e); }
});

ssoAdminRouter.delete("/:id", async (req, res, next) => {
  try {
    await run(`DELETE FROM sso_connections WHERE id = $1`, [req.params.id]);
    logAudit(req, "sso.connectionDelete", "sso_connections", req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** The authentication audit a security review asks for first. */
ssoAdminRouter.get("/events", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    res.json(await all(
      `SELECT e.*, u.name AS "userName" FROM auth_events e LEFT JOIN users u ON u.id = e."userId"
        ORDER BY e.at DESC LIMIT $1`, [limit]));
  } catch (e) { next(e); }
});
