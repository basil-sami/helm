import { Router } from "express";
import crypto from "node:crypto";
import { crudRouter } from "../crud.js";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { requestApproval } from "../approvals.js";

// ── AGENCY (Wave 1·A) — external vendor management ───────────────────
// Registry + computed scorecards · engagements · deliverables where
// revision rounds become data · the invoice→budget bridge · magic-link
// portal tokens (the actual public surface lives in routes/portal.js).

let rateCache = { v: null, at: 0 };
async function currentRate() {
  if (Date.now() - rateCache.at < 30_000 && rateCache.v) return rateCache.v;
  const row = await get(`SELECT "usdToSdgRate" FROM settings WHERE id = 1`);
  rateCache = { v: row?.usdToSdgRate || null, at: Date.now() };
  return rateCache.v;
}
const jsonFix = (...keys) => async (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

export const vendorsRouter = crudRouter({
  table: "vendors",
  module: "agency",
  fields: ["name", "kind", "phone", "email", "contacts", "rateCard", "notes", "active"],
  validateCreate: jsonFix("contacts", "rateCard"),
  validateUpdate: jsonFix("contacts", "rateCard"),
  orderBy: `active DESC, "createdAt" DESC`,
});

// Computed scorecard: the numbers a GM actually asks about a vendor.
export const vendorScorecardRouter = Router();
vendorScorecardRouter.use(requireAuth, requirePerm("agency", "read"));
vendorScorecardRouter.get("/:id/scorecard", async (req, res, next) => {
  try {
    const vid = req.params.id;
    const [deliv, spend, engs] = await Promise.all([
      get(`SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE d.status = 'APPROVED')::int AS approved,
                  COUNT(*) FILTER (WHERE d.status = 'APPROVED' AND d."dueDate" IS NOT NULL AND d."approvedAt" <= d."dueDate")::int AS "onTime",
                  COUNT(*) FILTER (WHERE d.status NOT IN ('APPROVED'))::int AS open,
                  COALESCE(AVG(d."revisionCount") FILTER (WHERE d.status = 'APPROVED'), 0)::float8 AS "avgRevisions"
           FROM deliverables d JOIN engagements e ON e.id = d."engagementId" WHERE e."vendorId" = $1`, [vid]),
      get(`SELECT COALESCE(SUM("amountUsd") FILTER (WHERE status IN ('APPROVED','PAID')), 0)::float8 AS "approvedUsd",
                  COUNT(*)::int AS invoices
           FROM invoices WHERE "vendorId" = $1`, [vid]),
      get(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active
           FROM engagements WHERE "vendorId" = $1`, [vid]),
    ]);
    res.json({
      deliverables: {
        total: deliv.total, approved: deliv.approved, open: deliv.open,
        onTimeRate: deliv.approved ? Math.round((deliv.onTime / deliv.approved) * 100) : null,
        avgRevisions: Math.round(deliv.avgRevisions * 10) / 10,
        approvalRate: deliv.total ? Math.round((deliv.approved / deliv.total) * 100) : null,
      },
      spend: { approvedUsd: spend.approvedUsd, invoices: spend.invoices },
      engagements: engs,
    });
  } catch (e) { next(e); }
});

export const engagementsRouter = crudRouter({
  table: "engagements",
  module: "agency",
  fields: ["vendorId", "title", "scope", "campaignIds", "feeUsd", "rateAtEntry", "startDate", "endDate", "status", "ownerId"],
  listSql: `SELECT e.*, v.name AS "vendorName", u.name AS "ownerName"
            FROM engagements e JOIN vendors v ON v.id = e."vendorId"
            LEFT JOIN users u ON u.id = e."ownerId" ORDER BY e."createdAt" DESC`,
  validateCreate: async (data, req) => {
    await jsonFix("campaignIds")(data);
    if (data.rateAtEntry === undefined) data.rateAtEntry = await currentRate();
    if (!data.ownerId) data.ownerId = req.user.id; // internal accountability — the sweep chases this person
    return null;
  },
  validateUpdate: jsonFix("campaignIds"),
});

// BRIEFED→IN_PROGRESS→SUBMITTED→IN_REVIEW→(APPROVED|REVISION); REVISION→IN_PROGRESS reworks.
const DELIV_FLOW = {
  BRIEFED: ["IN_PROGRESS"], IN_PROGRESS: ["SUBMITTED"], SUBMITTED: ["IN_REVIEW"],
  IN_REVIEW: [], REVISION: ["IN_PROGRESS", "SUBMITTED"], APPROVED: [],
};

export const deliverablesRouter = crudRouter({
  table: "deliverables",
  module: "agency",
  touchUpdatedAt: true,
  fields: ["engagementId", "title", "briefId", "dueDate", "status", "submittedUrl"],
  listSql: `SELECT d.*, e.title AS "engagementTitle", e."vendorId", v.name AS "vendorName", b.title AS "briefTitle"
            FROM deliverables d
            JOIN engagements e ON e.id = d."engagementId"
            JOIN vendors v ON v.id = e."vendorId"
            LEFT JOIN creative_briefs b ON b.id = d."briefId"
            ORDER BY (d.status = 'APPROVED'), d."dueDate" ASC NULLS LAST`,
  validateCreate: async (data) => (!data.engagementId ? "engagementId is required" : null),
  validateUpdate: async (data, prev) => {
    if (data.status === "APPROVED" || data.status === "REVISION") return "Decide through the approvals inbox";
    if (data.status && data.status !== prev.status && !(DELIV_FLOW[prev.status] || []).includes(data.status)) {
      return `Invalid transition ${prev.status} → ${data.status}`;
    }
    return null;
  },
  afterWrite: async (req, _action, id, data, prev) => {
    // Any path into SUBMITTED (internal or portal) stamps the clock + files the review.
    if (data.status === "SUBMITTED" && prev?.status !== "SUBMITTED") {
      await run(`UPDATE deliverables SET "submittedAt" = now() WHERE id = $1 AND "submittedAt" IS NULL`, [id]);
      await requestApproval({ entity: "deliverables", entityId: id, requesterId: req.user.id });
    }
  },
});

// The shared feedback thread (internal side; the portal writes VENDOR rows).
export const deliverableCommentsRouter = Router();
deliverableCommentsRouter.use(requireAuth, requirePerm("agency", "read"));
deliverableCommentsRouter.get("/:id/comments", async (req, res, next) => {
  try {
    res.json(await all(`SELECT * FROM deliverable_comments WHERE "deliverableId" = $1 ORDER BY "createdAt" ASC`, [req.params.id]));
  } catch (e) { next(e); }
});
deliverableCommentsRouter.post("/:id/comments", requirePerm("agency", "write"), async (req, res, next) => {
  try {
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "body is required" });
    const r = await get(
      `INSERT INTO deliverable_comments ("deliverableId", author, "authorName", body) VALUES ($1,'INTERNAL',$2,$3) RETURNING *`,
      [req.params.id, req.user.name, body.slice(0, 4000)]
    );
    logAudit(req, "deliverable_comments.create", "deliverables", req.params.id);
    res.status(201).json(r);
  } catch (e) { next(e); }
});

export const invoicesRouter = crudRouter({
  table: "invoices",
  module: "agency",
  fields: ["vendorId", "engagementId", "number", "amountUsd", "rateAtEntry", "campaignId", "status"],
  listSql: `SELECT i.*, v.name AS "vendorName", e.title AS "engagementTitle"
            FROM invoices i JOIN vendors v ON v.id = i."vendorId"
            LEFT JOIN engagements e ON e.id = i."engagementId" ORDER BY i."createdAt" DESC`,
  validateCreate: async (data, req) => {
    if (!data.vendorId) return "vendorId is required";
    if (!data.number) return "number is required";
    if (data.status && data.status !== "RECEIVED") return "New invoices start as RECEIVED";
    if (data.rateAtEntry === undefined) data.rateAtEntry = await currentRate();
    return null;
  },
  validateUpdate: async (data, prev) => {
    if (data.status === "APPROVED" && prev.status !== "APPROVED") return "Approve through the approvals inbox";
    if (data.status === "PAID" && prev.status !== "APPROVED" && prev.status !== "PAID") return "Only approved invoices can be paid";
    return null;
  },
  afterWrite: async (req, action, id, data, prev) => {
    if (action === "create") {
      await requestApproval({ entity: "invoices", entityId: id, requesterId: req.user.id });
    }
    if (data.status === "PAID" && prev?.status !== "PAID") {
      await run(`UPDATE invoices SET "paidAt" = now() WHERE id = $1 AND "paidAt" IS NULL`, [id]);
    }
  },
});

// ── Portal tokens: mint, list, revoke (≥128-bit, expiring, audited) ──
export const portalTokensRouter = Router();
portalTokensRouter.use(requireAuth, requirePerm("agency", "write"));

portalTokensRouter.get("/", async (req, res, next) => {
  try {
    const vid = req.query.vendorId || null;
    const rows = await all(
      `SELECT t.*, v.name AS "vendorName" FROM portal_tokens t JOIN vendors v ON v.id = t."vendorId"
       WHERE ($1::uuid IS NULL OR t."vendorId" = $1) ORDER BY t."createdAt" DESC`, [vid]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

portalTokensRouter.post("/", async (req, res, next) => {
  try {
    const { vendorId } = req.body || {};
    if (!vendorId) return res.status(400).json({ error: "vendorId is required" });
    const vendor = await get(`SELECT id FROM vendors WHERE id = $1`, [vendorId]);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    const days = Math.min(365, Math.max(1, parseInt(req.body.days, 10) || 30));
    const token = crypto.randomBytes(24).toString("base64url"); // 192 bits
    const r = await get(
      `INSERT INTO portal_tokens ("vendorId", token, "expiresAt", "createdById")
       VALUES ($1, $2, now() + ($3 || ' days')::interval, $4) RETURNING *`,
      [vendorId, token, String(days), req.user.id]
    );
    logAudit(req, "portal_tokens.create", "vendors", vendorId, { days });
    res.status(201).json({ ...r, link: `/p/${token}` });
  } catch (e) { next(e); }
});

portalTokensRouter.post("/:id/revoke", async (req, res, next) => {
  try {
    await run(`UPDATE portal_tokens SET revoked = true WHERE id = $1`, [req.params.id]);
    logAudit(req, "portal_tokens.revoke", "portal_tokens", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
