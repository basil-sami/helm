import { Router } from "express";
import { all } from "../db.js";
import { requireAuth, hasPerm } from "../auth.js";
import { normalizeUrl, normTitle } from "../integrations/osint.js";

export const listeningRouter = Router();
listeningRouter.use(requireAuth, (req, res, next) => {
  const p = req.user?.permissions;
  if (hasPerm(p, "intel", "read") || hasPerm(p, "social", "read")) return next();
  return res.status(403).json({ error: "Insufficient permissions" });
});

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;

// Monday 00:00 UTC of the week containing t (pure-UTC — no server-TZ drift).
function weekStartUTC(t) {
  const d = new Date(t);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
  return new Date(monday).toISOString().slice(0, 10);
}

// Platform-typical engagement-rate baselines (%); alert when below 50% of baseline.
const ER_BASELINE = { FACEBOOK: 0.6, INSTAGRAM: 1.2, LINKEDIN: 1.5, X: 0.9, TIKTOK: 2.5, YOUTUBE: 1.0 };

// Exported so the daily cron can compute alerts and push notifications.
export async function computeListening() {
  const now = Date.now();
  const [signals, accounts, metrics] = await Promise.all([
    // One 90-day pull; everything derives from it in JS (unified, testable logic).
    all(`SELECT s.id, s.url, s.title, s."sentimentLabel", s.sentiment,
                COALESCE(s."publishedAt", s."fetchedAt") AS at,
                s.source, t.id AS "topicId", t.label AS "topicLabel", t.category
         FROM osint_signals s JOIN osint_topics t ON t.id = s."topicId"
         WHERE COALESCE(s."publishedAt", s."fetchedAt") >= now() - interval '90 days'`),
    all(`SELECT id, platform, handle, "displayName", status FROM social_accounts ORDER BY platform, handle`),
    all(`SELECT "accountId", date, followers::float8, engagement::float8, reach::float8, impressions::float8
         FROM social_metrics ORDER BY date ASC`),
  ]);

  // ── Unique articles: one story counted once, even if several topics matched it.
  const articleKey = (s) => (s.url ? normalizeUrl(s.url) : `t:${normTitle(s.title)}`);
  const articles = new Map(); // key -> { at, neg, brand, categories:Set }
  for (const s of signals) {
    const k = articleKey(s);
    const a = articles.get(k) || { at: +new Date(s.at), neg: false, brand: false, cats: new Set() };
    a.at = Math.max(a.at, +new Date(s.at));
    a.neg = a.neg || s.sentimentLabel === "NEG";
    a.brand = a.brand || s.category === "BRAND";
    a.cats.add(s.category);
    articles.set(k, a);
  }
  const uniq = [...articles.values()];

  // ── Volume by week (8 UTC weeks, unique articles, zero-filled)
  const weekKeys = [];
  for (let i = 7; i >= 0; i--) weekKeys.push(weekStartUTC(now - i * 7 * DAY));
  const byWeek = Object.fromEntries(weekKeys.map((w) => [w, { week: w, mentions: 0, neg: 0 }]));
  for (const a of uniq) {
    const w = byWeek[weekStartUTC(a.at)];
    if (w) { w.mentions++; if (a.neg) w.neg++; }
  }
  const volumeByWeek = weekKeys.map((w) => byWeek[w]);

  // ── Share of voice (per-topic rows are intentional here: SOV compares topics)
  const sovMap = new Map();
  for (const s of signals) {
    if (s.category !== "BRAND" && s.category !== "COMPETITOR") continue;
    const row = sovMap.get(s.topicId) || { id: s.topicId, label: s.topicLabel, category: s.category, mentions: 0, pos: 0, neg: 0, _sent: 0 };
    row.mentions++; row._sent += s.sentiment || 0;
    if (s.sentimentLabel === "POS") row.pos++;
    if (s.sentimentLabel === "NEG") row.neg++;
    sovMap.set(s.topicId, row);
  }
  const shareOfVoice = [...sovMap.values()]
    .map((r) => ({ ...r, avgSentiment: r.mentions ? r2(r._sent / r.mentions) : 0, _sent: undefined }))
    .sort((a, b) => b.mentions - a.mentions);
  const brandMentions = shareOfVoice.filter((x) => x.category === "BRAND").reduce((a, x) => a + x.mentions, 0);
  const compMentions = shareOfVoice.filter((x) => x.category === "COMPETITOR").reduce((a, x) => a + x.mentions, 0);
  const sovPct = brandMentions + compMentions > 0 ? r1((brandMentions / (brandMentions + compMentions)) * 100) : null;
  const brandRows = shareOfVoice.filter((x) => x.category === "BRAND");
  const brandSentiment = brandMentions > 0
    ? r2(brandRows.reduce((a, x) => a + x.avgSentiment * x.mentions, 0) / brandMentions) : 0;

  // ── Top sources (per signal row; a source citing us twice counts twice — that's reach)
  const srcCount = new Map();
  for (const s of signals) srcCount.set(s.source || "—", (srcCount.get(s.source || "—") || 0) + 1);
  const topSources = [...srcCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([source, count]) => ({ source, count }));

  // ── Accounts: rolling ER over up to 4 snapshots, ONE declared denominator
  const seriesByAccount = {};
  for (const m of metrics) (seriesByAccount[m.accountId] ||= []).push(m);
  const accountsOut = accounts.map((a) => {
    const series = (seriesByAccount[a.id] || []).slice(-12);
    const recent = series.slice(-4);
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    const useReach = recent.length > 0 && recent.every((m) => m.reach > 0);
    const denomKey = useReach ? "reach" : "impressions";
    const num = recent.reduce((x, m) => x + (m.engagement || 0), 0);
    const den = recent.reduce((x, m) => x + (m[denomKey] || 0), 0);
    return {
      id: a.id, platform: a.platform, handle: a.handle, displayName: a.displayName, status: a.status,
      followers: last?.followers || 0,
      followersDelta: last && prev ? r1(last.followers - prev.followers) : 0,
      engagementRate: den > 0 ? r2((num / den) * 100) : 0,
      erBasis: denomKey, erWindow: recent.length,
      series: series.map((m) => ({ date: m.date, followers: m.followers, engagement: m.engagement })),
    };
  });

  // ── Alerts (brand-scoped, trailing windows — no partial-week bias)
  const brandLast7 = uniq.filter((a) => a.brand && a.at >= now - 7 * DAY).length;
  const brandPrior21 = uniq.filter((a) => a.brand && a.at < now - 7 * DAY && a.at >= now - 28 * DAY).length;
  const baseline = brandPrior21 / 3;
  const last7 = uniq.filter((a) => a.at >= now - 7 * DAY);
  const negShare = last7.length > 0 ? last7.filter((a) => a.neg).length / last7.length : 0;

  const alerts = [];
  if (brandLast7 >= 5 && baseline > 0 && brandLast7 > 1.6 * baseline) {
    alerts.push({ type: "MENTION_SPIKE", severity: "warn", value: brandLast7, baseline: r1(baseline) });
  }
  if (last7.filter((a) => a.neg).length >= 3 && negShare > 0.3) {
    alerts.push({ type: "NEGATIVE_SHIFT", severity: "high", value: r1(negShare * 100) });
  }
  for (const a of accountsOut) {
    const prevFollowers = a.followers - a.followersDelta;
    const dropAbs = -a.followersDelta;
    if (a.followersDelta < 0 && (dropAbs >= 25 || (prevFollowers > 0 && dropAbs / prevFollowers >= 0.005))) {
      alerts.push({ type: "FOLLOWER_DROP", severity: "warn", platform: a.platform, handle: a.handle, value: a.followersDelta });
    }
    const floor = (ER_BASELINE[a.platform] ?? 1.0) * 0.5;
    if (a.erWindow >= 2 && a.engagementRate > 0 && a.engagementRate < floor) {
      alerts.push({ type: "LOW_ENGAGEMENT", severity: "info", platform: a.platform, handle: a.handle, value: a.engagementRate, baseline: r1(floor) });
    }
  }

  return {
    summary: { mentions8w: uniq.filter((a) => a.at >= now - 56 * DAY).length, sovPct, negSharePct: r1(negShare * 100), brandSentiment },
    shareOfVoice, volumeByWeek, topSources, accounts: accountsOut, alerts,
  };
}

listeningRouter.get("/", async (_req, res, next) => {
  try { res.json(await computeListening()); } catch (e) { next(e); }
});
