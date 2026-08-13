import { Router } from "express";
import { crudRouter } from "../crud.js";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { rateLimit } from "../security.js";
import { slugify, uniqueSlug, SLUG_RE } from "../slug.js";
import { findOrCreateContact } from "./contacts.js";

// ── RESEARCH (Wave 1·B) — surveys & insight ──────────────────────────
// Surveys are tracked surfaces too (public at /s/:slug). NPS and CSAT
// score themselves. Insights are findings that REWRITE STRATEGY —
// attached to personas/products/briefs instead of dying in a chart.

const Q_TYPES = ["SCALE", "TEXT", "CHOICE"];
const jsonFix = (...keys) => async (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

function validateQuestions(qs, kind) {
  if (!Array.isArray(qs) || qs.length === 0) return "questions must be a non-empty array";
  if (qs.length > 25) return "Too many questions (max 25)";
  const seen = new Set();
  for (const q of qs) {
    if (!q || typeof q.key !== "string" || !/^[a-z][a-z0-9_]{0,29}$/.test(q.key)) return "Each question needs a key like nps, why";
    if (seen.has(q.key)) return `Duplicate question key: ${q.key}`;
    seen.add(q.key);
    if (!q.text) return `Question ${q.key} needs text`;
    if (!Q_TYPES.includes(q.type)) return `Question ${q.key}: type must be ${Q_TYPES.join("/")}`;
    if (q.type === "CHOICE" && (!Array.isArray(q.options) || q.options.length === 0)) return `Question ${q.key}: choice needs options`;
  }
  if ((kind === "NPS" || kind === "CSAT") && !qs.some((q) => q.type === "SCALE")) {
    return `${kind} surveys need at least one SCALE question`;
  }
  return null;
}

export const surveysRouter = crudRouter({
  table: "surveys",
  module: "research",
  fields: ["name", "nameAr", "slug", "kind", "questions", "audience", "campaignId", "productId", "active"],
  listSql: `SELECT s.*, c.name AS "campaignName", p.name AS "productName",
              (SELECT COUNT(*)::int FROM survey_responses r WHERE r."surveyId" = s.id) AS "responseCount"
            FROM surveys s
            LEFT JOIN campaigns c ON c.id = s."campaignId"
            LEFT JOIN products p ON p.id = s."productId"
            ORDER BY s."createdAt" DESC`,
  validateCreate: async (data) => {
    const qs = typeof data.questions === "string" ? JSON.parse(data.questions || "[]") : data.questions;
    const err = validateQuestions(qs, data.kind || "SURVEY");
    if (err) return err;
    data.slug = await uniqueSlug("surveys", data.slug && SLUG_RE.test(data.slug) ? data.slug : slugify(data.name, "s"));
    return jsonFix("questions")(data);
  },
  validateUpdate: async (data, prev) => {
    if (data.slug !== undefined && !SLUG_RE.test(data.slug)) return "Invalid slug (a-z, 0-9, dashes)";
    if (data.questions !== undefined) {
      const qs = typeof data.questions === "string" ? JSON.parse(data.questions || "[]") : data.questions;
      const err = validateQuestions(qs, data.kind || prev.kind);
      if (err) return err;
    }
    return jsonFix("questions")(data);
  },
});

// Stats + responses (auth side)
export const surveysExtraRouter = Router();
surveysExtraRouter.use(requireAuth, requirePerm("research", "read"));
surveysExtraRouter.get("/:id/stats", async (req, res, next) => {
  try {
    const s = await get(`SELECT id, kind FROM surveys WHERE id = $1`, [req.params.id]);
    if (!s) return res.status(404).json({ error: "Not found" });
    const base = await get(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::int AS last30,
              COALESCE(AVG(score), 0)::float8 AS "avgScore",
              COUNT(*) FILTER (WHERE score >= 9)::int AS promoters,
              COUNT(*) FILTER (WHERE score BETWEEN 7 AND 8)::int AS passives,
              COUNT(*) FILTER (WHERE score <= 6 AND score IS NOT NULL)::int AS detractors,
              COUNT(*) FILTER (WHERE score >= 4)::int AS satisfied
       FROM survey_responses WHERE "surveyId" = $1`, [s.id]);
    const out = { kind: s.kind, total: base.total, last30: base.last30 };
    if (s.kind === "NPS") {
      out.promoters = base.promoters; out.passives = base.passives; out.detractors = base.detractors;
      out.nps = base.total ? Math.round(((base.promoters - base.detractors) / base.total) * 100) : null;
    } else if (s.kind === "CSAT") {
      out.avgScore = Math.round(base.avgScore * 10) / 10;
      out.csat = base.total ? Math.round((base.satisfied / base.total) * 100) : null;
    }
    res.json(out);
  } catch (e) { next(e); }
});
surveysExtraRouter.get("/:id/responses", async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT r.*, ct.name AS "contactName" FROM survey_responses r
       LEFT JOIN contacts ct ON ct.id = r."contactId"
       WHERE r."surveyId" = $1 ORDER BY r."createdAt" DESC LIMIT 200`, [req.params.id]));
  } catch (e) { next(e); }
});

export const insightsRouter = crudRouter({
  table: "insights",
  module: "research",
  fields: ["title", "titleAr", "body", "source", "links", "impact", "status"],
  orderBy: `(impact = 'HIGH') DESC, "createdAt" DESC`,
  // A draft an AI proposed is not a finding until a person accepts it, so
  // it stays out of the insight list until then (?include=drafts to review).
  listSql: `SELECT * FROM insights WHERE status <> 'DRAFT'
            ORDER BY (impact = 'HIGH') DESC, "createdAt" DESC`,
  validateCreate: jsonFix("links"),
  validateUpdate: jsonFix("links"),
});

// ── PUBLIC surface: /api/public/surveys/:slug ────────────────────────
const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: "Too many submissions — try again later" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const publicSurveysRouter = Router();
publicSurveysRouter.get("/:slug", async (req, res, next) => {
  try {
    res.setHeader("X-Robots-Tag", "noindex");
    const s = await get(`SELECT * FROM surveys WHERE slug = $1 AND active = true`, [req.params.slug]);
    if (!s) return res.status(404).json({ error: "Survey not found" });
    const org = await get(`SELECT "orgName", "orgNameAr", "logoUrl", "accentColor" FROM settings WHERE id = 1`);
    res.json({
      name: s.name, nameAr: s.nameAr, slug: s.slug, kind: s.kind, audience: s.audience,
      questions: typeof s.questions === "string" ? JSON.parse(s.questions || "[]") : s.questions,
      org,
    });
  } catch (e) { next(e); }
});

publicSurveysRouter.post("/:slug", publicLimiter, async (req, res, next) => {
  try {
    res.setHeader("X-Robots-Tag", "noindex");
    const s = await get(`SELECT * FROM surveys WHERE slug = $1 AND active = true`, [req.params.slug]);
    if (!s) return res.status(404).json({ error: "Survey not found" });
    const body = req.body || {};
    if (body._hp) return res.json({ ok: true }); // honeypot
    const qs = typeof s.questions === "string" ? JSON.parse(s.questions || "[]") : s.questions;
    const rawAnswers = body.answers && typeof body.answers === "object" ? body.answers : body;
    const answers = {};
    let score = null;
    for (const q of qs) {
      let v = rawAnswers[q.key];
      if (q.type === "SCALE") {
        const max = Number(q.max) || 10;
        const n = Number(v);
        if (v === undefined || v === null || v === "") {
          if (q.required) return res.status(400).json({ error: `Missing required answer: ${q.key}`, field: q.key });
          continue;
        }
        if (!Number.isInteger(n) || n < 0 || n > max) return res.status(400).json({ error: `Answer ${q.key} must be 0–${max}`, field: q.key });
        answers[q.key] = n;
        if (score === null) score = n; // first scale answer scores NPS/CSAT
      } else {
        v = v === undefined || v === null ? "" : String(v).trim().slice(0, 2000);
        if (q.required && !v) return res.status(400).json({ error: `Missing required answer: ${q.key}`, field: q.key });
        if (v && q.type === "CHOICE" && !(q.options || []).includes(v)) return res.status(400).json({ error: "Invalid choice", field: q.key });
        if (v) answers[q.key] = v;
      }
    }
    const identity = body.identity && typeof body.identity === "object" ? body.identity : {};
    const email = String(identity.email || "").trim().toLowerCase() || null;
    const phone = String(identity.phone || "").trim() || null;
    if (s.audience === "LINKED" && !email && !phone) {
      return res.status(400).json({ error: "This survey requires your email or phone", field: "identity" });
    }
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email", field: "identity" });
    const contact = (email || phone)
      ? await findOrCreateContact({ name: identity.name, email, phone, consentChannel: null, consentSource: `survey:${s.slug}` })
      : null;
    await run(
      `INSERT INTO survey_responses ("surveyId", answers, score, "contactId") VALUES ($1,$2,$3,$4)`,
      [s.id, JSON.stringify(answers), s.kind === "SURVEY" ? null : score, contact?.id || null]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
