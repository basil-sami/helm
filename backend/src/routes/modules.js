import { crudRouter } from "../crud.js";
import { notify } from "../notify.js";
import { logActivity } from "../leadlog.js";
import { get, run } from "../db.js";

const ENUMS = {
  campaignStatus: ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED"],
  channel: ["SOCIAL", "PAID", "EVENT", "PR", "EMAIL", "WEB", "BTL"],
  contentStatus: ["IDEA", "IN_PROGRESS", "REVIEW", "APPROVED", "PUBLISHED"],
  leadStage: ["NEW", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"],
  eventStatus: ["PLANNED", "CONFIRMED", "RUNNING", "DONE", "CANCELLED"],
  entryKind: ["PLANNED", "SPENT"],
  taskStatus: ["TODO", "DOING", "DONE"],
  priority: ["LOW", "MEDIUM", "HIGH"],
};
const inSet = (val, set, label) =>
  val === undefined || val === null || set.includes(val) ? null : `Invalid ${label}: ${val}`;

export const campaignsRouter = crudRouter({
  table: "campaigns",
  module: "campaigns",
  validateUpdate: async (data, prev) => {
    if (data.status === "ACTIVE" && prev && prev.status !== "ACTIVE") {
      const brief = await get(`SELECT 1 FROM campaign_briefs WHERE "campaignId" = $1`, [prev.id]);
      if (!brief) return "A campaign brief is required before activation (open the campaign → Brief)";
    }
    return null;
  },
  fields: ["name", "nameAr", "objective", "status", "channel", "startDate", "endDate", "budgetUsd", "budgetSdg", "businessUnit", "ownerId"],
  listSql: `SELECT c.*, u.name AS "ownerName", u.role AS "ownerRole",
              (SELECT COUNT(*)::int FROM leads l WHERE l."campaignId" = c.id) AS "leadCount"
            FROM campaigns c LEFT JOIN users u ON u.id = c."ownerId" ORDER BY c."createdAt" DESC`,
  getSql: `SELECT c.*, u.name AS "ownerName", u.role AS "ownerRole"
           FROM campaigns c LEFT JOIN users u ON u.id = c."ownerId" WHERE c.id = $1`,
  validate: (d) => inSet(d.status, ENUMS.campaignStatus, "status") || inSet(d.channel, ENUMS.channel, "channel"),
});

export const contentRouter = crudRouter({
  table: "content_items",
  module: "content",
  validateUpdate: async (data, prev) => {
    if (data.status === undefined || !prev || data.status === prev.status) return null;
    const jump = C_ORDER.indexOf(data.status) - C_ORDER.indexOf(prev.status);
    if (jump > 1) return `Invalid transition ${prev.status} → ${data.status} (one step forward at a time)`;
    return null;
  },
  fields: ["title", "titleAr", "channel", "status", "scheduledAt", "notes", "campaignId", "authorId", "personaId", "productId", "pillar"],
  listSql: `SELECT ci.*, c.name AS "campaignName", u.name AS "authorName"
            FROM content_items ci LEFT JOIN campaigns c ON c.id = ci."campaignId"
            LEFT JOIN users u ON u.id = ci."authorId" ORDER BY ci."scheduledAt" ASC NULLS LAST`,
  getSql: `SELECT ci.*, c.name AS "campaignName", u.name AS "authorName"
           FROM content_items ci LEFT JOIN campaigns c ON c.id = ci."campaignId"
           LEFT JOIN users u ON u.id = ci."authorId" WHERE ci.id = $1`,
  validate: (d) => inSet(d.status, ENUMS.contentStatus, "status") || inSet(d.channel, ENUMS.channel, "channel"),
});

export const leadsRouter = crudRouter({
  table: "leads",
  module: "leads",
  validateCreate: async (data) => { if (data.rateAtEntry === undefined) data.rateAtEntry = await currentRate(); return null; },
  afterWrite: async (req, action, id, data, prev) => {
    if (action === "create") {
      logActivity(req, id, "CREATED", null, { stage: data.stage || "NEW" });
      if (data.stage === "WON") {
        const s = await get(`SELECT "customerReviewDays" FROM settings WHERE id = 1`);
        const days = s?.customerReviewDays || 90;
        await run(`INSERT INTO customers ("leadId", company, "businessUnit", "totalValueUsd", status, "accountOwnerId", "firstWonAt", "nextReviewAt")
          VALUES ($1,$2,$3,$4,'ACTIVE',$5,now(),now() + $6::int * interval '1 day')
          ON CONFLICT DO NOTHING`, [id, data.company, data.businessUnit, data.valueUsd || 0, data.ownerId, days]);
      }
      return;
    }
    if (action === "update") {
      if (data.stage !== undefined && prev && data.stage !== prev.stage) {
        logActivity(req, id, "STAGE", null, { from: prev.stage, to: data.stage });
        if (data.stage === "WON" && prev.stage !== "WON") {
          const s = await get(`SELECT "customerReviewDays" FROM settings WHERE id = 1`);
          const days = s?.customerReviewDays || 90;
          await run(`INSERT INTO customers ("leadId", company, "businessUnit", "totalValueUsd", status, "accountOwnerId", "firstWonAt", "nextReviewAt")
            VALUES ($1,$2,$3,$4,'ACTIVE',$5,now(),now() + $6::int * interval '1 day')
            ON CONFLICT DO NOTHING`, [id, prev.company, prev.businessUnit, prev.valueUsd || 0, prev.ownerId, days]);
        }
      }
      const customer = await get(`SELECT id FROM customers WHERE "leadId" = $1`, [id]);
      if (customer) {
        const sync = {};
        if (data.company !== undefined) sync.company = data.company;
        if (data.businessUnit !== undefined) sync.businessUnit = data.businessUnit;
        if (data.valueUsd !== undefined) sync.totalValueUsd = data.valueUsd;
        if (data.ownerId !== undefined) sync.accountOwnerId = data.ownerId;
        const keys = Object.keys(sync);
        if (keys.length) {
          const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
          await run(`UPDATE customers SET ${sets} WHERE id = $${keys.length + 1}`, [...keys.map((k) => sync[k]), customer.id]).catch(() => {});
        }
      }
    }
  },
  beforeDelete: async (req, id) => {
    const customer = await get(`SELECT id FROM customers WHERE "leadId" = $1`, [id]);
    if (customer) {
      await run(`UPDATE customers SET status = 'CHURNED' WHERE id = $1`, [customer.id]).catch(() => {});
    }
  },
  fields: ["company", "contactName", "phone", "email", "source", "businessUnit", "stage", "valueUsd", "valueSdg", "notes", "campaignId", "ownerId", "productId", "rateAtEntry"],
  touchUpdatedAt: true,
  listSql: `SELECT l.*, u.name AS "ownerName", c.name AS "campaignName" FROM leads l LEFT JOIN users u ON u.id = l."ownerId" LEFT JOIN campaigns c ON c.id = l."campaignId" ORDER BY l."updatedAt" DESC`,
  getSql: `SELECT l.*, u.name AS "ownerName", c.name AS "campaignName" FROM leads l LEFT JOIN users u ON u.id = l."ownerId" LEFT JOIN campaigns c ON c.id = l."campaignId" WHERE l.id = $1`,
  validate: (d) => inSet(d.stage, ENUMS.leadStage, "stage"),
});

export const eventsRouter = crudRouter({
  table: "events",
  module: "events",
  fields: ["name", "nameAr", "type", "venue", "city", "startDate", "endDate", "status", "budgetUsd", "budgetSdg", "ownerId"],
  listSql: `SELECT e.*, u.name AS "ownerName" FROM events e LEFT JOIN users u ON u.id = e."ownerId" ORDER BY e."startDate" ASC NULLS LAST`,
  getSql: `SELECT e.*, u.name AS "ownerName" FROM events e LEFT JOIN users u ON u.id = e."ownerId" WHERE e.id = $1`,
  validate: (d) => inSet(d.status, ENUMS.eventStatus, "status"),
});

export const budgetRouter = crudRouter({
  table: "budget_entries",
  module: "budget",
  validateCreate: async (data) => { if (data.rateAtEntry === undefined) data.rateAtEntry = await currentRate(); return null; },
  fields: ["label", "kind", "channel", "amountUsd", "amountSdg", "date", "campaignId", "rateAtEntry"],
  orderBy: '"date" DESC',
  listSql: `SELECT b.*, c.name AS "campaignName" FROM budget_entries b LEFT JOIN campaigns c ON c.id = b."campaignId" ORDER BY b.date DESC`,
  getSql: `SELECT b.*, c.name AS "campaignName" FROM budget_entries b LEFT JOIN campaigns c ON c.id = b."campaignId" WHERE b.id = $1`,
  validate: (d) => inSet(d.kind, ENUMS.entryKind, "kind") || inSet(d.channel, ENUMS.channel, "channel"),
});

export const tasksRouter = crudRouter({
  table: "tasks",
  module: "tasks",
  afterWrite: async (req, action, id, data, prev) => {
    const assignee = data.assigneeId;
    const changed = action === "create" ? !!assignee : assignee !== undefined && assignee !== prev?.assigneeId;
    if (assignee && changed && assignee !== req.user.id) {
      notify([assignee], "TASK_ASSIGNED", { title: data.title || prev?.title || "" }, "/tasks");
    }
  },
  fields: ["title", "status", "priority", "dueDate", "assigneeId", "campaignId", "leadId"],
  listSql: `SELECT t.*, u.name AS "assigneeName", c.name AS "campaignName"
            FROM tasks t LEFT JOIN users u ON u.id = t."assigneeId"
            LEFT JOIN campaigns c ON c.id = t."campaignId" ORDER BY t."createdAt" DESC`,
  getSql: `SELECT t.*, u.name AS "assigneeName", c.name AS "campaignName"
           FROM tasks t LEFT JOIN users u ON u.id = t."assigneeId"
           LEFT JOIN campaigns c ON c.id = t."campaignId" WHERE t.id = $1`,
  validate: (d) => inSet(d.status, ENUMS.taskStatus, "status") || inSet(d.priority, ENUMS.priority, "priority"),
});


// ── Hub helpers ───────────────────────────────────────────────────────
const C_ORDER = ["IDEA", "IN_PROGRESS", "REVIEW", "APPROVED", "PUBLISHED"];
let rateCache = { v: null, at: 0 };
async function currentRate() {
  if (Date.now() - rateCache.at < 60_000 && rateCache.v) return rateCache.v;
  try {
    const row = await get(`SELECT "usdToSdgRate" FROM settings WHERE id = 1`);
    rateCache = { v: row?.usdToSdgRate || null, at: Date.now() };
  } catch { rateCache = { v: null, at: Date.now() }; }
  return rateCache.v;
}
// node-pg serializes JS arrays as PG arrays — jsonb columns need strings.
const jsonFix = (...keys) => async (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

// ── Hub routers (M1–M8 + posts + assets) ─────────────────────────────
export const productsRouter = crudRouter({
  table: "products",
  module: "campaigns",
  fields: ["name", "nameAr", "businessUnit", "category", "description", "priceMinUsd", "priceMaxUsd", "status", "ownerId"],
  orderBy: '"createdAt" ASC',
});

export const segmentsRouter = crudRouter({
  table: "segments",
  module: "campaigns",
  fields: ["name", "nameAr", "businessUnit", "kind", "sizeEstimate", "notes"],
  orderBy: '"createdAt" ASC',
});

export const personasRouter = crudRouter({
  table: "personas",
  module: "campaigns",
  fields: ["segmentId", "name", "nameAr", "goals", "pains", "channels", "objections", "message", "messageAr"],
  validateCreate: jsonFix("channels"),
  validateUpdate: jsonFix("channels"),
  listSql: `SELECT p.*, s.name AS "segmentName", s."nameAr" AS "segmentNameAr", s.kind AS "segmentKind"
            FROM personas p JOIN segments s ON s.id = p."segmentId" ORDER BY s.name, p.name`,
});

export const mediaContactsRouter = crudRouter({
  table: "media_contacts",
  module: "social",
  fields: ["name", "outlet", "role", "phone", "email", "beat", "tier", "lastContactAt", "notes"],
  orderBy: "outlet ASC, name ASC",
});

export const pressRouter = crudRouter({
  table: "press_items",
  module: "social",
  fields: ["title", "contactId", "campaignId", "status", "url", "publishedAt", "notes"],
  listSql: `SELECT p.*, m.name AS "contactName", m.outlet,
              (SELECT COUNT(*)::int FROM osint_signals s WHERE p.url IS NOT NULL AND s.url = p.url) AS "matchedSignals",
              (SELECT AVG(s.sentiment)::float8 FROM osint_signals s WHERE p.url IS NOT NULL AND s.url = p.url) AS "matchedSentiment"
            FROM press_items p LEFT JOIN media_contacts m ON m.id = p."contactId"
            ORDER BY p."createdAt" DESC`,
});

export const influencersRouter = crudRouter({
  table: "influencers",
  module: "social",
  fields: ["name", "platform", "handle", "audience", "niche", "rateUsd", "phone", "rating", "notes"],
  orderBy: "audience DESC",
});

export const collabsRouter = crudRouter({
  table: "influencer_collabs",
  module: "social",
  fields: ["influencerId", "campaignId", "deliverable", "costUsd", "linkCode", "status", "postUrl", "notes"],
  listSql: `SELECT c.*, i.name AS "influencerName", i.platform,
              (SELECT clicks FROM tracked_links t WHERE t.code = c."linkCode") AS clicks
            FROM influencer_collabs c JOIN influencers i ON i.id = c."influencerId"
            ORDER BY c."createdAt" DESC`,
});

export const postsRouter = crudRouter({
  table: "posts",
  module: "content",
  fields: ["contentId", "campaignId", "platform", "url", "linkCode", "publishedAt", "reach", "impressions", "engagement", "clicks", "costUsd", "notes"],
  listSql: `SELECT p.*, c.title AS "contentTitle", c.pillar
            FROM posts p LEFT JOIN content_items c ON c.id = p."contentId"
            ORDER BY p."publishedAt" DESC`,
});

export const assetsRouter = crudRouter({
  table: "assets",
  module: "content",
  fields: ["name", "url", "kind", "entity", "entityId"],
  orderBy: '"createdAt" DESC',
});

export const customersRouter = crudRouter({
  table: "customers",
  module: "leads",
  fields: ["leadId", "company", "businessUnit", "productIds", "firstWonAt", "totalValueUsd", "status", "accountOwnerId", "nextReviewAt", "notes"],
  validateCreate: jsonFix("productIds"),
  validateUpdate: jsonFix("productIds"),
  listSql: `SELECT c.*, u.name AS "ownerName" FROM customers c
            LEFT JOIN users u ON u.id = c."accountOwnerId" ORDER BY c."createdAt" DESC`,
});
