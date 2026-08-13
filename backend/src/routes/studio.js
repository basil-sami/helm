import { Router } from "express";
import { crudRouter } from "../crud.js";
import { all, get } from "../db.js";
import { requestApproval } from "../approvals.js";

// ── STUDIO (Wave 1·A) — the creative side ────────────────────────────
// Intake queue with SLA · deliverable-level briefs · asset versioning
// with approval stamps · the Brand Center · the approved copy bank.

const jsonFix = (...keys) => async (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

// One-step-forward matrix (REVIEW may bounce back for another pass).
const REQ_FLOW = { NEW: ["TRIAGED"], TRIAGED: ["IN_PROGRESS"], IN_PROGRESS: ["REVIEW"], REVIEW: ["DONE", "REJECTED", "IN_PROGRESS"], DONE: [], REJECTED: [] };

export const creativeRequestsRouter = crudRouter({
  table: "creative_requests",
  module: "studio",
  touchUpdatedAt: true,
  fields: ["title", "brief", "kind", "priority", "status", "requesterId", "assigneeId", "campaignId", "dueDate", "slaDueAt"],
  listSql: `SELECT cr.*, ru.name AS "requesterName", au.name AS "assigneeName", c.name AS "campaignName"
            FROM creative_requests cr
            LEFT JOIN users ru ON ru.id = cr."requesterId"
            LEFT JOIN users au ON au.id = cr."assigneeId"
            LEFT JOIN campaigns c ON c.id = cr."campaignId"
            ORDER BY (cr.status IN ('DONE','REJECTED')), cr."slaDueAt" ASC NULLS LAST`,
  validateCreate: async (data, req) => {
    if (!data.requesterId) data.requesterId = req.user.id;
    // The SLA clock starts at intake: due date, or 3 working-ish days by default.
    if (!data.slaDueAt) data.slaDueAt = data.dueDate || new Date(Date.now() + 3 * 864e5).toISOString();
    return null;
  },
  validateUpdate: async (data, prev) => {
    if (data.status && data.status !== prev.status && !(REQ_FLOW[prev.status] || []).includes(data.status)) {
      return `Invalid transition ${prev.status} → ${data.status}`;
    }
    return null;
  },
});

export const creativeBriefsRouter = crudRouter({
  table: "creative_briefs",
  module: "studio",
  fields: ["title", "requestId", "engagementId", "spec", "format", "refs", "dueDate"],
  validateCreate: async (data) => {
    await jsonFix("refs")(data);
    if (!data.requestId && !data.engagementId) return "A brief belongs to a creative request or an engagement";
    return null;
  },
  validateUpdate: jsonFix("refs"),
});

export const copyBankRouter = crudRouter({
  table: "copy_bank",
  module: "studio",
  fields: ["text", "textAr", "kind", "productId", "personaId", "approved"],
  listSql: `SELECT cb.*, p.name AS "productName" FROM copy_bank cb
            LEFT JOIN products p ON p.id = cb."productId" ORDER BY cb.approved DESC, cb."createdAt" DESC`,
});

export const brandAssetsRouter = crudRouter({
  table: "brand_assets",
  module: "studio",
  fields: ["kind", "label", "labelAr", "value", "url", "public", "sort"],
  orderBy: `sort ASC, "createdAt" ASC`,
});

// Asset versions: v1→v2→v3 per asset; REVIEW auto-files an approval.
export const assetVersionsRouter = crudRouter({
  table: "asset_versions",
  module: "studio",
  fields: ["assetId", "version", "url", "note", "status"],
  listSql: `SELECT av.*, a.name AS "assetName", u.name AS "approvedByName"
            FROM asset_versions av
            JOIN assets a ON a.id = av."assetId"
            LEFT JOIN users u ON u.id = av."approvedById"
            ORDER BY a.name, av.version DESC`,
  validateCreate: async (data) => {
    if (!data.assetId) return "assetId is required";
    if (!data.url) return "url is required";
    if (data.status === "APPROVED") return "Approve through the approvals inbox";
    const max = await get(`SELECT COALESCE(MAX(version), 0)::int AS v FROM asset_versions WHERE "assetId" = $1`, [data.assetId]);
    data.version = (max?.v || 0) + 1; // cols snapshot happens after create-hooks — injected fields insert correctly
    return null;
  },
  validateUpdate: async (data, prev) => {
    if (data.status === "APPROVED" && prev.status !== "APPROVED") return "Approve through the approvals inbox";
    return null;
  },
  afterWrite: async (req, _action, id, data) => {
    if (data.status === "REVIEW") {
      await requestApproval({ entity: "asset_versions", entityId: id, requesterId: req.user.id });
    }
  },
});

// PUBLIC · the Brand Center (/brand): only rows explicitly marked public.
export const brandPublicRouter = Router();
brandPublicRouter.get("/", async (_req, res, next) => {
  try {
    res.setHeader("X-Robots-Tag", "noindex");
    const rows = await all(
      `SELECT id, kind, label, "labelAr", value, url, sort FROM brand_assets WHERE public = true ORDER BY sort ASC, "createdAt" ASC`
    );
    const org = await get(`SELECT "orgName", "orgNameAr", "logoUrl", "accentColor" FROM settings WHERE id = 1`);
    res.json({ org, assets: rows });
  } catch (e) { next(e); }
});
