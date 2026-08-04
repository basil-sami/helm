import crypto from "node:crypto";

// ═══ SEC·A · THE CRYPTO RAIL ══════════════════════════════════════════
// One contract for every secret Pulse holds. Same shape as mail / storage
// / ai / search: all access goes through here, and a second path to the
// same capability is the architectural sin this pattern exists to prevent.
//
// PRINCIPLE — encrypt what we use, hash what we verify.
//   · Credentials we must read back (platform access tokens, TOTP seeds)
//     are encrypted and decrypted at the moment of use.
//   · Credentials we only ever compare (passwords, magic-link tokens) are
//     hashed. Never encrypt what a hash suffices for.
//
// Zero new dependencies: AES-256-GCM, SHA-256 and randomBytes are all in
// node:crypto. The nine-package supply chain is unchanged.

const PREFIX = "enc";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

/** Which key versions this build understands, newest first. */
export function availableKeys() {
  const out = [];
  for (let v = 9; v >= 1; v--) {
    const raw = process.env[`PULSE_SECRET_KEY_V${v}`];
    if (!raw) continue;
    let buf;
    try { buf = Buffer.from(raw, "base64"); } catch { continue; }
    if (buf.length !== 32) continue;   // a wrong-length key is not "close enough"
    out.push({ version: v, key: buf });
  }
  return out;
}

export const currentKey = () => availableKeys()[0] || null;
export const cryptoReady = () => !!currentKey();

/** AAD binds a ciphertext to the exact cell it belongs in. */
const aadFor = (table, id, column) => Buffer.from(`${table}:${id}:${column}`, "utf8");

export const isEncrypted = (v) => typeof v === "string" && v.startsWith(`${PREFIX}:v`);

/**
 * Encrypt a secret for one specific row and column.
 * A ciphertext copied into another row, another column or another table
 * fails authentication — cheap to do, and exactly what a reviewer checks.
 */
export function encryptSecret(plain, { table, id, column }) {
  if (plain === null || plain === undefined || plain === "") return plain;
  if (isEncrypted(plain)) return plain;                       // idempotent
  const k = currentKey();
  if (!k) throw new Error("PULSE_SECRET_KEY_V1 is not configured — refusing to store a secret in plaintext");
  if (!table || !id || !column) throw new Error("encryptSecret requires table, id and column for AAD binding");
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, k.key, iv);
  cipher.setAAD(aadFor(table, id, column));
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, `v${k.version}`, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(":");
}

/**
 * Decrypt. Throws on tampering, on the wrong row, and on a missing key —
 * an instance misdeployed without its key must scream, not run quietly
 * with dead integrations.
 */
export function decryptSecret(stored, { table, id, column, allowLegacyPlaintext = false } = {}) {
  if (stored === null || stored === undefined || stored === "") return stored;
  if (!isEncrypted(stored)) {
    if (allowLegacyPlaintext) return stored;                  // migration window only
    throw new Error(`Value in ${table}.${column} is not encrypted — run the SEC·A migration`);
  }
  const parts = String(stored).split(":");
  if (parts.length !== 5) throw new Error("Malformed ciphertext");
  const version = Number(parts[1].slice(1));
  const k = availableKeys().find((x) => x.version === version);
  if (!k) throw new Error(`No key configured for ciphertext version v${version} (set PULSE_SECRET_KEY_V${version})`);
  const iv = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const tag = Buffer.from(parts[4], "base64url");
  const d = crypto.createDecipheriv(ALGO, k.key, iv);
  d.setAAD(aadFor(table, id, column));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

/** Masked for display. Never send a decrypted secret to a browser. */
export function maskSecret(stored) {
  if (!stored) return null;
  return isEncrypted(stored) ? "••••••••" : (String(stored).length > 8 ? `••••${String(stored).slice(-4)}` : "••••");
}

// ── Hash what we verify ──────────────────────────────────────────────
/** For high-entropy tokens presented back to us verbatim (magic links). */
export const hashToken = (t) => (t ? crypto.createHash("sha256").update(String(t), "utf8").digest("hex") : t);
export const isHashedToken = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** Timing-safe comparison for anything compared by value. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8"), y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// ── Health, for /api/health and the System page ──────────────────────
export function cryptoStatus() {
  const keys = availableKeys();
  return {
    configured: keys.length > 0,
    currentVersion: keys[0]?.version ?? null,
    versionsAvailable: keys.map((k) => k.version),
    algorithm: ALGO,
  };
}

/** Generate a key for the Installer runbook. */
export const generateKey = () => crypto.randomBytes(32).toString("base64");
