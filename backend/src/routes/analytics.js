import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requirePerm("analytics", "read"));

const ORDER = ["NEW", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"];
const PROB = { NEW: 0.1, QUALIFIED: 0.3, PROPOSAL: 0.5, NEGOTIATION: 0.7, WON: 1, LOST: 0 };
const idx = (s) => ORDER.indexOf(s);
const sum = (rows, f) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
const r2 = (n) => Math.round(n * 100) / 100;

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
const ym = (date) => (date ? new Date(date).toISOString().slice(0, 7) : null);

// Reusable KPI computation — shared by the analytics route AND the AI brain.
// windowDays scopes PERIOD metrics (won, win rate, ROMI, CPL, funnel, spend);
// pipeline is always the CURRENT open state. null = all time.
export async function computeOverview(windowDays = 365) {
  const fetchDays = windowDays ? Math.max(windowDays, 200) : null; // trends need ≥6 months of raw rows
  const leadWhere = fetchDays
    ? `WHERE stage NOT IN ('WON','LOST') OR "updatedAt" >= now() - interval '${fetchDays} days'`
    : "";
  const budgetWhere = fetchDays
    ? `WHERE COALESCE(date, "createdAt") >= now() - interval '${fetchDays} days'`
    : "";
  const [leads, budget, campaigns, content, events, signals, settings] = await Promise.all([
    all(`SELECT stage, "valueUsd", "valueSdg", source, "productId", "createdAt", "updatedAt" FROM leads ${leadWhere}`),
    all(`SELECT kind, channel, "amountUsd", "amountSdg", date, "createdAt" FROM budget_entries ${budgetWhere}`),
    all(`SELECT status, channel, "budgetUsd" FROM campaigns`),
    all(`SELECT status FROM content_items`),
    all(`SELECT status, "budgetUsd" FROM events`),
    all(`SELECT "sentimentLabel" FROM osint_signals
         WHERE COALESCE("publishedAt", "fetchedAt") >= now() - interval '90 days'`),
    get(`SELECT "usdToSdgRate" FROM settings WHERE id = 1`),
  ]);
  // Hub effectiveness data (tables may not exist pre-migration → empty)
  const safeAll = (q, params) => all(q, params).catch(() => []);
  const [posts, productsList] = await Promise.all([
    safeAll(`SELECT p.platform, p.reach, p.impressions, p.engagement, p.clicks, p."publishedAt",
                    p.url, c.title AS "contentTitle", c.pillar
             FROM posts p LEFT JOIN content_items c ON c.id = p."contentId"`),
    safeAll(`SELECT id, name, "nameAr" FROM products`),
  ]);

  const wcut = windowDays ? Date.now() - windowDays * 86400000 : -Infinity;
  const inW = (d) => +new Date(d) >= wcut;
  const periodLeads = windowDays ? leads.filter((l) => inW(l.createdAt)) : leads;
  const open = leads.filter((l) => l.stage !== "WON" && l.stage !== "LOST"); // current state
  const wonAll = leads.filter((l) => l.stage === "WON");
  const won = windowDays ? wonAll.filter((l) => inW(l.updatedAt)) : wonAll;
  const lost = leads.filter((l) => l.stage === "LOST" && (!windowDays || inW(l.updatedAt)));
  const qualifiedPlus = periodLeads.filter((l) => idx(l.stage) >= idx("QUALIFIED"));
  const spentAll = budget.filter((b) => b.kind === "SPENT");
  const spent = windowDays ? spentAll.filter((b) => inW(b.date || b.createdAt)) : spentAll;
  const planned = budget.filter((b) => b.kind === "PLANNED" && (!windowDays || inW(b.date || b.createdAt)));

  const pipelineUsd = sum(open, (l) => l.valueUsd);
  const weightedUsd = sum(open, (l) => l.valueUsd * (PROB[l.stage] || 0));
  const wonUsd = sum(won, (l) => l.valueUsd);
  const spentUsd = sum(spent, (b) => b.amountUsd);
  const plannedUsd = sum(planned, (b) => b.amountUsd);

  const scorecard = {
    pipelineUsd: r2(pipelineUsd),
    weightedUsd: r2(weightedUsd),
    wonUsd: r2(wonUsd),
    winRate: won.length + lost.length ? r2((won.length / (won.length + lost.length)) * 100) : 0,
    avgDealUsd: won.length ? r2(wonUsd / won.length) : 0,
    totalLeads: periodLeads.length,
    qualifiedLeads: qualifiedPlus.length,
    spentUsd: r2(spentUsd),
    plannedUsd: r2(plannedUsd),
    cplUsd: periodLeads.length ? r2(spentUsd / periodLeads.length) : 0,
    activeCampaigns: campaigns.filter((c) => c.status === "ACTIVE").length,
    romi: spentUsd > 0 ? r2(((wonUsd - spentUsd) / spentUsd) * 100) : null,
    rate: Number(settings?.usdToSdgRate || 0),
  };

  const reached = ORDER.map((s) => ({ stage: s, count: periodLeads.filter((l) => idx(l.stage) >= idx(s) && idx(l.stage) >= 0).length }));
  const funnel = reached.map((r, i) => ({
    ...r,
    conversion: i === 0 ? 100 : reached[i - 1].count ? r2((r.count / reached[i - 1].count) * 100) : 0,
  }));

  const valueByStage = ORDER.map((s) => ({ stage: s, usd: r2(sum(open.filter((l) => l.stage === s), (l) => l.valueUsd)), count: open.filter((l) => l.stage === s).length }));
  const bySourceMap = {};
  for (const l of periodLeads) {
    const k = l.source || "—";
    bySourceMap[k] = bySourceMap[k] || { source: k, count: 0, usd: 0 };
    bySourceMap[k].count++; bySourceMap[k].usd += Number(l.valueUsd) || 0;
  }
  const sourceAttribution = Object.values(bySourceMap).map((s) => ({ ...s, usd: r2(s.usd) })).sort((a, b) => b.usd - a.usd);
  const cycleDays = won.map((l) => (new Date(l.updatedAt) - new Date(l.createdAt)) / 86400000).filter((d) => d >= 0);
  const pipeline = {
    valueByStage,
    sourceAttribution,
    avgCycleDays: cycleDays.length ? r2(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : 0,
    wonCount: won.length, lostCount: lost.length, openCount: open.length,
  };

  const chMap = {};
  for (const b of [...planned, ...spent]) {
    const k = b.channel || "—";
    chMap[k] = chMap[k] || { channel: k, planned: 0, spent: 0 };
    if (b.kind === "SPENT") chMap[k].spent += Number(b.amountUsd) || 0;
    else chMap[k].planned += Number(b.amountUsd) || 0;
  }
  const channels = Object.values(chMap)
    .map((c) => ({ ...c, planned: r2(c.planned), spent: r2(c.spent) }))
    .sort((a, b) => b.spent - a.spent);

  const months = lastMonths(6);
  const trends = months.map((m) => ({
    month: m,
    leads: leads.filter((l) => ym(l.createdAt) === m).length,
    spentUsd: r2(sum(spentAll.filter((b) => ym(b.date || b.createdAt) === m), (b) => b.amountUsd)),
    wonUsd: r2(sum(wonAll.filter((l) => ym(l.updatedAt) === m), (l) => l.valueUsd)),
  }));

  const contentByStatus = ["IDEA", "IN_PROGRESS", "REVIEW", "APPROVED", "PUBLISHED"].map((s) => ({ status: s, count: content.filter((c) => c.status === s).length }));
  const sentiment = ["POS", "NEU", "NEG"].map((s) => ({ label: s, count: signals.filter((g) => g.sentimentLabel === s).length }));

  // ── Effectiveness: what actually works ─────────────────────────────
  const er = (p) => { const d = Number(p.reach) || Number(p.impressions) || 0; return d > 0 ? ((Number(p.engagement) || 0) / d) * 100 : 0; };
  const wPosts = windowDays ? posts.filter((p) => inW(p.publishedAt)) : posts;
  const postsTop = [...wPosts]
    .map((p) => ({ platform: p.platform, title: p.contentTitle || p.url || "—", pillar: p.pillar || null,
                   er: r2(er(p)), reach: p.reach, engagement: p.engagement, clicks: p.clicks }))
    .sort((a, b) => b.er - a.er).slice(0, 6);
  const groupEr = (keyFn) => {
    const m = {};
    for (const p of wPosts) {
      const k = keyFn(p); if (!k) continue;
      (m[k] ||= { num: 0, den: 0, posts: 0 });
      m[k].num += p.engagement; m[k].den += p.reach > 0 ? p.reach : p.impressions; m[k].posts++;
    }
    return Object.entries(m).map(([label, v]) => ({ label, er: v.den > 0 ? r2((v.num / v.den) * 100) : 0, posts: v.posts }))
      .sort((a, b) => b.er - a.er);
  };
  const productName = Object.fromEntries(productsList.map((p) => [p.id, p]));
  const byProduct = productsList.map((pr) => {
    const pl = periodLeads.filter((l) => l.productId === pr.id);
    const openP = pl.filter((l) => l.stage !== "WON" && l.stage !== "LOST");
    const wonP = leads.filter((l) => l.productId === pr.id && l.stage === "WON" && (!windowDays || inW(l.updatedAt)));
    return { id: pr.id, name: pr.name, nameAr: pr.nameAr, leads: pl.length,
             pipelineUsd: r2(sum(openP, (l) => l.valueUsd)), wonUsd: r2(sum(wonP, (l) => l.valueUsd)) };
  }).filter((x) => x.leads > 0 || x.wonUsd > 0).sort((a, b) => b.pipelineUsd + b.wonUsd - a.pipelineUsd - a.wonUsd);

  const effectiveness = { postsTop, erByChannel: groupEr((p) => p.platform), erByPillar: groupEr((p) => p.pillar), byProduct };
  return { window: { days: windowDays }, scorecard, funnel, pipeline, channels, trends, contentByStatus, sentiment, effectiveness };
}

const WINDOWS = { "90d": 90, "12m": 365, all: null };
analyticsRouter.get("/", async (req, res, next) => {
  const w = Object.prototype.hasOwnProperty.call(WINDOWS, req.query.window) ? WINDOWS[req.query.window] : 365;
  try { res.json(await computeOverview(w)); } catch (e) { next(e); }
});

// ── Per-campaign ROI (the loop closes: spend → pipeline → won → clicks → posts) ──
analyticsRouter.get("/campaign/:id", requirePerm("campaigns", "read"), async (req, res, next) => {
  try {
    const id = req.params.id;
    const [spend, planned, pipe, won, leadsN, links, postsAgg, brief] = await Promise.all([
      get(`SELECT COALESCE(SUM("amountUsd"),0)::float8 AS v FROM budget_entries WHERE "campaignId" = $1 AND kind = 'SPENT'`, [id]),
      get(`SELECT COALESCE(SUM("amountUsd"),0)::float8 AS v FROM budget_entries WHERE "campaignId" = $1 AND kind = 'PLANNED'`, [id]),
      get(`SELECT COALESCE(SUM("valueUsd"),0)::float8 AS v FROM leads WHERE "campaignId" = $1 AND stage NOT IN ('WON','LOST')`, [id]),
      get(`SELECT COALESCE(SUM("valueUsd"),0)::float8 AS v, COUNT(*)::int AS n FROM leads WHERE "campaignId" = $1 AND stage = 'WON'`, [id]),
      get(`SELECT COUNT(*)::int AS n FROM leads WHERE "campaignId" = $1`, [id]),
      get(`SELECT COALESCE(SUM(clicks),0)::int AS clicks, COUNT(*)::int AS n FROM tracked_links WHERE "campaignId" = $1`, [id]).catch(() => ({ clicks: 0, n: 0 })),
      get(`SELECT COUNT(*)::int AS n, COALESCE(SUM(engagement),0)::float8 AS eng,
                  COALESCE(SUM(CASE WHEN reach > 0 THEN reach ELSE impressions END),0)::float8 AS den
           FROM posts WHERE "campaignId" = $1`, [id]).catch(() => ({ n: 0, eng: 0, den: 0 })),
      get(`SELECT "kpiMetric", "kpiTarget", learnings FROM campaign_briefs WHERE "campaignId" = $1`, [id]).catch(() => null),
    ]);
    const spent = spend.v;
    res.json({
      spentUsd: r2(spent), plannedUsd: r2(planned.v),
      pipelineUsd: r2(pipe.v), wonUsd: r2(won.v), wonCount: won.n, leads: leadsN.n,
      romiPct: spent > 0 ? r2(((won.v - spent) / spent) * 100) : null,
      cplUsd: leadsN.n > 0 && spent > 0 ? r2(spent / leadsN.n) : null,
      links: links.n, clicks: links.clicks,
      posts: postsAgg.n, avgEr: postsAgg.den > 0 ? r2((postsAgg.eng / postsAgg.den) * 100) : 0,
      brief: brief || null,
    });
  } catch (e) { next(e); }
});

// ── Per-event scorecard ───────────────────────────────────────────────
analyticsRouter.get("/event/:id", requirePerm("events", "read"), async (req, res, next) => {
  try {
    const ev = await get(`SELECT "budgetUsd" FROM events WHERE id = $1`, [req.params.id]);
    if (!ev) return res.status(404).json({ error: "Not found" });
    const regs = await get(
      `SELECT COUNT(*)::int AS registered, COUNT(*) FILTER (WHERE status = 'ATTENDED')::int AS attended
       FROM event_registrations WHERE "eventId" = $1`, [req.params.id]).catch(() => ({ registered: 0, attended: 0 }));
    const budget = ev.budgetUsd ? Number(ev.budgetUsd) : 0;
    res.json({
      registered: regs.registered, attended: regs.attended,
      attendRatePct: regs.registered > 0 ? r2((regs.attended / regs.registered) * 100) : 0,
      budgetUsd: r2(budget),
      costPerLeadUsd: regs.registered > 0 && budget > 0 ? r2(budget / regs.registered) : null,
    });
  } catch (e) { next(e); }
});