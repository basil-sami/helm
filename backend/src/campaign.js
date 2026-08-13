import { all, get, run } from "./db.js";

// ═══ W4·A · THE CAMPAIGN SPINE ════════════════════════════════════════
// A campaign is the platform's organizing unit: the thing a marketer
// actually plans, runs and reports on. Modules are libraries; campaigns
// are the workspace.
//
// ARCHITECTURE NOTE (decision D11/D17, see ARCHITECTURE.md):
// Membership is expressed by the "campaignId" foreign key each territory
// table already carries — enumerated ONCE in CAMPAIGN_LINKS below. The
// design that opened this cluster called for a polymorphic campaign_items
// join table; the wave-opening audit found thirteen tables already
// carrying the FK, which would have made the join table a second and
// contradictable truth about what belongs to a campaign. One truth.

// ── The transition matrix ────────────────────────────────────────────
// PLANNING is the initial state (kept from the HELM era — existing rows
// use it and the word is better than DRAFT). ARCHIVED is terminal.
export const CAMPAIGN_FLOW = {
  PLANNING:  ["ACTIVE", "ARCHIVED"],
  ACTIVE:    ["PAUSED", "COMPLETED"],
  PAUSED:    ["ACTIVE", "COMPLETED"],
  COMPLETED: ["ARCHIVED", "ACTIVE"],   // reopening is allowed; it is logged
  ARCHIVED:  [],
};

export function transitionError(from, to) {
  if (!from || from === to) return null;
  if (!(from in CAMPAIGN_FLOW)) return `Unknown campaign status: ${from}`;
  if (!(to in CAMPAIGN_FLOW)) return `Unknown campaign status: ${to}`;
  if (!CAMPAIGN_FLOW[from].includes(to)) {
    const allowed = CAMPAIGN_FLOW[from];
    return allowed.length
      ? `Invalid transition ${from} → ${to} (allowed from ${from}: ${allowed.join(", ")})`
      : `Invalid transition ${from} → ${to} (${from} is final)`;
  }
  return null;
}

// ── The link registry ────────────────────────────────────────────────
// One declaration per attachable territory object. `module` is the
// feature flag / permission key, so a disabled module simply contributes
// nothing to the war room instead of erroring.
export const CAMPAIGN_LINKS = [
  { table: "content_items",      module: "content",   label: "Content",          labelAr: "المحتوى",          title: "title",  status: "status" },
  { table: "scheduled_posts",    module: "publish",   label: "Scheduled posts",  labelAr: "منشورات مجدولة",   title: null,     status: "status" },
  { table: "posts",              module: "social",    label: "Published posts",  labelAr: "منشورات",          title: "platform", status: null },
  { table: "landing_pages",      module: "automate",  label: "Landing pages",    labelAr: "صفحات الهبوط",     title: "title",  status: "status" },
  { table: "forms",              module: "automate",  label: "Forms",            labelAr: "النماذج",          title: "name",   status: null },
  { table: "surveys",            module: "research",  label: "Surveys",          labelAr: "الاستبيانات",      title: "name",   status: null },
  { table: "outreach_campaigns", module: "reach",     label: "Outreach",         labelAr: "تسلسل التواصل",    title: "name",   status: "status" },
  { table: "press_items",        module: "reach",     label: "Press",            labelAr: "التغطية الصحفية",  title: "title",  status: "status" },
  { table: "events",             module: "events",    label: "Events",           labelAr: "الفعاليات",        title: "name",   status: "status" },
  { table: "creative_requests",  module: "studio",    label: "Creative requests", labelAr: "طلبات الإبداع",   title: "title",  status: "status" },
  { table: "media_plans",        module: "connect",   label: "Media plans",      labelAr: "الخطط الإعلانية",  title: "name",   status: null },
  { table: "promotions",         module: "connect",   label: "Promotions",       labelAr: "العروض",           title: "name",   status: null },
  { table: "tracked_links",      module: "links",     label: "Tracked links",    labelAr: "الروابط المتتبعة", title: "code",   status: null },
  { table: "influencer_collabs", module: "influencers", label: "Collaborations", labelAr: "التعاونات",        title: "deliverable", status: "status" },
  { table: "insights",           module: "research",  label: "Insights",         labelAr: "الرؤى",            title: "title",  status: null },
];

const ident = (s) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier: ${s}`); return s; };

/** Attached-item counts per territory. Missing tables/columns degrade to zero. */
export async function campaignItems(campaignId) {
  const out = [];
  for (const link of CAMPAIGN_LINKS) {
    try {
      const t = ident(link.table);
      const cols = [`id`, link.title ? `${ident(link.title)} AS title` : `NULL AS title`,
                    link.status ? `${ident(link.status)} AS status` : `NULL AS status`];
      const rows = await all(
        `SELECT ${cols.join(", ")} FROM ${t} WHERE "campaignId" = $1 ORDER BY "createdAt" DESC LIMIT 50`, [campaignId]);
      if (rows.length) out.push({ ...link, count: rows.length, items: rows });
    } catch { /* module disabled or table absent — contribute nothing */ }
  }
  return out;
}

/** Money: planned budget vs actual spend, from the sources that already track it. */
export async function campaignSpend(campaignId) {
  const q = async (sql) => Number((await get(sql, [campaignId]))?.v ?? 0);
  const [budget, entries, ads] = await Promise.all([
    q(`SELECT COALESCE("budgetUsd",0)::float8 v FROM campaigns WHERE id = $1`),
    q(`SELECT COALESCE(SUM("amountUsd"),0)::float8 v FROM budget_entries WHERE "campaignId" = $1 AND kind = 'SPENT'`).catch(() => 0),
    q(`SELECT COALESCE(SUM("amountUsd"),0)::float8 v FROM ad_spend WHERE "campaignId" = $1`).catch(() => 0),
  ]);
  const spent = entries + ads;
  return { budgetUsd: budget, spentUsd: spent, entriesUsd: entries, adSpendUsd: ads,
           remainingUsd: budget - spent, pacePct: budget > 0 ? Math.round((spent / budget) * 1000) / 10 : null };
}

/** Results: the demand side, attributed by the FK leads already carry. */
export async function campaignResults(campaignId) {
  const q = async (sql) => Number((await get(sql, [campaignId]))?.v ?? 0);
  const [leads, won, lost, value] = await Promise.all([
    q(`SELECT COUNT(*)::float8 v FROM leads WHERE "campaignId" = $1`),
    q(`SELECT COUNT(*)::float8 v FROM leads WHERE "campaignId" = $1 AND stage = 'WON'`),
    q(`SELECT COUNT(*)::float8 v FROM leads WHERE "campaignId" = $1 AND stage = 'LOST'`),
    q(`SELECT COALESCE(SUM("valueUsd"),0)::float8 v FROM leads WHERE "campaignId" = $1 AND stage = 'WON'`),
  ]);
  const lostReasons = await all(
    `SELECT "lostReason" d, COUNT(*)::int v FROM leads WHERE "campaignId" = $1 AND stage = 'LOST'
       AND "lostReason" IS NOT NULL GROUP BY "lostReason" ORDER BY v DESC`, [campaignId]).catch(() => []);
  return { leads, won, lost, wonValueUsd: value, lostReasons };
}

/** The war room: one screen, assembled from the truths that already exist. */
export async function warRoom(campaignId) {
  const campaign = await get(
    `SELECT c.*, u.name AS "ownerName", d.name AS "departmentName"
       FROM campaigns c LEFT JOIN users u ON u.id = c."ownerId"
       LEFT JOIN departments d ON d.id = c."departmentId" WHERE c.id = $1`, [campaignId]);
  if (!campaign) return null;
  const [brief, items, spend, results] = await Promise.all([
    get(`SELECT * FROM campaign_briefs WHERE "campaignId" = $1`, [campaignId]).catch(() => null),
    campaignItems(campaignId), campaignSpend(campaignId), campaignResults(campaignId),
  ]);
  const cpl = results.leads > 0 ? Math.round((spend.spentUsd / results.leads) * 100) / 100 : null;
  const roi = spend.spentUsd > 0 ? Math.round(((results.wonValueUsd - spend.spentUsd) / spend.spentUsd) * 1000) / 10 : null;
  return {
    campaign, brief, items, spend, results,
    kpis: { cplUsd: cpl, roiPct: roi, itemCount: items.reduce((n, g) => n + g.count, 0) },
    allowedTransitions: CAMPAIGN_FLOW[campaign.status] || [],
    timeline: { startDate: campaign.startDate, endDate: campaign.endDate, closedAt: campaign.closedAt },
  };
}

// ── Close-out retro (P5) ─────────────────────────────────────────────
// The system drafts, humans dispose. Grounded in this campaign's rows or
// it says so — the AI rail's second law, applied here rather than trusted.
export async function retroFacts(campaignId) {
  const room = await warRoom(campaignId);
  if (!room) return null;
  return {
    name: room.campaign.name,
    window: { from: room.campaign.startDate, to: room.campaign.endDate },
    objective: room.campaign.objective || room.brief?.objective || null,
    kpiTarget: room.brief ? { metric: room.brief.kpiMetric, target: room.brief.kpiTarget } : null,
    shipped: room.items.map((g) => ({ territory: g.label, count: g.count })),
    spend: room.spend, results: room.results, kpis: room.kpis,
  };
}

/** Marks a campaign closed and stores the retro facts snapshot on the brief. */
export async function closeCampaign(campaignId, learnings) {
  await run(`UPDATE campaigns SET "closedAt" = now(), "updatedAt" = now() WHERE id = $1 AND "closedAt" IS NULL`, [campaignId]);
  if (learnings) {
    await run(
      `INSERT INTO campaign_briefs ("campaignId", learnings, "closedAt") VALUES ($1, $2, now())
       ON CONFLICT ("campaignId") DO UPDATE SET learnings = EXCLUDED.learnings, "closedAt" = now()`,
      [campaignId, learnings]).catch(() => {});
  }
  return retroFacts(campaignId);
}
