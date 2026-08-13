import { createHash } from "node:crypto";
import { all, get, transaction } from "./db.js";

// ═══ SEC·D · TAMPER-EVIDENT GOVERNANCE TRAIL ═════════════════════════
// Every audit row extends a hash chain: rowHash = sha256(prevHash |
// actor | action | entity | entityId | canonical(meta)). Appends are
// serialized with a Postgres transaction-level advisory lock, so concurrent
// serverless instances cannot read the same tail and fork the chain.
// The table itself is append-only via trigger; the chain detects what
// the trigger cannot, and vice versa. createdAt sits outside the hash
// (DB-assigned after the fact) — its integrity rests on the trigger.

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** Deterministic JSON: keys sorted recursively, so the hash survives jsonb round-trips. */
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

export const GENESIS = "GENESIS";

export function chainInput({ prevHash, actorId, actorName, action, entity, entityId, metaCanon }) {
  return [prevHash, actorId || "", actorName || "", action, entity, entityId || "", metaCanon || ""].join("|");
}

function append(row) {
  return transaction(async (tx) => {
    await tx.run(`SELECT pg_advisory_xact_lock($1::bigint)`, [1347769165]);
    const prev = await tx.get(`SELECT "rowHash" FROM audit_log WHERE "rowHash" IS NOT NULL ORDER BY seq DESC LIMIT 1`);
    const prevHash = prev?.rowHash || GENESIS;
    const rowHash = sha256(chainInput({ prevHash, ...row }));
    await tx.run(
      `INSERT INTO audit_log ("actorId", "actorName", action, entity, "entityId", meta, "prevHash", "rowHash")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.actorId, row.actorName, row.action, row.entity, row.entityId, row.metaCanon, prevHash, rowHash]
    );
  }).catch(() => { /* audit must never break the operation (e.g. pre-migration DB) */ });
}

/** Fire-and-forget governance trail. Never blocks or fails the request. */
export async function logAudit(req, action, entity, entityId = null, meta = null) {
  await append({
    actorId: req.user?.id || null,
    actorName: req.user?.name || "system",
    action, entity,
    entityId: entityId ? String(entityId) : null,
    metaCanon: meta ? stableStringify(meta) : null,
  });
}

/**
 * SEC·D — the trail's ONLY other door. Actions with no req (client
 * portal, schedulers) ride the same chain through the same database lock, so
 * "legacy" can honestly mean pre-migration rows and nothing else.
 */
export async function logAuditSystem({ actorId = null, actorName = "system", action, entity, entityId = null, meta = null }) {
  await append({
    actorId, actorName, action, entity,
    entityId: entityId ? String(entityId) : null,
    metaCanon: meta ? stableStringify(meta) : null,
  });
}

/**
 * Walk the chain. Pre-chain rows (no rowHash) are counted as legacy and
 * declared — never silently blessed. Returns the first break, if any.
 */
export async function verifyAuditChain() {
  const legacy = await get(`SELECT COUNT(*)::int AS c FROM audit_log WHERE "rowHash" IS NULL`);
  const rows = await all(
    `SELECT seq, "actorId", "actorName", action, entity, "entityId", meta, "prevHash", "rowHash"
     FROM audit_log WHERE "rowHash" IS NOT NULL ORDER BY seq ASC`);
  let prevHash = GENESIS, lastSeq = -1;
  for (const r of rows) {
    const seq = Number(r.seq);
    const metaCanon = r.meta == null ? null
      : stableStringify(typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta);
    const expect = sha256(chainInput({
      prevHash, actorId: r.actorId, actorName: r.actorName, action: r.action,
      entity: r.entity, entityId: r.entityId, metaCanon,
    }));
    if (r.prevHash !== prevHash || r.rowHash !== expect || seq <= lastSeq) {
      return { ok: false, checked: rows.length, legacyRows: legacy.c, firstBreakSeq: seq };
    }
    prevHash = r.rowHash; lastSeq = seq;
  }
  return { ok: true, checked: rows.length, legacyRows: legacy.c, firstBreakSeq: null };
}
