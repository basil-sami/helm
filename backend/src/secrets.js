import { all, get, run } from "./db.js";
import { encryptSecret, decryptSecret, isEncrypted, hashToken, isHashedToken, cryptoReady } from "./crypto.js";

// ═══ SEC·A · THE SECRET REGISTRY & SCANNER ════════════════════════════
// The registry declares how every credential-bearing column is protected.
// SECRET_SCAN reads information_schema at build time and fails when a
// column matching the credential pattern is neither registered here nor
// explicitly exempted with a written reason.
//
// This is the structural half of the promise: a future migration CANNOT
// add a plaintext secret column and have the build pass. The registry is
// deliberately discovered against the live schema rather than trusted
// from memory — the same reasoning as the W4·H table census.

/** Columns holding real secrets, protected by encryption at rest. */
export const ENCRYPTED_COLUMNS = [
  { table: "social_accounts", column: "accessToken",
    why: "Platform API credential — must be read back to call Meta, TikTok, Google and WhatsApp." },
  { table: "users", column: "totpSecret",
    why: "TOTP seed — verification requires the raw secret, so it cannot be hashed." },
  { table: "sso_connections", column: "clientSecret",
    why: "OIDC client secret — presented to the identity provider at token exchange, so it must be read back." },
];

/** Columns protected by hashing, because we only ever compare them. */
export const HASHED_COLUMNS = [
  { table: "users", column: "passwordHash", algo: "bcrypt",
    why: "Password — compared, never read back." },
  { table: "erasure_requests", column: "verifyToken", algo: "sha256",
    why: "Subject confirmation token — presented verbatim in a link, so a hash suffices." },
  { table: "portal_tokens", column: "token", algo: "sha256",
    why: "Guest magic-link token — high entropy and presented verbatim, so a hash suffices and a dump yields no working links." },
];

/**
 * Columns whose NAME matches the credential pattern but which hold no
 * secret. Each needs a written reason; that is the point of the list.
 */
export const EXEMPT_COLUMNS = [
  { table: "users", column: "mustChangePassword", why: "Boolean flag, not a credential." },
  { table: "users", column: "tokenVersion", why: "Integer counter used to invalidate sessions." },
  { table: "social_accounts", column: "tokenExpiresAt", why: "Timestamp, not the token itself." },
  { table: "ai_runs", column: "promptTokens", why: "Model usage count — 'tokens' in the LLM sense." },
  { table: "ai_runs", column: "completionTokens", why: "Model usage count — 'tokens' in the LLM sense." },
];

/** The pattern the scanner sweeps for. Widening it is always safe. */
export const SECRET_NAME_RE = /(token|secret|api_?key|credential|password|passphrase|private_?key)/i;

/**
 * SECRET_SCAN. Returns a list of problems; empty means the schema is clean.
 * `db` is any client exposing .query(sql) — the test harness passes PGlite.
 */
export async function secretScan(query) {
  const rows = (await query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'`)).rows || [];
  const enc = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`));
  const hash = new Set(HASHED_COLUMNS.map((c) => `${c.table}.${c.column}`));
  const exempt = new Set(EXEMPT_COLUMNS.map((c) => `${c.table}.${c.column}`));
  const problems = [];

  for (const r of rows) {
    const key = `${r.table_name}.${r.column_name}`;
    if (!SECRET_NAME_RE.test(r.column_name)) continue;
    if (enc.has(key) || hash.has(key) || exempt.has(key)) continue;
    problems.push({ column: key, type: r.data_type,
      reason: "matches the credential pattern but is neither encrypted, hashed, nor exempted with a reason" });
  }
  // A registry entry pointing at a column that no longer exists is also a
  // defect: it means protection is claimed for something absent.
  const live = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  for (const c of [...ENCRYPTED_COLUMNS, ...HASHED_COLUMNS, ...EXEMPT_COLUMNS]) {
    const key = `${c.table}.${c.column}`;
    if (!live.has(key)) problems.push({ column: key, reason: "registered in the secret registry but absent from the schema" });
  }
  return problems;
}

/** Are any encrypted columns still holding plaintext? */
export async function plaintextAudit() {
  const out = [];
  for (const c of ENCRYPTED_COLUMNS) {
    const rows = await all(
      `SELECT id, "${c.column}" AS v FROM ${c.table} WHERE "${c.column}" IS NOT NULL AND "${c.column}" <> ''`).catch(() => []);
    const plain = rows.filter((r) => !isEncrypted(r.v));
    out.push({ table: c.table, column: c.column, total: rows.length, plaintext: plain.length });
  }
  for (const c of HASHED_COLUMNS.filter((x) => x.algo === "sha256")) {
    const rows = await all(
      `SELECT id, "${c.column}" AS v FROM ${c.table} WHERE "${c.column}" IS NOT NULL`).catch(() => []);
    out.push({ table: c.table, column: c.column, total: rows.length,
      plaintext: rows.filter((r) => !isHashedToken(r.v)).length });
  }
  return out;
}

/**
 * The migration. Idempotent: already-protected values are skipped, so a
 * re-run is safe and a partial run resumes. Every encryption round-trips
 * before the next row is touched — a migration that cannot read back what
 * it wrote is a migration that destroyed data.
 */
export async function migrateSecrets({ dryRun = false } = {}) {
  if (!cryptoReady()) throw new Error("PULSE_SECRET_KEY_V1 is not configured — refusing to run the secret migration");
  const report = { encrypted: 0, hashed: 0, skipped: 0, failed: [], dryRun };

  for (const c of ENCRYPTED_COLUMNS) {
    const rows = await all(
      `SELECT id, "${c.column}" AS v FROM ${c.table} WHERE "${c.column}" IS NOT NULL AND "${c.column}" <> ''`).catch(() => []);
    for (const r of rows) {
      if (isEncrypted(r.v)) { report.skipped++; continue; }
      try {
        const ct = encryptSecret(r.v, { table: c.table, id: r.id, column: c.column });
        const back = decryptSecret(ct, { table: c.table, id: r.id, column: c.column });
        if (back !== r.v) throw new Error("round-trip mismatch");
        if (!dryRun) await run(`UPDATE ${c.table} SET "${c.column}" = $2 WHERE id = $1`, [r.id, ct]);
        report.encrypted++;
      } catch (e) { report.failed.push({ table: c.table, id: r.id, error: e.message }); }
    }
  }

  for (const c of HASHED_COLUMNS.filter((x) => x.algo === "sha256")) {
    const rows = await all(`SELECT id, "${c.column}" AS v FROM ${c.table} WHERE "${c.column}" IS NOT NULL`).catch(() => []);
    for (const r of rows) {
      if (isHashedToken(r.v)) { report.skipped++; continue; }
      // Hashing the STORED value preserves every live magic link: the
      // holder still presents the original, and hash(presented) matches.
      if (!dryRun) await run(`UPDATE ${c.table} SET "${c.column}" = $2 WHERE id = $1`, [r.id, hashToken(r.v)]);
      report.hashed++;
    }
  }
  return report;
}

/** Rotation: decrypt under the old key version, re-encrypt under the newest. */
export async function rotateSecrets() {
  if (!cryptoReady()) throw new Error("No key configured");
  const report = { rotated: 0, alreadyCurrent: 0, failed: [] };
  const { currentKey } = await import("./crypto.js");
  const target = currentKey().version;
  for (const c of ENCRYPTED_COLUMNS) {
    const rows = await all(
      `SELECT id, "${c.column}" AS v FROM ${c.table} WHERE "${c.column}" IS NOT NULL AND "${c.column}" <> ''`).catch(() => []);
    for (const r of rows) {
      if (!isEncrypted(r.v)) continue;
      const version = Number(String(r.v).split(":")[1].slice(1));
      if (version === target) { report.alreadyCurrent++; continue; }
      try {
        const plain = decryptSecret(r.v, { table: c.table, id: r.id, column: c.column });
        const ct = encryptSecret(plain, { table: c.table, id: r.id, column: c.column });
        await run(`UPDATE ${c.table} SET "${c.column}" = $2 WHERE id = $1`, [r.id, ct]);
        report.rotated++;
      } catch (e) { report.failed.push({ table: c.table, id: r.id, error: e.message }); }
    }
  }
  return report;
}

// ── Typed accessors, so callers never touch the columns directly ─────
export async function accountToken(accountId) {
  const row = await get(`SELECT id, "accessToken" FROM social_accounts WHERE id = $1`, [accountId]);
  if (!row?.accessToken) return null;
  return decryptSecret(row.accessToken, { table: "social_accounts", id: row.id, column: "accessToken",
    allowLegacyPlaintext: true });
}

export async function setAccountToken(accountId, plain) {
  const ct = encryptSecret(plain, { table: "social_accounts", id: accountId, column: "accessToken" });
  await run(`UPDATE social_accounts SET "accessToken" = $2 WHERE id = $1`, [accountId, ct]);
  return true;
}

/**
 * Decrypt an account's token at the moment of use.
 * Callers work with the plaintext copy and never write it back — the
 * database keeps the ciphertext. `allowLegacyPlaintext` covers the single
 * deploy between shipping this rail and running the migration.
 */
export function withToken(account) {
  if (!account?.accessToken) return account;
  try {
    return { ...account, accessToken: decryptSecret(account.accessToken, {
      table: "social_accounts", id: account.id, column: "accessToken", allowLegacyPlaintext: true }) };
  } catch (e) {
    const err = new Error(`Stored credential for ${account.platform || "account"} could not be decrypted: ${e.message}`);
    err.code = "SECRET_UNREADABLE";
    throw err;
  }
}
