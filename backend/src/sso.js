import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { all, get, run } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

// ═══ SEC·B · OIDC SINGLE SIGN-ON ══════════════════════════════════════
// Zero new dependencies. Discovery and token exchange ride native fetch;
// JWKS keys are imported with crypto.createPublicKey({ format: "jwk" });
// signature verification uses the jsonwebtoken already in the nine.
//
// The state/nonce/PKCE triple is carried in an HMAC-signed httpOnly
// cookie rather than a database table — serverless-clean, and one fewer
// thing to expire.

const b64u = (b) => Buffer.from(b).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest();

export const newVerifier = () => b64u(crypto.randomBytes(32));
export const challengeFor = (verifier) => b64u(sha256(verifier));

// ── The signed handshake cookie ──────────────────────────────────────
const stateSecret = () => process.env.JWT_SECRET || "pulse-dev-secret";

export function sealHandshake(payload, ttlSeconds = 600) {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const mac = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function openHandshake(cookie) {
  if (!cookie || typeof cookie !== "string" || !cookie.includes(".")) return null;
  const [body, mac] = cookie.split(".");
  const expect = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  // Timing-safe, and length-checked first so timingSafeEqual cannot throw.
  if (mac.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  let parsed;
  try { parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!parsed?.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed;
}

// ── Discovery and JWKS, cached on the connection row ─────────────────
const DISCOVERY_TTL_MS = 24 * 3600 * 1000;

export async function discover(conn, { force = false } = {}) {
  const cached = typeof conn.discovery === "string" ? JSON.parse(conn.discovery) : conn.discovery;
  if (!force && cached?.token_endpoint && conn.discoveryAt && Date.now() - new Date(conn.discoveryAt) < DISCOVERY_TTL_MS) {
    return cached;
  }
  const url = `${String(conn.issuerUrl).replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Discovery failed (${res.status}) at ${url}`);
  const doc = await res.json();
  for (const field of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (!doc[field]) throw new Error(`Discovery document is missing ${field}`);
  }
  await run(`UPDATE sso_connections SET discovery = $2::jsonb, "discoveryAt" = now(), "updatedAt" = now() WHERE id = $1`,
    [conn.id, JSON.stringify(doc)]).catch(() => {});
  return doc;
}

export async function jwksFor(conn, doc, { kid = null, force = false } = {}) {
  const cached = typeof conn.jwks === "string" ? JSON.parse(conn.jwks) : conn.jwks;
  const have = cached?.keys?.find((k) => !kid || k.kid === kid);
  // Refetch on an unknown kid — that is how key rotation at the IdP is
  // absorbed without an outage.
  if (have && !force) return cached;
  const res = await fetch(doc.jwks_uri, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const jwks = await res.json();
  await run(`UPDATE sso_connections SET jwks = $2::jsonb, "jwksAt" = now(), "updatedAt" = now() WHERE id = $1`,
    [conn.id, JSON.stringify(jwks)]).catch(() => {});
  return jwks;
}

/** JWK → PEM, via native crypto. No dependency needed for this. */
export function pemFromJwk(jwk) {
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  return key.export({ type: "spki", format: "pem" });
}

// ── ID token verification ────────────────────────────────────────────
/**
 * Every check a reviewer will ask about, in one place: signature against
 * the IdP's published key, issuer, audience, expiry with a small skew,
 * and the nonce that binds the token to this browser's handshake.
 */
export async function verifyIdToken(idToken, { conn, doc, jwks, nonce }) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header) throw new Error("Malformed ID token");
  const alg = decoded.header.alg;
  if (!/^RS(256|384|512)$/.test(alg)) throw new Error(`Unsupported ID token algorithm: ${alg}`);
  const jwk = jwks?.keys?.find((k) => k.kid === decoded.header.kid) || jwks?.keys?.[0];
  if (!jwk) throw new Error("No signing key matches the ID token");

  const claims = jwt.verify(idToken, pemFromJwk(jwk), {
    algorithms: [alg],
    audience: conn.clientId,
    issuer: doc.issuer,
    clockTolerance: 60,
  });
  if (nonce && claims.nonce !== nonce) throw new Error("Nonce mismatch — this token was not issued for this sign-in");
  if (!claims.sub) throw new Error("ID token carries no subject");
  return claims;
}

// ── Claim → user mapping ─────────────────────────────────────────────
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v || {});

export function emailFromClaims(claims) {
  return String(claims.email || claims.preferred_username || claims.upn || "").trim().toLowerCase() || null;
}

export function domainAllowed(email, conn) {
  const list = parse(conn.emailDomains);
  if (!Array.isArray(list) || !list.length) return true;
  const domain = String(email || "").split("@")[1] || "";
  return list.map((d) => String(d).toLowerCase().replace(/^@/, "")).includes(domain);
}

/** Map an IdP group/role claim onto a Pulse role. */
export function roleFromClaims(claims, conn) {
  const map = parse(conn.roleMap);
  const claimName = map.claim;
  if (claimName) {
    const raw = claims[claimName];
    const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    for (const v of values) {
      const hit = map.values?.[v];
      if (hit) return hit;
    }
  }
  return conn.defaultRole || null;
}

// ── Connection helpers ───────────────────────────────────────────────
export async function activeConnection() {
  return get(`SELECT * FROM sso_connections WHERE active = true ORDER BY "createdAt" LIMIT 1`).catch(() => null);
}

export async function ssoRequired() {
  const c = await activeConnection();
  return !!(c && c.ssoRequired);
}

export function clientSecretOf(conn) {
  if (!conn?.clientSecret) return null;
  return decryptSecret(conn.clientSecret, {
    table: "sso_connections", id: conn.id, column: "clientSecret", allowLegacyPlaintext: true });
}

export function sealClientSecret(id, plain) {
  return plain ? encryptSecret(plain, { table: "sso_connections", id, column: "clientSecret" }) : null;
}

// ── Audit ────────────────────────────────────────────────────────────
export async function logAuth({ userId = null, email = null, method, ok, reason = null, req = null }) {
  await run(
    `INSERT INTO auth_events ("userId", email, method, ok, reason, ip, ua) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, email, method, !!ok, reason ? String(reason).slice(0, 200) : null,
     req?.ip || null, String(req?.headers?.["user-agent"] || "").slice(0, 200) || null]).catch(() => {});
}

/** Public-facing config for the login screen. Never leaks the secret. */
export async function ssoPublicConfig() {
  const c = await activeConnection();
  if (!c) return { enabled: false, required: false };
  return { enabled: true, required: !!c.ssoRequired, name: c.name, kind: c.kind };
}
