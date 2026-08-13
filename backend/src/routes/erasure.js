import crypto from "node:crypto";
import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { sendMail } from "../mail.js";
import { hashToken } from "../crypto.js";
import { discover, executeErasure, exportSubject, replayErasures, PII_MAP } from "../erasure.js";

// ═══ SEC·C · THE ERASURE WORKFLOW ═════════════════════════════════════
// RECEIVED → VERIFIED → DISCOVERED → PENDING_APPROVAL → EXECUTED → CONFIRMED
// Any state may be REJECTED with a recorded reason.

export const ERASURE_FLOW = {
  RECEIVED:         ["VERIFIED", "REJECTED"],
  VERIFIED:         ["DISCOVERED", "REJECTED"],
  DISCOVERED:       ["PENDING_APPROVAL", "REJECTED"],
  PENDING_APPROVAL: ["EXECUTED", "REJECTED"],
  EXECUTED:         ["CONFIRMED", "REJECTED"],
  CONFIRMED:        [],
  REJECTED:         [],
};

export function erasureTransitionError(from, to) {
  if (!from) return null;
  if (!(from in ERASURE_FLOW) || !(to in ERASURE_FLOW)) return `Unknown erasure status: ${from} → ${to}`;
  if (!ERASURE_FLOW[from].includes(to)) {
    const next = ERASURE_FLOW[from];
    return next.length ? `Invalid transition ${from} → ${to} (allowed: ${next.join(", ")})`
                       : `Invalid transition ${from} → ${to} (${from} is final)`;
  }
  return null;
}

const r = Router();
r.use(requireAuth);
const canRead = requirePerm("leads", "read");

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const shape = (row) => ({ ...row, inventory: parse(row.inventory), certificate: parse(row.certificate), verifyToken: undefined });

r.get("/", canRead, async (_req, res, next) => {
  try {
    const rows = await all(
      `SELECT e.*, u.name AS "requestedByName" FROM erasure_requests e
         LEFT JOIN users u ON u.id = e."requestedById" ORDER BY e."createdAt" DESC LIMIT 100`);
    res.json(rows.map(shape));
  } catch (e) { next(e); }
});

/** The map itself — what Pulse holds about a person, and how it treats it. */
r.get("/map", canRead, (_req, res) => {
  res.json(PII_MAP.map((m) => ({ table: m.table, mode: m.mode, columns: m.columns, keep: m.keep, note: m.note || null })));
});

r.get("/:id", canRead, async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    const log = await all(
      `SELECT "tableName", action, columns, "at" FROM erasure_log WHERE "requestId" = $1 ORDER BY "at"`, [row.id]);
    res.json({ ...shape(row), log });
  } catch (e) { next(e); }
});

/** RECEIVED. A request may name an email, a phone, or both. */
r.post("/", requirePerm("leads", "write"), async (req, res, next) => {
  try {
    const { subjectEmail, subjectPhone, subjectNote, kind } = req.body || {};
    if (!subjectEmail && !subjectPhone) return res.status(400).json({ error: "A request needs an email address or a phone number" });
    const row = await get(
      `INSERT INTO erasure_requests (kind, "subjectEmail", "subjectPhone", "subjectNote", "requestedById")
       VALUES (COALESCE($1,'ERASURE'),$2,$3,$4,$5) RETURNING *`,
      [kind || null, subjectEmail || null, subjectPhone || null, subjectNote || null, req.user.id]);
    logAudit(req, "erasure.received", "erasure_requests", row.id, { kind: row.kind });
    res.status(201).json(shape(row));
  } catch (e) { next(e); }
});

/**
 * VERIFIED. Identity is confirmed either by the subject following a link
 * sent to their own address, or by an administrator asserting it — and
 * which of the two is recorded, because they are not the same evidence.
 */
r.post("/:id/verify/send", requirePerm("leads", "write"), async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    const err = erasureTransitionError(row.status, "VERIFIED");
    if (err) return res.status(400).json({ error: err });
    if (!row.subjectEmail) return res.status(400).json({ error: "This request has no email address to confirm to" });
    const token = crypto.randomBytes(24).toString("base64url");
    await run(`UPDATE erasure_requests SET "verifyToken" = $2, "updatedAt" = now() WHERE id = $1`, [row.id, hashToken(token)]);
    const link = `${(process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || "").replace(/\/$/, "")}/privacy/confirm/${row.id}/${token}`;
    await sendMail({
      to: row.subjectEmail,
      subject: row.kind === "EXPORT" ? "Confirm your data request" : "Confirm your erasure request",
      html: `<p>We received a request about your personal data. Confirm it was you:</p><p><a href="${link}">${link}</a></p>
             <p>If you did not make this request, ignore this message and nothing will change.</p>`,
    }).catch(() => {});
    logAudit(req, "erasure.verifySent", "erasure_requests", row.id, {});
    res.json({ ok: true, sentTo: row.subjectEmail, confirmPath: `/privacy/confirm/${row.id}/${token}` });
  } catch (e) { next(e); }
});

/** An administrator may verify identity out of band; it is recorded as such. */
r.post("/:id/verify/manual", requireAdmin, async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    const err = erasureTransitionError(row.status, "VERIFIED");
    if (err) return res.status(400).json({ error: err });
    if (!req.body?.evidence) return res.status(400).json({ error: "Record how identity was established" });
    await run(
      `UPDATE erasure_requests SET status = 'VERIFIED', "verifiedAt" = now(), "verifiedBy" = 'ADMIN',
         "subjectNote" = COALESCE("subjectNote",'') || $2, "updatedAt" = now() WHERE id = $1`,
      [row.id, `\n[identity verified by admin] ${String(req.body.evidence).slice(0, 300)}`]);
    logAudit(req, "erasure.verifiedManually", "erasure_requests", row.id, {});
    res.json(shape(await get(`SELECT * FROM erasure_requests WHERE id = $1`, [row.id])));
  } catch (e) { next(e); }
});

/** DISCOVERED. The inventory an approver actually reads before deciding. */
r.post("/:id/discover", requirePerm("leads", "write"), async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    const err = erasureTransitionError(row.status, "DISCOVERED");
    if (err) return res.status(400).json({ error: err });
    const inventory = await discover({ email: row.subjectEmail, phone: row.subjectPhone });
    if (inventory.total === 0) {
      await run(`UPDATE erasure_requests SET status = 'REJECTED', "rejectReason" = 'NOT_FOUND',
                 inventory = $2::jsonb, "updatedAt" = now() WHERE id = $1`, [row.id, JSON.stringify(inventory)]);
      return res.json({ ...shape(await get(`SELECT * FROM erasure_requests WHERE id = $1`, [row.id])),
        message: "Nothing found for that person — the request is closed as NOT_FOUND." });
    }
    await run(`UPDATE erasure_requests SET status = 'DISCOVERED', inventory = $2::jsonb, "updatedAt" = now() WHERE id = $1`,
      [row.id, JSON.stringify(inventory)]);
    logAudit(req, "erasure.discovered", "erasure_requests", row.id, { rows: inventory.total });
    res.json(shape(await get(`SELECT * FROM erasure_requests WHERE id = $1`, [row.id])));
  } catch (e) { next(e); }
});

r.post("/:id/submit", requirePerm("leads", "write"), async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    const err = erasureTransitionError(row.status, "PENDING_APPROVAL");
    if (err) return res.status(400).json({ error: err });
    await run(`UPDATE erasure_requests SET status = 'PENDING_APPROVAL', "updatedAt" = now() WHERE id = $1`, [row.id]);
    res.json(shape(await get(`SELECT * FROM erasure_requests WHERE id = $1`, [row.id])));
  } catch (e) { next(e); }
});

/** EXECUTED → CONFIRMED. Administrator only; irreversible. */
r.post("/:id/execute", requireAdmin, async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    const err = erasureTransitionError(row.status, "EXECUTED");
    if (err) return res.status(400).json({ error: err });

    if (row.kind === "EXPORT") {
      const bundle = await exportSubject({ email: row.subjectEmail, phone: row.subjectPhone });
      await run(`UPDATE erasure_requests SET status = 'CONFIRMED', "executedAt" = now(), "confirmedAt" = now(),
                 "approvedById" = $2, certificate = $3::jsonb, "updatedAt" = now() WHERE id = $1`,
        [row.id, req.user.id, JSON.stringify({ kind: "EXPORT", tables: bundle.tableCount, rows: bundle.rowCount, at: bundle.generatedAt })]);
      logAudit(req, "erasure.exported", "erasure_requests", row.id, { rows: bundle.rowCount });
      return res.json({ ...shape(await get(`SELECT * FROM erasure_requests WHERE id = $1`, [row.id])), bundle });
    }

    const report = await executeErasure(row);
    await run(`UPDATE erasure_requests SET status = 'EXECUTED', "executedAt" = now(), "approvedById" = $2, "updatedAt" = now() WHERE id = $1`,
      [row.id, req.user.id]);

    // ── The gate with teeth ──
    // Discovery re-runs against the same engine that found the data. Only
    // when it returns nothing does the request confirm. Erasure is
    // verified, not trusted.
    const after = await discover({ email: row.subjectEmail, phone: row.subjectPhone });
    const legalOnly = after.tables.every((t) => t.rows === 0 ||
      PII_MAP.find((m) => m.table === t.table)?.mode === "retain_legal");
    const clean = after.total === 0 || legalOnly;

    const certificate = {
      kind: "ERASURE", subject: { email: row.subjectEmail, phone: row.subjectPhone },
      executedAt: new Date().toISOString(), operator: req.user.email || req.user.id,
      anonymised: report.anonymised, redacted: report.redacted, retained: report.retained,
      tables: report.tables,
      residual: after.tables.filter((t) => t.rows > 0).map((t) => ({
        table: t.table, rows: t.rows,
        basis: PII_MAP.find((m) => m.table === t.table)?.note || "retained under statutory obligation" })),
      verifiedByRediscovery: clean,
      freeTextChecklist: "Structured fields are erased mechanically. Notes, attachments and message bodies that mention this person need a human pass — Pulse does not claim to have searched them.",
    };
    if (clean) {
      await run(`UPDATE erasure_requests SET status = 'CONFIRMED', "confirmedAt" = now(), certificate = $2::jsonb,
                 "updatedAt" = now() WHERE id = $1`, [row.id, JSON.stringify(certificate)]);
    } else {
      await run(`UPDATE erasure_requests SET certificate = $2::jsonb, "updatedAt" = now() WHERE id = $1`,
        [row.id, JSON.stringify(certificate)]);
    }
    logAudit(req, "erasure.executed", "erasure_requests", row.id, { anonymised: report.anonymised, confirmed: clean });
    res.json({ ...shape(await get(`SELECT * FROM erasure_requests WHERE id = $1`, [row.id])), report, rediscovery: after });
  } catch (e) { next(e); }
});

r.post("/:id/reject", requirePerm("leads", "write"), async (req, res, next) => {
  try {
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Request not found" });
    const reason = req.body?.reason;
    if (!["IDENTITY_UNVERIFIED", "LEGAL_HOLD", "DUPLICATE", "NOT_FOUND"].includes(reason)) {
      return res.status(400).json({ error: "reason must be IDENTITY_UNVERIFIED, LEGAL_HOLD, DUPLICATE or NOT_FOUND" });
    }
    const err = erasureTransitionError(row.status, "REJECTED");
    if (err) return res.status(400).json({ error: err });
    await run(`UPDATE erasure_requests SET status = 'REJECTED', "rejectReason" = $2, "updatedAt" = now() WHERE id = $1`,
      [row.id, reason]);
    logAudit(req, "erasure.rejected", "erasure_requests", row.id, { reason });
    res.json(shape(await get(`SELECT * FROM erasure_requests WHERE id = $1`, [row.id])));
  } catch (e) { next(e); }
});

/** Replay after a restore from backup. */
r.post("/replay", requireAdmin, async (req, res, next) => {
  try {
    const out = await replayErasures();
    logAudit(req, "erasure.replay", "erasure_requests", null, out);
    res.json(out);
  } catch (e) { next(e); }
});

export default r;

// ── The subject's own confirmation link ──────────────────────────────
export const privacyPublicRouter = Router();

privacyPublicRouter.get("/confirm/:id/:token", async (req, res, next) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(404).json({ error: "Invalid or expired confirmation link" });
    }
    const row = await get(`SELECT * FROM erasure_requests WHERE id = $1`, [req.params.id]);
    if (!row || !row.verifyToken) return res.status(404).json({ error: "Invalid or expired confirmation link" });
    if (row.verifyToken !== hashToken(req.params.token)) return res.status(404).json({ error: "Invalid or expired confirmation link" });
    if (erasureTransitionError(row.status, "VERIFIED")) return res.json({ ok: true, alreadyConfirmed: true });
    await run(
      `UPDATE erasure_requests SET status = 'VERIFIED', "verifiedAt" = now(), "verifiedBy" = 'SUBJECT',
         "verifyToken" = NULL, "updatedAt" = now() WHERE id = $1`, [row.id]);
    res.json({ ok: true, message: "Thank you — your request is confirmed and will be actioned." });
  } catch (e) { next(e); }
});
