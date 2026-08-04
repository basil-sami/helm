import { Router } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { crudRouter } from "../crud.js";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm, requireAdmin } from "../auth.js";
import { notify } from "../notify.js";
import { logAudit } from "../audit.js";

// ═══ CONNECTIVE TISSUE (Wave 1·G) — what no competitor has ═══════════

const parseJ = (v, fb) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? fb); } catch { return fb; } };
const jsonFix = (...keys) => (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

// Mint a tracked link with a prefixed, collision-checked code.
async function mintLink(url, campaignId, channel, prefix) {
  let code;
  do {
    code = prefix + "-" + crypto.randomBytes(3).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  } while (await get(`SELECT 1 FROM tracked_links WHERE code = $1`, [code]));
  await run(`INSERT INTO tracked_links (code, url, "campaignId", channel) VALUES ($1,$2,$3,$4)`,
    [code, url, campaignId || null, channel]);
  return code;
}
const shortUrl = (req, code) => `${req.protocol}://${req.get("host")}/r/${code}`;

// ── Media plans + QR placements: offline attribution ─────────────────
export const mediaPlansRouter = crudRouter({
  table: "media_plans",
  module: "media",
  fields: ["name", "nameAr", "period", "channel", "budgetUsd", "campaignId"],
  touchUpdatedAt: true,
  orderBy: `"createdAt" DESC`,
  listSql: `SELECT p.*,
              (SELECT COUNT(*)::int FROM media_placements m WHERE m."planId" = p.id) AS "placementCount",
              (SELECT COALESCE(SUM(m."costUsd"),0)::float8 FROM media_placements m WHERE m."planId" = p.id) AS "spentUsd",
              (SELECT COALESCE(SUM(t.clicks),0)::int FROM media_placements m
                 JOIN tracked_links t ON t.code = m."linkCode" WHERE m."planId" = p.id) AS scans
            FROM media_plans p ORDER BY p."createdAt" DESC`,
  validateCreate: (d) => (!d.name ? "name is required" : null),
});

export const placementsRouter = Router();
placementsRouter.use(requireAuth);

placementsRouter.get("/:planId/placements", requirePerm("media", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT m.*, t.clicks AS scans FROM media_placements m
       LEFT JOIN tracked_links t ON t.code = m."linkCode"
       WHERE m."planId" = $1 ORDER BY m."createdAt" ASC`, [req.params.planId]));
  } catch (e) { next(e); }
});

// Create a placement: mints its tracked QR code in the same motion.
placementsRouter.post("/:planId/placements", requirePerm("media"), async (req, res, next) => {
  try {
    const plan = await get(`SELECT * FROM media_plans WHERE id = $1`, [req.params.planId]);
    if (!plan) return res.status(404).json({ error: "Not found" });
    const { label, location, startDate, endDate, costUsd, targetUrl } = req.body || {};
    if (!label || !targetUrl) return res.status(400).json({ error: "label and targetUrl are required" });
    const code = await mintLink(targetUrl, plan.campaignId, "OFFLINE", "mp");
    const row = await get(
      `INSERT INTO media_placements ("planId", label, location, "startDate", "endDate", "costUsd", "linkCode", qr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [plan.id, label, location || null, startDate || null, endDate || null, Number(costUsd) || 0, code, shortUrl(req, code)]);
    logAudit(req, "media.placement", "media_placements", row.id, { code });
    res.status(201).json({ ...row, scans: 0 });
  } catch (e) { next(e); }
});

placementsRouter.patch("/placements/:id", requirePerm("media"), async (req, res, next) => {
  try {
    const m = await get(`SELECT * FROM media_placements WHERE id = $1`, [req.params.id]);
    if (!m) return res.status(404).json({ error: "Not found" });
    const F = ["label", "location", "startDate", "endDate", "costUsd"];
    for (const f of F) if (req.body[f] !== undefined) {
      await run(`UPDATE media_placements SET "${f}" = $2, "updatedAt" = now() WHERE id = $1`, [m.id, req.body[f]]);
    }
    res.json(await get(`SELECT * FROM media_placements WHERE id = $1`, [m.id]));
  } catch (e) { next(e); }
});

placementsRouter.delete("/placements/:id", requirePerm("media"), async (req, res, next) => {
  try {
    await run(`DELETE FROM media_placements WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

// The QR itself — generated locally, returned as a data URL.
placementsRouter.get("/placements/:id/qr", requirePerm("media", "read"), async (req, res, next) => {
  try {
    const m = await get(`SELECT * FROM media_placements WHERE id = $1`, [req.params.id]);
    if (!m || !m.linkCode) return res.status(404).json({ error: "Not found" });
    const url = shortUrl(req, m.linkCode);
    const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1, color: { dark: "#1b1b1f", light: "#faf7f0" } });
    res.json({ url, dataUrl, code: m.linkCode });
  } catch (e) { next(e); }
});

// ── Promotions: offers as measurable objects ─────────────────────────
export const promotionsRouter = crudRouter({
  table: "promotions",
  module: "planning",
  fields: ["name", "nameAr", "code", "kind", "productIds", "startsAt", "endsAt", "linkCode", "active"],
  touchUpdatedAt: true,
  orderBy: `"createdAt" DESC`,
  validateCreate: (d) => {
    if (!d.name || !d.code) return "name and code are required";
    d.code = String(d.code).toUpperCase().trim();
    return jsonFix("productIds")(d);
  },
  validateUpdate: (d) => { if (d.code) d.code = String(d.code).toUpperCase().trim(); return jsonFix("productIds")(d); },
});

export const promotionsExtraRouter = Router();
promotionsExtraRouter.use(requireAuth);
promotionsExtraRouter.post("/:id/redeem", requirePerm("planning"), async (req, res, next) => {
  try {
    const p = await get(`SELECT * FROM promotions WHERE id = $1`, [req.params.id]);
    if (!p) return res.status(404).json({ error: "Not found" });
    if (!p.active) return res.status(400).json({ error: "Promotion is inactive" });
    const row = await get(
      `UPDATE promotions SET redemptions = redemptions + 1, "updatedAt" = now() WHERE id = $1 RETURNING *`, [p.id]);
    logAudit(req, "promo.redeem", "promotions", p.id, { code: p.code });
    res.json(row);
  } catch (e) { next(e); }
});

// Undo a mistaken redemption: decrement (never below 0).
promotionsExtraRouter.post("/:id/undo", requirePerm("planning"), async (req, res, next) => {
  try {
    const p = await get(`SELECT * FROM promotions WHERE id = $1`, [req.params.id]);
    if (!p) return res.status(404).json({ error: "Not found" });
    const row = await get(
      `UPDATE promotions SET redemptions = GREATEST(redemptions - 1, 0), "updatedAt" = now() WHERE id = $1 RETURNING *`, [p.id]);
    logAudit(req, "promo.undo", "promotions", p.id, { code: p.code });
    res.json(row);
  } catch (e) { next(e); }
});

// Activate/deactivate: admin-only, since it gates whether a promo can be redeemed.
promotionsExtraRouter.post("/:id/toggle", requireAdmin, async (req, res, next) => {
  try {
    const p = await get(`SELECT * FROM promotions WHERE id = $1`, [req.params.id]);
    if (!p) return res.status(404).json({ error: "Not found" });
    const row = await get(
      `UPDATE promotions SET active = NOT active, "updatedAt" = now() WHERE id = $1 RETURNING *`, [p.id]);
    logAudit(req, "promo.toggle", "promotions", p.id, { code: p.code, active: row.active });
    res.json(row);
  } catch (e) { next(e); }
});

// ── Referrals: word-of-mouth, measured ───────────────────────────────
export const referralsRouter = Router();
referralsRouter.use(requireAuth);

referralsRouter.get("/", requirePerm("planning", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT r.*, c.company AS "referrerCompany", l.company AS "referredCompany", l.stage AS "referredStage",
              t.clicks
       FROM referrals r
       JOIN customers c ON c.id = r."referrerCustomerId"
       LEFT JOIN leads l ON l.id = r."referredLeadId"
       LEFT JOIN tracked_links t ON t.code = r.code
       ORDER BY r."createdAt" DESC`));
  } catch (e) { next(e); }
});

referralsRouter.post("/", requirePerm("planning"), async (req, res, next) => {
  try {
    const { referrerCustomerId, targetUrl } = req.body || {};
    if (!referrerCustomerId || !targetUrl) return res.status(400).json({ error: "referrerCustomerId and targetUrl are required" });
    const cust = await get(`SELECT * FROM customers WHERE id = $1`, [referrerCustomerId]);
    if (!cust) return res.status(400).json({ error: "Unknown customer" });
    const code = await mintLink(targetUrl, null, "REFERRAL", "ref");
    const row = await get(
      `INSERT INTO referrals ("referrerCustomerId", code) VALUES ($1,$2) RETURNING *`, [cust.id, code]);
    logAudit(req, "referrals.create", "referrals", row.id, { code });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

referralsRouter.patch("/:id", requirePerm("planning"), async (req, res, next) => {
  try {
    const r = await get(`SELECT * FROM referrals WHERE id = $1`, [req.params.id]);
    if (!r) return res.status(404).json({ error: "Not found" });
    const { referredLeadId, rewardState } = req.body || {};
    if (referredLeadId !== undefined) {
      if (referredLeadId && !(await get(`SELECT 1 FROM leads WHERE id = $1`, [referredLeadId])))
        return res.status(400).json({ error: "Unknown lead" });
      await run(`UPDATE referrals SET "referredLeadId" = $2, "updatedAt" = now() WHERE id = $1`, [r.id, referredLeadId]);
    }
    if (rewardState !== undefined) {
      if (!["PENDING", "EARNED", "PAID"].includes(rewardState)) return res.status(400).json({ error: "Bad rewardState" });
      await run(`UPDATE referrals SET "rewardState" = $2, "updatedAt" = now() WHERE id = $1`, [r.id, rewardState]);
    }
    res.json(await get(`SELECT * FROM referrals WHERE id = $1`, [r.id]));
  } catch (e) { next(e); }
});

/** Daily Pulse: referred leads that reached WON → reward EARNED + ping. */
export async function referralSweep() {
  const won = await all(
    `SELECT r.id, r.code, c.company AS referrer, l.company AS referred
     FROM referrals r JOIN leads l ON l.id = r."referredLeadId"
     JOIN customers c ON c.id = r."referrerCustomerId"
     WHERE r."rewardState" = 'PENDING' AND l.stage = 'WON'`);
  for (const w of won) {
    await run(`UPDATE referrals SET "rewardState" = 'EARNED', "updatedAt" = now() WHERE id = $1`, [w.id]);
    const { usersWithModuleWrite } = await import("../notify.js");
    await notify(await usersWithModuleWrite("planning"), "REFERRAL_EARNED",
      { referrer: w.referrer, referred: w.referred }, "/growth");
  }
  return won.length;
}

// ── Partners: channel co-op ──────────────────────────────────────────
export const partnersRouter = crudRouter({
  table: "partners",
  module: "planning",
  fields: ["name", "nameAr", "kind", "region", "contacts", "coopBudgetUsd", "notes", "active"],
  touchUpdatedAt: true,
  orderBy: `name ASC`,
  listSql: `SELECT p.*,
              (SELECT COUNT(*)::int FROM partner_campaigns pc WHERE pc."partnerId" = p.id) AS "campaignCount"
            FROM partners p ORDER BY p.name ASC`,
  validateCreate: (d) => (!d.name ? "name is required" : jsonFix("contacts")(d)),
  validateUpdate: jsonFix("contacts"),
});

export const partnerCampaignsRouter = Router();
partnerCampaignsRouter.use(requireAuth);
partnerCampaignsRouter.get("/:partnerId/campaigns", requirePerm("planning", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT pc.*, c.name AS "campaignName" FROM partner_campaigns pc
       JOIN campaigns c ON c.id = pc."campaignId" WHERE pc."partnerId" = $1 ORDER BY pc."createdAt" DESC`,
      [req.params.partnerId]));
  } catch (e) { next(e); }
});
partnerCampaignsRouter.post("/:partnerId/campaigns", requirePerm("planning"), async (req, res, next) => {
  try {
    const { campaignId, sharePct } = req.body || {};
    if (!campaignId) return res.status(400).json({ error: "campaignId is required" });
    const dup = await get(`SELECT 1 FROM partner_campaigns WHERE "partnerId" = $1 AND "campaignId" = $2`, [req.params.partnerId, campaignId]);
    if (dup) return res.status(409).json({ error: "Already linked" });
    const row = await get(
      `INSERT INTO partner_campaigns ("partnerId", "campaignId", "sharePct") VALUES ($1,$2,$3) RETURNING *`,
      [req.params.partnerId, campaignId, Number(sharePct) || 50]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});
partnerCampaignsRouter.delete("/campaigns/:id", requirePerm("planning"), async (req, res, next) => {
  try { await run(`DELETE FROM partner_campaigns WHERE id = $1`, [req.params.id]); res.status(204).end(); }
  catch (e) { next(e); }
});

// ── Playbooks: living SOPs ───────────────────────────────────────────
export const playbooksRouter = crudRouter({
  table: "playbooks",
  module: "brain",
  fields: ["title", "titleAr", "body", "category", "ownerId", "published"],
  touchUpdatedAt: true,
  orderBy: `published DESC, "updatedAt" DESC`,
  validateCreate: (d) => (!d.title ? "title is required" : null),
});

// ── Ad spend: manual-first paid tracking → ROMI ──────────────────────
export const adSpendRouter = crudRouter({
  table: "ad_spend",
  module: "planning",
  fields: ["platform", "campaignId", "date", "amountUsd", "rateAtEntry", "impressions", "clicks"],
  orderBy: `date DESC, "createdAt" DESC`,
  listSql: `SELECT a.*, c.name AS "campaignName" FROM ad_spend a
            LEFT JOIN campaigns c ON c.id = a."campaignId" ORDER BY a.date DESC, a."createdAt" DESC`,
  validateCreate: (d) => (d.amountUsd === undefined || Number.isNaN(Number(d.amountUsd)) ? "amountUsd is required" : null),
  afterWrite: async (req, action, id, data) => {
    if (action !== "create") return;
    // paid costs flow straight into campaign ROMI via the budget ledger
    const usd = Number(data.amountUsd) || 0;
    await run(
      `INSERT INTO budget_entries (label, kind, channel, "campaignId", "amountUsd", "amountSdg", date)
       VALUES ($1, 'SPENT', 'PAID', $2, $3, $4, $5)`,
      [`Ad spend — ${data.platform || "META"}`, data.campaignId || null, usd,
       usd * (Number(data.rateAtEntry) || 0), data.date || new Date().toISOString().slice(0, 10)]).catch(() => {});
  },
});

// ── Inbox v1: manual capture, one tap to a lead ──────────────────────
export const inboxRouter = crudRouter({
  table: "inbox_items",
  module: "social",
  fields: ["platform", "kind", "author", "text", "url", "status", "leadId"],
  touchUpdatedAt: true,
  orderBy: `"receivedAt" DESC`,
  validateCreate: (d) => (!d.author && !d.text ? "author or text is required" : null),
});

export const inboxExtraRouter = Router();
inboxExtraRouter.use(requireAuth);
inboxExtraRouter.post("/:id/convert", requirePerm("social"), async (req, res, next) => {
  try {
    const it = await get(`SELECT * FROM inbox_items WHERE id = $1`, [req.params.id]);
    if (!it) return res.status(404).json({ error: "Not found" });
    if (it.leadId) return res.status(400).json({ error: "Already converted" });
    const lead = await get(
      `INSERT INTO leads (company, "contactName", source, stage, notes) VALUES ($1,$2,$3,'NEW',$4) RETURNING id`,
      [req.body?.company || it.author || "Social lead", it.author || null, `Social — ${it.platform}`,
       (it.text || "").slice(0, 500)]);
    await run(`UPDATE inbox_items SET "leadId" = $2, status = 'CONVERTED', "capturedById" = $3, "updatedAt" = now() WHERE id = $1`,
      [it.id, lead.id, req.user.id]);
    const { recomputeLeadScore } = await import("../automate-engine.js");
    await recomputeLeadScore(lead.id).catch(() => {});
    logAudit(req, "inbox.convert", "inbox_items", it.id, { leadId: lead.id });
    res.status(201).json({ leadId: lead.id });
  } catch (e) { next(e); }
});

// ── Self-filling key results ─────────────────────────────────────────
function validateKR(d) {
  if (d.metric !== undefined) {
    const m = parseJ(d.metric, null);
    if (!m || (d.auto !== false && !m.metricKey)) return "metric.metricKey is required for auto key results";
    if (m.dims && typeof m.dims !== "object") return "metric.dims must be an object";
  }
  return jsonFix("metric")(d);
}

// ── Wave 2·B · replying to WhatsApp, inside the rules ────────────────
// Business-initiated messages need a Meta-approved template; free text is
// only legal within 24h of the customer's last inbound message. The API
// enforces this rather than trusting the UI to remember.
inboxExtraRouter.get("/:id/window", requirePerm("social", "read"), async (req, res, next) => {
  try {
    const it = await get(`SELECT * FROM inbox_items WHERE id = $1`, [req.params.id]);
    if (!it) return res.status(404).json({ error: "Not found" });
    const last = await get(
      `SELECT MAX("receivedAt") AS at FROM inbox_items
       WHERE platform = $1 AND author = $2 AND via = 'API'`, [it.platform, it.author]);
    const lastAt = last?.at || it.receivedAt;
    const hours = (Date.now() - new Date(lastAt).getTime()) / 3600000;
    res.json({ open: hours < 24, hoursSince: Math.floor(hours), lastInboundAt: lastAt });
  } catch (e) { next(e); }
});

inboxExtraRouter.post("/:id/reply", requirePerm("social"), async (req, res, next) => {
  try {
    const it = await get(`SELECT * FROM inbox_items WHERE id = $1`, [req.params.id]);
    if (!it) return res.status(404).json({ error: "Not found" });
    if (it.platform !== "WA") return res.status(400).json({ error: "Replies are available for WhatsApp items" });
    const stored = await get(`SELECT * FROM social_accounts WHERE platform = 'WA' AND status = 'CONNECTED' LIMIT 1`);
    if (!stored) return res.status(400).json({ error: "No connected WhatsApp account" });
    // SEC·A: decrypt at the point of use.
    const { withToken } = await import("../secrets.js");
    let acc;
    try { acc = withToken(stored); }
    catch { return res.status(500).json({ error: "Stored WhatsApp credential could not be decrypted" }); }

    const to = String(it.author || "").match(/(\d[\d ]{6,})/)?.[1]?.replace(/\s/g, "");
    if (!to) return res.status(400).json({ error: "No phone number on this item" });

    const { text, templateId, params } = req.body || {};
    const last = await get(
      `SELECT MAX("receivedAt") AS at FROM inbox_items WHERE platform = 'WA' AND author = $1 AND via = 'API'`, [it.author]);
    const openWindow = ((Date.now() - new Date(last?.at || it.receivedAt).getTime()) / 3600000) < 24;

    let payload;
    if (templateId) {
      const tpl = await get(`SELECT * FROM wa_templates WHERE id = $1`, [templateId]);
      if (!tpl) return res.status(400).json({ error: "Unknown template" });
      if (!tpl.waTemplateName) return res.status(400).json({ error: "This template has no approved WhatsApp name yet" });
      payload = { to, templateName: tpl.waTemplateName, params: Array.isArray(params) ? params : [] };
    } else {
      if (!text) return res.status(400).json({ error: "text or templateId is required" });
      if (!openWindow) {
        return res.status(400).json({ error: "The 24-hour service window has closed — use an approved template", windowClosed: true });
      }
      payload = { to, text };
    }

    const { callAdapter } = await import("../connectors/index.js");
    const r = await callAdapter(acc, "SEND", (adapter, cfg) => adapter.sendMessage(acc, cfg, payload));
    if (!r.ok) return res.status(502).json({ error: r.error });
    await run(`UPDATE inbox_items SET status = CASE WHEN status = 'OPEN' THEN 'REPLIED' ELSE status END,
               "updatedAt" = now() WHERE id = $1`, [it.id]);
    logAudit(req, "inbox.reply", "inbox_items", it.id, { via: templateId ? "template" : "text" });
    res.json({ sent: true, externalId: r.externalId || null });
  } catch (e) { next(e); }
});

export const keyResultsRouter = crudRouter({
  table: "key_results",
  module: "planning",
  fields: ["objectiveId", "label", "labelAr", "metric", "target", "current", "auto"],
  touchUpdatedAt: true,
  orderBy: `"createdAt" ASC`,
  validateCreate: (d) => (!d.objectiveId || !d.label ? "objectiveId and label are required" : validateKR(d)),
  validateUpdate: validateKR,
  afterWrite: async (_req, action, id, data) => {
    if (action === "create" && data.auto !== false) await refreshKeyResult(id).catch(() => {});
  },
});

async function refreshKeyResult(id) {
  const kr = await get(`SELECT * FROM key_results WHERE id = $1`, [id]);
  if (!kr || !kr.auto) return;
  const m = parseJ(kr.metric, {});
  if (!m.metricKey) return;
  const dims = JSON.stringify(m.dims || {});
  const snap = await get(
    `SELECT value FROM metric_snapshots WHERE "metricKey" = $1 AND dims = $2::jsonb ORDER BY date DESC LIMIT 1`,
    [m.metricKey, dims]);
  let value = snap ? Number(snap.value) : null;
  if (value === null && (!m.dims || !Object.keys(m.dims).length)) {
    const { computeMetric } = await import("../metrics-engine.js");
    value = Number((await computeMetric(m.metricKey).catch(() => ({ value: 0 }))).value) || 0;
  }
  if (value !== null && value !== Number(kr.current)) {
    await run(`UPDATE key_results SET current = $2, "updatedAt" = now() WHERE id = $1`, [id, value]);
  }
}

/** Daily Pulse: every auto key result refills itself from the catalog. */
export async function refreshKeyResults() {
  const rows = await all(`SELECT id FROM key_results WHERE auto = true`);
  for (const r of rows) await refreshKeyResult(r.id).catch(() => {});
  return rows.length;
}
