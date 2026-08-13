import crypto from "crypto";
import { all, get, run } from "./db.js";

// ═══ OBSERVABILITY (Wave 3·A) ════════════════════════════════════════
// Until now an error reached console.error and stopped there — which on a
// serverless host means it is gone before anyone asks about it. This is
// the difference between "it broke this morning" and an answer.

export const RETAIN_DAYS = 90;

/** Group the same fault together: route + the stable part of the message. */
export function fingerprintOf(route = "", message = "") {
  const stable = String(message)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/["'`].*?["'`]/g, "<str>")
    .slice(0, 120);
  return crypto.createHash("sha256").update(`${route}|${stable}`).digest("hex").slice(0, 16);
}

/**
 * A digest of the request body — its shape and a hash, never its contents.
 * Enough to tell "the same malformed payload again" from "a new one".
 */
export function digestOf(body) {
  if (!body || typeof body !== "object") return null;
  const keys = Object.keys(body).sort().slice(0, 20);
  const hash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  return `${keys.length} field(s): ${keys.join(",").slice(0, 160)} · ${hash}`;
}

export const newRequestId = () => crypto.randomBytes(6).toString("hex");

/** Record a fault. Never throws — a logger that can break a request is worse than none. */
export async function recordError({ level = "ERROR", route, method, status, message, stack,
                                    userId, requestId, userAgent, payloadDigest }) {
  try {
    await run(
      `INSERT INTO error_log (level, fingerprint, route, method, status, message, stack,
         "userId", "requestId", "userAgent", "payloadDigest")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [level, fingerprintOf(route, message), route ? String(route).slice(0, 200) : null,
       method || null, status || null, String(message || "unknown").slice(0, 500),
       stack ? String(stack).slice(0, 4000) : null, userId || null, requestId || null,
       userAgent ? String(userAgent).slice(0, 200) : null, payloadDigest || null]);
  } catch { /* observability must never become the outage */ }
}

/** Faults grouped by fingerprint — one recurring bug reads as one row. */
export async function errorSummary({ days = 7, limit = 40 } = {}) {
  return await all(
    `SELECT fingerprint, level, route, method,
            MAX(message) AS message, COUNT(*)::int AS count,
            MAX(at) AS "lastSeen", MIN(at) AS "firstSeen"
     FROM error_log WHERE at >= now() - ($1 || ' days')::interval
     GROUP BY fingerprint, level, route, method
     ORDER BY MAX(at) DESC LIMIT ${Number(limit)}`, [String(days)]);
}

/** Is this instance actually well? The question a status check must answer. */
export async function healthReport() {
  const out = { ok: true, at: new Date().toISOString(), checks: {} };

  try {
    await get(`SELECT 1 AS ok`);
    out.checks.database = { ok: true };
  } catch (e) {
    out.ok = false;
    out.checks.database = { ok: false, error: String(e.message).slice(0, 200) };
    return out;                                    // nothing else is knowable without the DB
  }

  // SEC·A: an instance holding encrypted secrets without its key is
  // misdeployed and must say so loudly rather than run with silently
  // dead integrations.
  try {
    const { cryptoStatus } = await import("./crypto.js");
    const { plaintextAudit } = await import("./secrets.js");
    const cs = cryptoStatus();
    const audit = await plaintextAudit();
    const unprotected = audit.reduce((n, r) => n + r.plaintext, 0);
    const holdsSecrets = audit.reduce((n, r) => n + r.total, 0) > 0;
    out.checks.crypto = {
      ok: cs.configured || !holdsSecrets,
      configured: cs.configured, keyVersion: cs.currentVersion,
      unprotectedValues: unprotected,
      note: cs.configured ? null : (holdsSecrets ? "PULSE_SECRET_KEY_V1 is not set but secrets exist" : "no secrets stored yet"),
    };
    if (!out.checks.crypto.ok) out.ok = false;
    if (unprotected > 0) out.checks.crypto.migrationPending = true;
  } catch (e) {
    out.checks.crypto = { ok: false, error: String(e.message).slice(0, 200) };
    out.ok = false;
  }

  const hoursSince = (ts) => (ts ? Math.round((Date.now() - new Date(ts).getTime()) / 36e5) : null);

  const pulse = await get(`SELECT MAX(date) AS d FROM metric_snapshots`).catch(() => null);
  const lastPulse = pulse?.d ? new Date(pulse.d).toISOString().slice(0, 10) : null;
  const pulseAgeDays = pulse?.d ? Math.round((Date.now() - new Date(pulse.d).getTime()) / 864e5) : null;
  out.checks.dailyPulse = { ok: pulseAgeDays !== null && pulseAgeDays <= 2, lastRun: lastPulse, ageDays: pulseAgeDays };
  if (!out.checks.dailyPulse.ok) out.ok = false;

  const tick = await get(
    `SELECT MAX("updatedAt") AS at FROM scheduled_posts WHERE status = 'PUBLISHED'`).catch(() => null);
  out.checks.publishTick = { ok: true, lastPublish: tick?.at || null, hoursAgo: hoursSince(tick?.at) };

  const fails = await get(
    `SELECT COUNT(*)::int c FROM integration_runs WHERE status = 'FAILED' AND at >= now() - interval '24 hours'`)
    .catch(() => ({ c: 0 }));
  out.checks.connectors = { ok: (fails?.c || 0) < 10, failures24h: fails?.c || 0 };

  const errs = await get(
    `SELECT COUNT(*)::int c FROM error_log WHERE level <> 'CLIENT' AND at >= now() - interval '24 hours'`)
    .catch(() => ({ c: 0 }));
  out.checks.errors = { ok: (errs?.c || 0) < 50, last24h: errs?.c || 0 };
  if (!out.checks.errors.ok) out.ok = false;

  const { storageDriver } = await import("./storage.js");
  const st = await get(`SELECT COUNT(*)::int c, COALESCE(SUM(size),0)::bigint b FROM files`).catch(() => null);
  out.checks.storage = { ok: true, driver: storageDriver(), files: st?.c || 0, bytes: Number(st?.b || 0) };

  const mail = await get(
    `SELECT COUNT(*)::int c FROM mail_log WHERE status = 'FAILED' AND "createdAt" >= now() - interval '24 hours'`)
    .catch(() => ({ c: 0 }));
  out.checks.mail = { ok: (mail?.c || 0) < 10, failures24h: mail?.c || 0 };

  return out;
}

/** Nightly: logs that grow forever are how a small Postgres instance dies. */
export async function pruneErrors() {
  // RETURNING keeps the count honest across both drivers — rowCount is not
  // reported consistently by pg and PGlite.
  const r = await run(`DELETE FROM error_log WHERE at < now() - ($1 || ' days')::interval RETURNING id`,
    [String(RETAIN_DAYS)]).catch(() => null);
  return r?.rows?.length ?? 0;
}
