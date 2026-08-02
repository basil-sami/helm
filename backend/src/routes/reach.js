import { Router } from "express";
import { crudRouter } from "../crud.js";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { notify, usersWithModuleWrite } from "../notify.js";
import { logAudit } from "../audit.js";
import { renderWaTemplate } from "../automate-engine.js";

// ═══ REACH (Wave 1·F) — the outreach engine & relationship health ════

const parseJ = (v, fb) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? fb); } catch { return fb; } };
const jsonFix = (...keys) => (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

const CHANNELS = ["WA", "EMAIL", "CALL"];
const KIND_FOR_AUDIENCE = { MEDIA: "MEDIA", INFLUENCER: "INFLUENCER", PARTNER: "PARTNER", CUSTOMER: "CUSTOMER", CUSTOM: "CONTACT" };

// Resolve pickable targets per kind → uniform { id, name, sub, phone }.
async function resolveAudience(kind, q = "") {
  const like = `%${q}%`;
  if (kind === "MEDIA") return all(
    `SELECT id, name, outlet AS sub, phone FROM media_contacts WHERE name ILIKE $1 OR outlet ILIKE $1 ORDER BY tier ASC, name LIMIT 100`, [like]);
  if (kind === "INFLUENCER") return all(
    `SELECT id, name, platform AS sub, phone FROM influencers WHERE name ILIKE $1 ORDER BY audience DESC NULLS LAST LIMIT 100`, [like]);
  if (kind === "CUSTOMER") return all(
    `SELECT c.id, c.company AS name, c."businessUnit" AS sub, l.phone
     FROM customers c LEFT JOIN leads l ON l.id = c."leadId"
     WHERE c.company ILIKE $1 ORDER BY c."totalValueUsd" DESC LIMIT 100`, [like]);
  if (kind === "CONTACT") return all(
    `SELECT id, name, company AS sub, phone FROM contacts WHERE name ILIKE $1 OR company ILIKE $1 ORDER BY name LIMIT 100`, [like]);
  return []; // PARTNER lands with the partners table (Wave 1·G)
}
async function loadTarget(kind, id) {
  if (kind === "MEDIA") return get(`SELECT id, name, outlet AS sub, phone FROM media_contacts WHERE id = $1`, [id]);
  if (kind === "INFLUENCER") return get(`SELECT id, name, platform AS sub, phone FROM influencers WHERE id = $1`, [id]);
  if (kind === "CUSTOMER") return get(
    `SELECT c.id, c.company AS name, c."businessUnit" AS sub, l.phone
     FROM customers c LEFT JOIN leads l ON l.id = c."leadId" WHERE c.id = $1`, [id]);
  if (kind === "CONTACT") return get(`SELECT id, name, company AS sub, phone FROM contacts WHERE id = $1`, [id]);
  return null;
}

function validateCampaign(data) {
  if (data.steps !== undefined) {
    const steps = parseJ(data.steps, null);
    if (!Array.isArray(steps) || steps.length === 0) return "steps must be a non-empty array";
    for (const st of steps) {
      if (st.day === undefined || Number.isNaN(Number(st.day)) || Number(st.day) < 0) return "each step needs day ≥ 0";
      if (!CHANNELS.includes(st.channel)) return `step channel must be one of ${CHANNELS.join(", ")}`;
    }
  }
  return jsonFix("steps")(data);
}

// ── Campaigns ────────────────────────────────────────────────────────
export const outreachRouter = crudRouter({
  table: "outreach_campaigns",
  module: "reach",
  fields: ["name", "nameAr", "goal", "audienceKind", "steps", "status"],
  touchUpdatedAt: true,
  orderBy: `"createdAt" DESC`,
  listSql: `SELECT o.*,
              (SELECT COUNT(*)::int FROM outreach_touches t WHERE t."campaignId" = o.id) AS "touchCount",
              (SELECT COUNT(*)::int FROM outreach_touches t WHERE t."campaignId" = o.id AND t.status = 'PLANNED') AS "plannedCount",
              (SELECT COUNT(*)::int FROM outreach_touches t WHERE t."campaignId" = o.id AND t.status IN ('REPLIED','PLACED')) AS "wonCount"
            FROM outreach_campaigns o ORDER BY o."createdAt" DESC`,
  validateCreate: (d) => (!d.name ? "name is required" : validateCampaign(d)),
  validateUpdate: validateCampaign,
});

export const outreachExtraRouter = Router();
outreachExtraRouter.use(requireAuth);

// Pickable audience for the enroll drawer.
outreachExtraRouter.get("/audience", requirePerm("reach", "read"), async (req, res, next) => {
  try {
    const kind = KIND_FOR_AUDIENCE[req.query.kind] || req.query.kind;
    res.json(await resolveAudience(kind, String(req.query.q || "")));
  } catch (e) { next(e); }
});

// Relationship health: last-touch recency → warm / cooling / cold.
outreachExtraRouter.get("/health", requirePerm("reach", "read"), async (_req, res, next) => {
  try {
    const rows = await all(
      `SELECT id, name, outlet, tier, phone, "lastContactAt",
              CASE WHEN "lastContactAt" IS NULL THEN 9999
                   ELSE EXTRACT(day FROM now() - "lastContactAt")::int END AS days
       FROM media_contacts ORDER BY days DESC LIMIT 200`);
    const bucket = (d) => (d < 30 ? "warm" : d <= 90 ? "cooling" : "cold");
    const contacts = rows.map((r) => ({ ...r, health: bucket(r.days) }));
    const counts = { warm: 0, cooling: 0, cold: 0 };
    for (const c of contacts) counts[c.health]++;
    res.json({ counts, contacts });
  } catch (e) { next(e); }
});

// Enroll targets: one touch per step, due-dated from today. Already-enrolled
// targets are skipped — sequences never double-book a relationship.
outreachExtraRouter.post("/:id/enroll", requirePerm("reach"), async (req, res, next) => {
  try {
    const c = await get(`SELECT * FROM outreach_campaigns WHERE id = $1`, [req.params.id]);
    if (!c) return res.status(404).json({ error: "Not found" });
    const steps = parseJ(c.steps, []);
    if (!steps.length) return res.status(400).json({ error: "Campaign has no steps" });
    const ids = Array.isArray(req.body?.targetIds) ? req.body.targetIds : [];
    if (!ids.length) return res.status(400).json({ error: "targetIds is required" });
    const kind = KIND_FOR_AUDIENCE[c.audienceKind];
    if (!kind || kind === "PARTNER") return res.status(400).json({ error: "This audience kind isn't enrollable yet" });
    let enrolled = 0, skipped = 0;
    for (const tid of ids) {
      const target = await loadTarget(kind, tid);
      if (!target) { skipped++; continue; }
      const dup = await get(`SELECT 1 FROM outreach_touches WHERE "campaignId" = $1 AND "targetId" = $2 LIMIT 1`, [c.id, tid]);
      if (dup) { skipped++; continue; }
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        await run(
          `INSERT INTO outreach_touches ("campaignId","targetKind","targetId","targetName","stepNo",channel,"templateId","dueAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval)`,
          [c.id, kind, tid, target.name, i + 1, st.channel, st.templateId || null, String(Number(st.day) || 0)]);
      }
      enrolled++;
    }
    logAudit(req, "outreach.enroll", "outreach_campaigns", c.id, { enrolled, skipped });
    res.json({ enrolled, skipped });
  } catch (e) { next(e); }
});

// The touches board for one campaign.
outreachExtraRouter.get("/:id/touches", requirePerm("reach", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT * FROM outreach_touches WHERE "campaignId" = $1 ORDER BY "targetName", "stepNo"`, [req.params.id]));
  } catch (e) { next(e); }
});

// ── Touches: the send flow + transitions ─────────────────────────────
const TOUCH_TRANS = {
  PLANNED: ["SENT", "SKIPPED"],
  SENT: ["REPLIED", "DECLINED", "PLACED"],
  REPLIED: ["PLACED"],
  DECLINED: [], PLACED: [], SKIPPED: ["PLANNED"],
};

async function markSent(touch) {
  await run(`UPDATE outreach_touches SET status = 'SENT', "sentAt" = now(), "updatedAt" = now() WHERE id = $1`, [touch.id]);
  if (touch.targetKind === "MEDIA") {
    await run(`UPDATE media_contacts SET "lastContactAt" = now() WHERE id = $1`, [touch.targetId]).catch(() => {});
  }
}

export const touchesRouter = Router();
touchesRouter.use(requireAuth);

// Assisted send: render the WA template against the target, hand back the
// deep link, stamp SENT + the relationship's lastContactAt.
touchesRouter.post("/:id/send", requirePerm("reach"), async (req, res, next) => {
  try {
    const t = await get(`SELECT * FROM outreach_touches WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Not found" });
    if (t.status !== "PLANNED") return res.status(400).json({ error: `Cannot send from ${t.status}` });
    const target = await loadTarget(t.targetKind, t.targetId);
    let out = {};
    if (t.templateId) {
      const r = await renderWaTemplate(t.templateId, null, {
        contactName: t.targetName, company: target?.sub || "", phone: target?.phone || "",
      }, req.user.name);
      const digits = (target?.phone || "").replace(/[^\d]/g, "");
      out = { text: r.text, textAr: r.textAr, waUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(r.textAr || r.text)}` : null };
    }
    await markSent(t);
    logAudit(req, "outreach.send", "outreach_touches", t.id, { channel: t.channel });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (/Unknown/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

// Manual transitions (+ notes): mark sent by hand, log replies, placements.
touchesRouter.patch("/:id", requirePerm("reach"), async (req, res, next) => {
  try {
    const t = await get(`SELECT * FROM outreach_touches WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Not found" });
    const { status, note } = req.body || {};
    if (status !== undefined && status !== t.status) {
      if (!(TOUCH_TRANS[t.status] || []).includes(status)) {
        return res.status(400).json({ error: `Invalid transition ${t.status} → ${status}` });
      }
      if (status === "SENT") await markSent(t);
      else await run(`UPDATE outreach_touches SET status = $2, "updatedAt" = now() WHERE id = $1`, [t.id, status]);
    }
    if (note !== undefined) await run(`UPDATE outreach_touches SET note = $2, "updatedAt" = now() WHERE id = $1`, [t.id, note]);
    logAudit(req, "outreach.touch", "outreach_touches", t.id, { status: status || t.status });
    res.json(await get(`SELECT * FROM outreach_touches WHERE id = $1`, [t.id]));
  } catch (e) { next(e); }
});

// ── Coverage reports: the one-click branded deliverable ──────────────
async function compileCoverage(periodStart, periodEnd) {
  const P = [periodStart, periodEnd];
  const press = await all(
    `SELECT p.title, p.url, p."publishedAt", m.name AS contact, m.outlet
     FROM press_items p LEFT JOIN media_contacts m ON m.id = p."contactId"
     WHERE p.status = 'PUBLISHED' AND p."publishedAt"::date BETWEEN $1 AND $2
     ORDER BY p."publishedAt" DESC LIMIT 50`, P);
  const topics = await all(
    `SELECT t.id, t.label, COUNT(s.id)::int AS count
     FROM osint_topics t JOIN osint_signals s ON s."topicId" = t.id AND s.canonical = true AND s."reviewStatus" <> 'REJECTED'
     WHERE s."createdAt"::date BETWEEN $1 AND $2
     GROUP BY t.id, t.label ORDER BY count DESC LIMIT 8`, P);
  const comps = await all(`SELECT id, name, "listeningTopicId" FROM competitors WHERE active AND "listeningTopicId" IS NOT NULL`);
  const compTopicIds = new Set(comps.map((c) => c.listeningTopicId));
  let own = 0, comp = 0;
  const perCompetitor = comps.map((c) => ({ name: c.name, count: 0 }));
  for (const t of topics) {
    if (compTopicIds.has(t.id)) {
      comp += t.count;
      const pc = comps.findIndex((c) => c.listeningTopicId === t.id);
      if (pc >= 0) perCompetitor[pc].count += t.count;
    } else own += t.count;
  }
  const sovPct = own + comp > 0 ? Math.round((own / (own + comp)) * 1000) / 10 : null;
  const outreach = (await get(
    `SELECT COUNT(*) FILTER (WHERE "sentAt"::date BETWEEN $1 AND $2)::int AS sent,
            COUNT(*) FILTER (WHERE status = 'REPLIED' AND "updatedAt"::date BETWEEN $1 AND $2)::int AS replied,
            COUNT(*) FILTER (WHERE status = 'PLACED' AND "updatedAt"::date BETWEEN $1 AND $2)::int AS placed
     FROM outreach_touches`, P)) || { sent: 0, replied: 0, placed: 0 };
  return {
    pressCount: press.length, press,
    signalCount: topics.reduce((a, t) => a + t.count, 0),
    topics: topics.map(({ id, ...t }) => t),
    sov: { ownMentions: own, competitorMentions: comp, sovPct, perCompetitor },
    outreach,
  };
}

export const coverageRouter = Router();
coverageRouter.use(requireAuth);
coverageRouter.get("/", requirePerm("reach", "read"), async (_req, res, next) => {
  try { res.json(await all(`SELECT * FROM coverage_reports ORDER BY "createdAt" DESC LIMIT 50`)); }
  catch (e) { next(e); }
});
coverageRouter.get("/:id", requirePerm("reach", "read"), async (req, res, next) => {
  try {
    const r = await get(`SELECT * FROM coverage_reports WHERE id = $1`, [req.params.id]);
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  } catch (e) { next(e); }
});
coverageRouter.post("/compile", requirePerm("reach"), async (req, res, next) => {
  try {
    const { title, periodStart, periodEnd } = req.body || {};
    if (!title || !periodStart || !periodEnd) return res.status(400).json({ error: "title, periodStart, periodEnd are required" });
    const snapshot = await compileCoverage(periodStart, periodEnd);
    const row = await get(
      `INSERT INTO coverage_reports (title, "periodStart", "periodEnd", snapshot, "createdById")
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, periodStart, periodEnd, JSON.stringify(snapshot), req.user.id]);
    logAudit(req, "coverage.compile", "coverage_reports", row.id, { periodStart, periodEnd });
    res.status(201).json(row);
  } catch (e) { next(e); }
});
coverageRouter.delete("/:id", requirePerm("reach"), async (req, res, next) => {
  try {
    await run(`DELETE FROM coverage_reports WHERE id = $1`, [req.params.id]);
    logAudit(req, "coverage.delete", "coverage_reports", req.params.id);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Competitors ──────────────────────────────────────────────────────
export const competitorsRouter = crudRouter({
  table: "competitors",
  module: "reach",
  fields: ["name", "nameAr", "listeningTopicId", "priceNotes", "notes", "active"],
  touchUpdatedAt: true,
  orderBy: `name ASC`,
  listSql: `SELECT c.*, t.label AS "topicLabel",
              (SELECT COUNT(*)::int FROM osint_signals s WHERE s.canonical = true AND s."reviewStatus" <> 'REJECTED' AND s."topicId" = c."listeningTopicId"
               AND s."createdAt" >= now() - interval '30 days') AS "mentions30d"
            FROM competitors c LEFT JOIN osint_topics t ON t.id = c."listeningTopicId" ORDER BY c.name ASC`,
  validateCreate: (d) => (!d.name ? "name is required" : jsonFix("priceNotes")(d)),
  validateUpdate: jsonFix("priceNotes"),
});

// ── Daily Pulse sweeps ───────────────────────────────────────────────
/** Overdue planned touches → ping the reach team, once per campaign per 20h. */
export async function outreachDueSweep() {
  const { getModules, moduleEnabled } = await import("../flags.js");
  if (!moduleEnabled(await getModules(), "reach")) return 0;
  const due = await all(
    `SELECT o.id, o.name, COUNT(t.id)::int AS n
     FROM outreach_touches t JOIN outreach_campaigns o ON o.id = t."campaignId"
     WHERE t.status = 'PLANNED' AND t."dueAt" <= now() AND o.status = 'ACTIVE'
     GROUP BY o.id, o.name`);
  if (!due.length) return 0;
  const aud = await usersWithModuleWrite("reach");
  let pushed = 0;
  for (const c of due) {
    const dup = await get(
      `SELECT 1 FROM notifications WHERE type = 'OUTREACH_DUE' AND meta->>'campaignId' = $1
       AND "createdAt" >= now() - interval '20 hours' LIMIT 1`, [String(c.id)]);
    if (dup) continue;
    await notify(aud, "OUTREACH_DUE", { campaignId: c.id, campaign: c.name, count: c.n }, "/reach");
    pushed++;
  }
  return pushed;
}

/** Tier-1 relationships gone cold (60d+ silent) → ping, once per contact per 20h, max 5. */
export async function coldMediaSweep() {
  const { getModules, moduleEnabled } = await import("../flags.js");
  if (!moduleEnabled(await getModules(), "reach")) return 0;
  const cold = await all(
    `SELECT id, name, outlet,
            COALESCE(EXTRACT(day FROM now() - "lastContactAt")::int, 9999) AS days
     FROM media_contacts
     WHERE tier = 'TIER1' AND ("lastContactAt" IS NULL OR "lastContactAt" < now() - interval '60 days')
     ORDER BY days DESC LIMIT 5`);
  if (!cold.length) return 0;
  const aud = await usersWithModuleWrite("reach");
  let pushed = 0;
  for (const c of cold) {
    const dup = await get(
      `SELECT 1 FROM notifications WHERE type = 'REL_COLD' AND meta->>'contactId' = $1
       AND "createdAt" >= now() - interval '20 hours' LIMIT 1`, [String(c.id)]);
    if (dup) continue;
    await notify(aud, "REL_COLD", { contactId: c.id, name: c.name, outlet: c.outlet, days: c.days }, "/reach");
    pushed++;
  }
  return pushed;
}
