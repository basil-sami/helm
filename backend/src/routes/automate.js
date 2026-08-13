import { Router } from "express";
import { fireEvent, recomputeLeadScore } from "../automate-engine.js";
import { crudRouter } from "../crud.js";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { rateLimit } from "../security.js";
import { notify, usersWithModuleWrite } from "../notify.js";
import { logActivity } from "../leadlog.js";
import { slugify, uniqueSlug, SLUG_RE } from "../slug.js";
import { findOrCreateContact } from "./contacts.js";

// ── AUTOMATE part 1 (Wave 1·B) — forms & landing pages ──────────────
// Generalizes the capture layer: many forms per campaign, each with its
// own conversion stats, public at /f/:slug. Landing pages are block-based
// bilingual pages at /l/:slug — every campaign gets a page with a tracked
// form and zero developer. (Workflows + scoring join this flag at item 5.)

const FIELD_TYPES = ["text", "phone", "email", "select", "textarea"];
const jsonFix = (...keys) => async (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

function validateFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return "fields must be a non-empty array";
  if (fields.length > 20) return "Too many fields (max 20)";
  const seen = new Set();
  for (const f of fields) {
    if (!f || typeof f.key !== "string" || !/^[a-z][a-z0-9_]{0,29}$/.test(f.key)) return "Each field needs a key like name, phone, need_type";
    if (seen.has(f.key)) return `Duplicate field key: ${f.key}`;
    seen.add(f.key);
    if (!f.label) return `Field ${f.key} needs a label`;
    if (!FIELD_TYPES.includes(f.type)) return `Field ${f.key}: type must be one of ${FIELD_TYPES.join(", ")}`;
    if (f.type === "select" && (!Array.isArray(f.options) || f.options.length === 0)) return `Field ${f.key}: select needs options`;
  }
  return null;
}

export const formsRouter = crudRouter({
  table: "forms",
  module: "automate",
  fields: ["name", "slug", "campaignId", "fields", "successMsg", "successMsgAr", "active"],
  listSql: `SELECT f.*, c.name AS "campaignName",
              (SELECT COUNT(*)::int FROM form_submissions s WHERE s."formId" = f.id) AS "submissionCount",
              (SELECT COUNT(*)::int FROM form_submissions s WHERE s."formId" = f.id AND s."leadId" IS NOT NULL) AS "leadCount"
            FROM forms f LEFT JOIN campaigns c ON c.id = f."campaignId" ORDER BY f."createdAt" DESC`,
  validateCreate: async (data) => {
    const fields = typeof data.fields === "string" ? JSON.parse(data.fields || "[]") : data.fields;
    const err = validateFields(fields);
    if (err) return err;
    data.slug = await uniqueSlug("forms", data.slug && SLUG_RE.test(data.slug) ? data.slug : slugify(data.name, "f"));
    return jsonFix("fields")(data);
  },
  validateUpdate: async (data) => {
    if (data.slug !== undefined && !SLUG_RE.test(data.slug)) return "Invalid slug (a-z, 0-9, dashes)";
    if (data.fields !== undefined) {
      const fields = typeof data.fields === "string" ? JSON.parse(data.fields || "[]") : data.fields;
      const err = validateFields(fields);
      if (err) return err;
    }
    return jsonFix("fields")(data);
  },
});

// Per-form conversion story + latest submissions
export const formsExtraRouter = Router();
formsExtraRouter.use(requireAuth, requirePerm("automate", "read"));
formsExtraRouter.get("/:id/submissions", async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT s.*, l.company AS "leadCompany", ct.name AS "contactName"
       FROM form_submissions s
       LEFT JOIN leads l ON l.id = s."leadId"
       LEFT JOIN contacts ct ON ct.id = s."contactId"
       WHERE s."formId" = $1 ORDER BY s."createdAt" DESC LIMIT 100`, [req.params.id]));
  } catch (e) { next(e); }
});
formsExtraRouter.get("/:id/stats", async (req, res, next) => {
  try {
    res.json(await get(
      `SELECT COUNT(*)::int AS submissions,
              COUNT(*) FILTER (WHERE "leadId" IS NOT NULL)::int AS leads,
              COUNT(*) FILTER (WHERE "contactId" IS NOT NULL)::int AS contacts,
              COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::int AS last30
       FROM form_submissions WHERE "formId" = $1`, [req.params.id]));
  } catch (e) { next(e); }
});

const BLOCK_KINDS = ["HERO", "TEXT", "FEATURES", "CTA"];
export const landingPagesRouter = crudRouter({
  table: "landing_pages",
  module: "automate",
  touchUpdatedAt: true,
  fields: ["slug", "title", "titleAr", "blocks", "theme", "formId", "campaignId", "status"],
  listSql: `SELECT p.*, c.name AS "campaignName", f.name AS "formName"
            FROM landing_pages p
            LEFT JOIN campaigns c ON c.id = p."campaignId"
            LEFT JOIN forms f ON f.id = p."formId"
            ORDER BY p."updatedAt" DESC`,
  validateCreate: async (data) => {
    if (!data.title) return "title is required";
    const blocks = typeof data.blocks === "string" ? JSON.parse(data.blocks || "[]") : (data.blocks || []);
    if (blocks.some((b) => !BLOCK_KINDS.includes(b?.kind))) return `Blocks must be ${BLOCK_KINDS.join("/")}`;
    data.slug = await uniqueSlug("landing_pages", data.slug && SLUG_RE.test(data.slug) ? data.slug : slugify(data.title, "l"));
    return jsonFix("blocks", "theme")(data);
  },
  validateUpdate: async (data) => {
    if (data.slug !== undefined && !SLUG_RE.test(data.slug)) return "Invalid slug (a-z, 0-9, dashes)";
    if (data.blocks !== undefined) {
      const blocks = typeof data.blocks === "string" ? JSON.parse(data.blocks || "[]") : data.blocks;
      if (blocks.some((b) => !BLOCK_KINDS.includes(b?.kind))) return `Blocks must be ${BLOCK_KINDS.join("/")}`;
    }
    return jsonFix("blocks", "theme")(data);
  },
});

// ── PUBLIC surfaces: /api/public/forms/:slug + /api/public/pages/:slug ─
// Defenses match the capture layer: honeypot (_hp), strict validation
// against the form definition, length caps, per-IP rate limit, noindex.

const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: "Too many submissions — try again later" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const noindex = (res) => res.setHeader("X-Robots-Tag", "noindex");

const publicFormShape = (f) => ({
  id: f.id, name: f.name, slug: f.slug,
  fields: typeof f.fields === "string" ? JSON.parse(f.fields || "[]") : f.fields,
  successMsg: f.successMsg, successMsgAr: f.successMsgAr,
});

export const publicFormsRouter = Router();
publicFormsRouter.get("/:slug", async (req, res, next) => {
  try {
    noindex(res);
    const f = await get(`SELECT * FROM forms WHERE slug = $1 AND active = true`, [req.params.slug]);
    if (!f) return res.status(404).json({ error: "Form not found" });
    const org = await get(`SELECT "orgName", "orgNameAr", "logoUrl", "accentColor" FROM settings WHERE id = 1`);
    res.json({ ...publicFormShape(f), org });
  } catch (e) { next(e); }
});

/** Shared submit core so landing pages reuse the exact same pipeline. */
export async function handleFormSubmit(form, body) {
  const { _hp, src: rawSrc, ref: rawRef, ...raw } = body || {};
  if (_hp) return { status: 200, json: { ok: true } }; // honeypot: pretend success, store nothing
  const defs = typeof form.fields === "string" ? JSON.parse(form.fields || "[]") : form.fields;
  const data = {};
  for (const f of defs) {
    let v = raw[f.key];
    v = v === undefined || v === null ? "" : String(v).trim().slice(0, f.type === "textarea" ? 2000 : 300);
    if (f.required && !v) return { status: 400, json: { error: `Missing required field: ${f.key}`, field: f.key } };
    if (v && f.type === "email" && !EMAIL_RE.test(v)) return { status: 400, json: { error: "Invalid email", field: f.key } };
    if (v && f.type === "phone" && v.replace(/\D/g, "").length < 5) return { status: 400, json: { error: "Invalid phone", field: f.key } };
    if (v && f.type === "select" && !(f.options || []).includes(v)) return { status: 400, json: { error: "Invalid choice", field: f.key } };
    if (v) data[f.key] = v;
  }
  let src = null, srcCampaignId = null;
  if (typeof rawSrc === "string" && /^[a-z0-9-]{3,40}$/.test(rawSrc)) {
    src = rawSrc;
    const link = await get(`SELECT "campaignId" FROM tracked_links WHERE code = $1`, [rawSrc]).catch(() => null);
    if (link?.campaignId) srcCampaignId = link.campaignId;
  }
  const ref = typeof rawRef === "string" && /^[a-z0-9-]{3,40}$/.test(rawRef) ? rawRef : null;
  const campaignId = form.campaignId || srcCampaignId;
  const contact = await findOrCreateContact({
    name: data.name, email: data.email, phone: data.phone, company: data.company,
    consentChannel: data.phone ? "WHATSAPP" : (data.email ? "EMAIL" : null),
    consentSource: `form:${form.slug}`,
  });
  let leadId = null;
  if (data.phone) {
    const extras = Object.entries(data).filter(([k]) => !["name", "phone", "email", "company"].includes(k))
      .map(([k, v]) => `${k}: ${v}`).join(" · ") || null;
    const lead = await get(
      `INSERT INTO leads (company, "contactName", phone, email, source, notes, "campaignId")
       VALUES ($1,$2,$3,$4,'FORM',$5,$6) RETURNING id, company`,
      [data.company || data.name || form.name, data.name || null, data.phone, data.email || null, extras, campaignId]
    );
    leadId = lead.id;
    logActivity({ user: { id: null, name: `Form: ${form.slug}` } }, lead.id, "CAPTURE", extras, { via: "FORM", form: form.slug, src });
    notify(await usersWithModuleWrite("leads"), "LEAD_CAPTURED", { company: lead.company, via: `form:${form.slug}` }, "/leads").catch(() => {});
    if (contact && !contact.leadId) run(`UPDATE contacts SET "leadId" = $2 WHERE id = $1`, [contact.id, leadId]).catch(() => {});
    if (ref) run(`UPDATE referrals SET "referredLeadId" = $1, "updatedAt" = now() WHERE code = $2 AND "referredLeadId" IS NULL`, [leadId, ref]).catch(() => {});
  }
  await run(
    `INSERT INTO form_submissions ("formId", data, "leadId", "contactId", src) VALUES ($1,$2,$3,$4,$5)`,
    [form.id, JSON.stringify(data), leadId, contact?.id || null, src]
  );
  if (leadId) await recomputeLeadScore(leadId).catch(() => {});
  await fireEvent("form.submitted", { formSlug: form.slug, leadId, campaignId, src: src || "" }, { leadId });
  return { status: 201, json: { ok: true, successMsg: form.successMsg, successMsgAr: form.successMsgAr } };
}

publicFormsRouter.post("/:slug", publicLimiter, async (req, res, next) => {
  try {
    noindex(res);
    const f = await get(`SELECT * FROM forms WHERE slug = $1 AND active = true`, [req.params.slug]);
    if (!f) return res.status(404).json({ error: "Form not found" });
    const out = await handleFormSubmit(f, req.body);
    res.status(out.status).json(out.json);
  } catch (e) { next(e); }
});

export const publicPagesRouter = Router();
publicPagesRouter.get("/:slug", async (req, res, next) => {
  try {
    noindex(res);
    const p = await get(`SELECT * FROM landing_pages WHERE slug = $1 AND status = 'PUBLISHED'`, [req.params.slug]);
    if (!p) return res.status(404).json({ error: "Page not found" });
    run(`UPDATE landing_pages SET views = views + 1 WHERE id = $1`, [p.id]).catch(() => {});
    const [org, form] = await Promise.all([
      get(`SELECT "orgName", "orgNameAr", "logoUrl", "accentColor" FROM settings WHERE id = 1`),
      p.formId ? get(`SELECT * FROM forms WHERE id = $1 AND active = true`, [p.formId]) : null,
    ]);
    res.json({
      slug: p.slug, title: p.title, titleAr: p.titleAr,
      blocks: typeof p.blocks === "string" ? JSON.parse(p.blocks || "[]") : p.blocks,
      theme: typeof p.theme === "string" ? JSON.parse(p.theme || "{}") : p.theme,
      org, form: form ? publicFormShape(form) : null,
    });
  } catch (e) { next(e); }
});
