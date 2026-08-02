import { Router } from "express";
import { crudRouter } from "../crud.js";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { notify } from "../notify.js";
import { requestApproval } from "../approvals.js";
import { slugify, SLUG_RE, uniqueSlug } from "../slug.js";

// ── PUBLISH (Wave 1·D) — the composer & owned surfaces ───────────────
// One content item → per-platform variants → scheduled slots that walk
// DRAFT→QUEUED→(AWAITING_APPROVAL→)READY→NOTIFIED→PUBLISHED/SKIPPED.
// Publishing is assisted in v1: the Daily Pulse pings the owner at slot
// time; "mark published" creates the measurement row in `posts`. The
// same state machine drives true auto-publish when APIs land (Wave 2).

const jsonFix = (...keys) => (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

// ── Variants ─────────────────────────────────────────────────────────
export const variantsRouter = crudRouter({
  table: "content_variants",
  module: "publish",
  fields: ["contentId", "platform", "caption", "captionAr", "hashtags", "assetId", "format"],
  touchUpdatedAt: true,
  listSql: `SELECT v.*, ci.title AS "contentTitle", ci.status AS "contentStatus", a.url AS "assetUrl"
            FROM content_variants v
            JOIN content_items ci ON ci.id = v."contentId"
            LEFT JOIN assets a ON a.id = v."assetId"
            ORDER BY v."updatedAt" DESC`,
  getSql: `SELECT v.*, ci.title AS "contentTitle", ci.status AS "contentStatus", a.url AS "assetUrl"
           FROM content_variants v
           JOIN content_items ci ON ci.id = v."contentId"
           LEFT JOIN assets a ON a.id = v."assetId" WHERE v.id = $1`,
  validateCreate: async (data) => {
    if (!data.platform) return "platform is required";
    if (!(await get(`SELECT 1 FROM content_items WHERE id = $1`, [data.contentId]))) return "Unknown contentId";
    return jsonFix("hashtags")(data);
  },
  validateUpdate: (data) => jsonFix("hashtags")(data),
});

// ── Scheduled posts: the queue's state machine ───────────────────────
// AWAITING_APPROVAL→READY happens only through the approvals engine;
// →PUBLISHED only through /:id/publish. The matrix governs the rest.
const TRANS = {
  DRAFT: ["QUEUED"],
  QUEUED: ["DRAFT", "AWAITING_APPROVAL", "READY", "SKIPPED"],
  AWAITING_APPROVAL: ["DRAFT"],
  READY: ["QUEUED", "SKIPPED"],
  NOTIFIED: ["SKIPPED"],
  PUBLISHED: [],
  SKIPPED: ["QUEUED"],
};

async function contentApprovedFor(variantId) {
  const r = await get(
    `SELECT ci.status FROM content_variants v JOIN content_items ci ON ci.id = v."contentId" WHERE v.id = $1`,
    [variantId]);
  return r && ["APPROVED", "PUBLISHED"].includes(r.status);
}

export const scheduledExtraRouter = Router();
scheduledExtraRouter.use(requireAuth);

// Request sign-off: plugs the queue into the approvals engine.
scheduledExtraRouter.post("/:id/request-approval", requirePerm("publish"), async (req, res, next) => {
  try {
    const sp = await get(`SELECT * FROM scheduled_posts WHERE id = $1`, [req.params.id]);
    if (!sp) return res.status(404).json({ error: "Not found" });
    if (sp.status !== "QUEUED") return res.status(409).json({ error: "Only a QUEUED slot can request approval" });
    await requestApproval({ entity: "scheduled_posts", entityId: sp.id, requesterId: req.user.id });
    await run(`UPDATE scheduled_posts SET status = 'AWAITING_APPROVAL', "updatedAt" = now() WHERE id = $1`, [sp.id]);
    logAudit(req, "publish.request_approval", "scheduled_posts", sp.id);
    res.json(await get(`SELECT * FROM scheduled_posts WHERE id = $1`, [sp.id]));
  } catch (e) { next(e); }
});

// Mark published: creates the measurement row in `posts` and closes the slot.
scheduledExtraRouter.post("/:id/publish", requirePerm("publish"), async (req, res, next) => {
  try {
    const sp = await get(
      `SELECT sp.*, v.platform, v."contentId", ci."campaignId", v.caption
       FROM scheduled_posts sp JOIN content_variants v ON v.id = sp."variantId"
       JOIN content_items ci ON ci.id = v."contentId" WHERE sp.id = $1`, [req.params.id]);
    if (!sp) return res.status(404).json({ error: "Not found" });
    if (!["READY", "NOTIFIED"].includes(sp.status)) {
      return res.status(409).json({ error: "Only a READY or NOTIFIED slot can be published" });
    }
    const b = req.body || {};
    const post = await get(
      `INSERT INTO posts ("contentId", "campaignId", platform, url, "linkCode", "publishedAt",
                          reach, impressions, engagement, clicks)
       VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9) RETURNING *`,
      [sp.contentId, sp.campaignId, sp.platform, b.url || null, sp.linkCode,
       Number(b.reach) || 0, Number(b.impressions) || 0, Number(b.engagement) || 0, Number(b.clicks) || 0]);
    await run(
      `UPDATE scheduled_posts SET status = 'PUBLISHED', "publishedPostId" = $2, "updatedAt" = now() WHERE id = $1`,
      [sp.id, post.id]);
    logAudit(req, "publish.published", "scheduled_posts", sp.id, { postId: post.id, platform: sp.platform });
    res.status(201).json({ post, scheduled: await get(`SELECT * FROM scheduled_posts WHERE id = $1`, [sp.id]) });
  } catch (e) { next(e); }
});

export const scheduledRouter = crudRouter({
  table: "scheduled_posts",
  module: "publish",
  fields: ["variantId", "scheduledAt", "assigneeId", "status", "linkCode"],
  touchUpdatedAt: true,
  orderBy: `"scheduledAt" ASC`,
  listSql: `SELECT sp.*, v.platform, v.caption, v."captionAr", v.format, v."contentId",
                   ci.title AS "contentTitle", u.name AS "assigneeName", tl.url AS "linkUrl"
            FROM scheduled_posts sp
            JOIN content_variants v ON v.id = sp."variantId"
            JOIN content_items ci ON ci.id = v."contentId"
            LEFT JOIN users u ON u.id = sp."assigneeId"
            LEFT JOIN tracked_links tl ON tl.code = sp."linkCode"
            ORDER BY sp."scheduledAt" ASC`,
  validateCreate: async (data) => {
    if (!(await get(`SELECT 1 FROM content_variants WHERE id = $1`, [data.variantId]))) return "Unknown variantId";
    if (!data.scheduledAt) return "scheduledAt is required";
    const status = data.status || "DRAFT";
    if (!["DRAFT", "QUEUED"].includes(status)) return "New slots start as DRAFT or QUEUED";
    if (status === "QUEUED" && !(await contentApprovedFor(data.variantId))) {
      return "Content must be APPROVED before queueing — walk it through the calendar first";
    }
    if (data.linkCode && !(await get(`SELECT 1 FROM tracked_links WHERE code = $1`, [data.linkCode]))) return "Unknown linkCode";
    return null;
  },
  validateUpdate: async (data, prev) => {
    if (data.linkCode && !(await get(`SELECT 1 FROM tracked_links WHERE code = $1`, [data.linkCode]))) return "Unknown linkCode";
    if (data.status === undefined || data.status === prev.status) return null;
    const allowed = TRANS[prev.status] || [];
    if (!allowed.includes(data.status)) {
      return `Illegal transition ${prev.status} → ${data.status}`;
    }
    if (data.status === "QUEUED" && !(await contentApprovedFor(prev.variantId))) {
      return "Content must be APPROVED before queueing";
    }
    return null;
  },
});

// ── Assisted publishing: the Daily Pulse step ────────────────────────
// READY slots whose time has come → one notification to the owner with
// the copy + link, and the slot moves to NOTIFIED (naturally deduped).
export async function notifyPublishDue() {
  const { getModules, moduleEnabled } = await import("../flags.js");
  if (!moduleEnabled(await getModules(), "publish")) return 0;
  const due = await all(
    `SELECT sp.id, sp."assigneeId", sp."linkCode", v.platform, ci.title
     FROM scheduled_posts sp
     JOIN content_variants v ON v.id = sp."variantId"
     JOIN content_items ci ON ci.id = v."contentId"
     WHERE sp.status = 'READY' AND sp."scheduledAt" <= now()`);
  if (!due.length) return 0;
  const admins = (await all(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
     WHERE u.active AND (r.permissions->>'admin')::boolean IS TRUE`)).map((u) => u.id);
  let pushed = 0;
  for (const sp of due) {
    const audience = sp.assigneeId ? [sp.assigneeId] : admins;
    await notify(audience, "PUBLISH_DUE", { platform: sp.platform, title: sp.title, code: sp.linkCode }, "/publish");
    await run(`UPDATE scheduled_posts SET status = 'NOTIFIED', "notifiedAt" = now(), "updatedAt" = now() WHERE id = $1`, [sp.id]);
    pushed++;
  }
  return pushed;
}

// ── Bio pages: Pulse-hosted link-in-bio ──────────────────────────────
export const bioPagesRouter = crudRouter({
  table: "bio_pages",
  module: "publish",
  fields: ["slug", "title", "titleAr", "theme", "active"],
  validateCreate: async (data) => {
    data.slug = data.slug ? slugify(data.slug) : slugify(data.title);
    if (!SLUG_RE.test(data.slug)) return "Invalid slug";
    data.slug = await uniqueSlug("bio_pages", data.slug);
    return jsonFix("theme")(data);
  },
  validateUpdate: (data) => {
    if (data.slug !== undefined && !SLUG_RE.test(data.slug || "")) return "Invalid slug";
    return jsonFix("theme")(data);
  },
});

export const bioLinksRouter = crudRouter({
  table: "bio_links",
  module: "publish",
  fields: ["pageId", "label", "labelAr", "linkCode", "sort", "active"],
  orderBy: `sort ASC, "createdAt" ASC`,
  listSql: `SELECT bl.*, tl.url, tl.clicks FROM bio_links bl
            JOIN tracked_links tl ON tl.code = bl."linkCode"
            ORDER BY bl.sort ASC, bl."createdAt" ASC`,
  validateCreate: async (data) => {
    if (!(await get(`SELECT 1 FROM bio_pages WHERE id = $1`, [data.pageId]))) return "Unknown pageId";
    if (!(await get(`SELECT 1 FROM tracked_links WHERE code = $1`, [data.linkCode]))) return "Unknown linkCode";
    return null;
  },
  validateUpdate: async (data) => {
    if (data.linkCode && !(await get(`SELECT 1 FROM tracked_links WHERE code = $1`, [data.linkCode]))) return "Unknown linkCode";
    return null;
  },
});

// Public surface: /b/:slug (rate-limited at the app layer like its siblings).
export const publicBioRouter = Router();
publicBioRouter.get("/:slug", async (req, res, next) => {
  try {
    const page = await get(`SELECT slug, title, "titleAr", theme FROM bio_pages WHERE slug = $1 AND active = true`, [req.params.slug]);
    if (!page) return res.status(404).json({ error: "Not found" });
    const links = await all(
      `SELECT bl.label, bl."labelAr", bl."linkCode" AS code FROM bio_links bl
       JOIN bio_pages p ON p.id = bl."pageId"
       WHERE p.slug = $1 AND bl.active = true ORDER BY bl.sort ASC, bl."createdAt" ASC`, [req.params.slug]);
    res.json({ page, links });
  } catch (e) { next(e); }
});
