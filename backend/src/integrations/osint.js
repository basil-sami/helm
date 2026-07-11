// OSINT / market & media intelligence engine — v2.
//
// Aggregates PUBLIC signals about brands, competitors and sectors for
// aggregate market reading — never for profiling individuals.
//
// Keyless sources that work on deploy (no developer accounts):
//   • GOOGLE_NEWS — Google News RSS search (per locale/region).
//   • BING_NEWS   — Bing News RSS search.
//   • GDELT       — GDELT DOC 2.0 API (global news index, 65+ languages).
//   • REDDIT      — Reddit public search JSON (community chatter).
//   • RSS         — any custom RSS/Atom feed URL added to a topic.
//
// Outbound HTTP runs on your deployment (Vercel/your server). Every source is
// isolated: one failing source never blocks the others; errors are reported
// per-source in the refresh result.

export const SOURCE_TYPES = ["GOOGLE_NEWS", "BING_NEWS", "GDELT", "REDDIT", "RSS", "MANUAL", "SEARCH"];

const UA = "HELM-OSINT/2.0 (market intelligence; contact: admin@saria.sd)";
const TIMEOUT_MS = 12000;

async function fetchText(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

// ── Bilingual lexicon sentiment (token-based, negation-aware) ─────────
const POS = new Set(("growth profit win wins winner award awards awarded launch launches launched success successful " +
  "expand expands expansion partnership partnerships deal deals invest investment investments surge rise rises boost " +
  "boosts record demand opportunity opportunities breakthrough approve approved gain gains leading innovation innovative " +
  "milestone agreement contract funded funding certified sponsorship upgraded upgrade thriving strong stronger " +
  "recovery hiring revenue profitable celebrated praised popular trusted reliable quality " +
  "نجاح نجح ناجح نمو ازدهار إطلاق أطلقت شراكة استثمار استثمارات فوز فازت توسع توسعت فرصة فرص ابتكار إنجاز " +
  "اتفاق اتفاقية جائزة جوائز افتتاح ارتفاع تعاون دعم تمويل توظيف ترقية اعتماد رعاية إقبال تعافي قوي موثوق جودة ممتاز").split(/\s+/));

const NEG = new Set(("loss losses decline declines shortage shortages crisis cut cuts layoff layoffs fraud ban banned " +
  "sanction sanctions delay delays delayed fail fails failure failures protest protests conflict " +
  "outage outages recall recalls lawsuit lawsuits debt default shutdown halt halted collapse scandal breach " +
  "hack hacked strike strikes inflation downturn bankruptcy complaint complaints defect defective faulty boycott " +
  "penalty fined weak weaker slump plunge overpriced expensive broken " +
  "أزمة أزمات خسارة خسائر نقص تأخير تأخر عقوبات فشل فشلت احتجاج احتجاجات انقطاع إغلاق تراجع ركود فضيحة اختراق " +
  "إضراب تضخم إفلاس شكوى شكاوى عيب عيوب مقاطعة غرامة تعطل حريق غلاء انهيار تسريح عجز توقف ضعيف").split(/\s+/));

const NEGATORS = new Set("not no never without barely hardly lacks lack neither nor لا لم لن ليس ليست غير بدون دون ما".split(/\s+/));

export function scoreSentiment(text = "") {
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  let p = 0, n = 0;
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const negated =
      NEGATORS.has(tokens[i - 1] || "") || NEGATORS.has(tokens[i - 2] || "") ||
      NEGATORS.has(tokens[i + 1] || "") || NEGATORS.has(tokens[i + 2] || "");
    if (POS.has(w)) negated ? n++ : p++;
    else if (NEG.has(w)) negated ? p++ : n++;
  }
  const score = p + n === 0 ? 0 : (p - n) / (p + n + 1); // +1 dampens single-word hits
  const label = score > 0.15 ? "POS" : score < -0.15 ? "NEG" : "NEU";
  return { score: Number(score.toFixed(3)), label };
}

// ── Tolerant RSS 2.0 + Atom parser (dependency-free) ──────────────────
function decode(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\s+/g, " ").trim();
}
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function parseFeed(xml, fallbackType = "RSS") {
  const out = [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blocks = (xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi)) || [];
  for (const b of blocks) {
    let link = "";
    if (isAtom) {
      const lm = b.match(/<link[^>]*href="([^"]+)"/i);
      link = lm ? lm[1] : "";
    } else {
      link = tag(b, "link");
    }
    const title = tag(b, "title");
    if (!title) continue;
    const desc = tag(b, isAtom ? "summary" : "description") || tag(b, "content");
    const date = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published");
    const sourceTag = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] ||
      (b.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/i) || [])[1];
    out.push({
      title, url: link, snippet: desc.slice(0, 400),
      publishedAt: date ? new Date(date) : null,
      source: (sourceTag && decode(sourceTag)) || domainOf(link),
      sourceType: fallbackType,
    });
  }
  return out;
}

// ── GDELT DOC 2.0 ─────────────────────────────────────────────────────
function gdeltDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}
export function parseGdelt(json) {
  return (json?.articles || []).map((a) => ({
    title: a.title || "", url: a.url, snippet: "",
    publishedAt: gdeltDate(a.seendate),
    source: a.domain || domainOf(a.url),
    lang: a.language ? String(a.language).slice(0, 2).toLowerCase() : null,
    sourceType: "GDELT",
  })).filter((s) => s.title);
}

// ── Reddit public search ──────────────────────────────────────────────
export function parseReddit(json) {
  const children = json?.data?.children || [];
  return children.map((c) => {
    const d = c?.data || {};
    if (!d.title) return null;
    return {
      title: d.title,
      url: d.url_overridden_by_dest || (d.permalink ? `https://www.reddit.com${d.permalink}` : ""),
      snippet: (d.selftext || "").slice(0, 300),
      publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
      source: d.subreddit ? `r/${d.subreddit}` : "reddit",
      author: d.author || null,
      sourceType: "REDDIT",
    };
  }).filter(Boolean);
}

// ── Dedup helpers ─────────────────────────────────────────────────────
export function normalizeUrl(url = "") {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ocid|cmpid|mc_cid|mc_eid)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch { return url; }
}
export const normTitle = (t = "") => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function dedupeSignals(list) {
  const seenUrl = new Set(), seenTitle = new Set(), out = [];
  for (const s of list) {
    const u = s.url ? normalizeUrl(s.url) : "";
    const t = normTitle(s.title);
    if ((u && seenUrl.has(u)) || (t && seenTitle.has(t))) continue;
    if (u) seenUrl.add(u);
    if (t) seenTitle.add(t);
    out.push(s);
  }
  return out;
}

// ── Fetchers ──────────────────────────────────────────────────────────
async function fetchGoogleNews(topic) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic.query)}` +
    `&hl=${topic.lang}&gl=${topic.region}&ceid=${topic.region}:${topic.lang}`;
  return parseFeed(await fetchText(url), "GOOGLE_NEWS");
}
async function fetchBingNews(topic) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(topic.query)}&format=RSS`;
  return parseFeed(await fetchText(url), "BING_NEWS");
}
async function fetchGdelt(topic) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(topic.query)}` +
    `&mode=ArtList&maxrecords=50&sort=DateDesc&format=json`;
  const text = await fetchText(url);
  let json; try { json = JSON.parse(text); } catch { return []; }
  return parseGdelt(json);
}
async function fetchReddit(topic) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic.query)}&sort=new&t=month&limit=25`;
  const text = await fetchText(url, { Accept: "application/json" });
  let json; try { json = JSON.parse(text); } catch { return []; }
  return parseReddit(json);
}
async function fetchRss(feedUrl) {
  return parseFeed(await fetchText(feedUrl), "RSS");
}

// Run all of a topic's sources IN PARALLEL; one failure never blocks the rest.
export async function gatherTopic(topic) {
  const sources = Array.isArray(topic.sources) ? topic.sources : JSON.parse(topic.sources || "[]");
  const feeds = Array.isArray(topic.feeds) ? topic.feeds : JSON.parse(topic.feeds || "[]");

  const jobs = [];
  if (sources.includes("GOOGLE_NEWS")) jobs.push(["GOOGLE_NEWS", fetchGoogleNews(topic)]);
  if (sources.includes("BING_NEWS")) jobs.push(["BING_NEWS", fetchBingNews(topic)]);
  if (sources.includes("GDELT")) jobs.push(["GDELT", fetchGdelt(topic)]);
  if (sources.includes("REDDIT")) jobs.push(["REDDIT", fetchReddit(topic)]);
  for (const f of feeds) jobs.push([`RSS:${f}`, fetchRss(f)]);

  const settled = await Promise.allSettled(jobs.map(([, p]) => p));
  const signals = [], errors = [];
  settled.forEach((r, i) => {
    const name = jobs[i][0];
    if (r.status === "fulfilled") {
      for (const it of r.value) {
        const senti = scoreSentiment(`${it.title} ${it.snippet || ""}`);
        signals.push({ ...it, sentiment: senti.score, sentimentLabel: senti.label });
      }
    } else {
      errors.push({ source: name, error: r.reason?.message || String(r.reason) });
    }
  });
  return { signals: dedupeSignals(signals), errors };
}

// ── Trending-term tokenizer (for the intel dashboard) ─────────────────
const STOP = new Set(("the a an and or of to in for on with at by from as is are was were be been " +
  "this that these those it its their his her our your you we they he she has have had will would " +
  "new said says about over after into out up down more most than then also can may said سودان في من " +
  "على عن إلى مع التي الذي هذا هذه sudan").split(/\s+/));

export function trendingTerms(titles, limit = 12) {
  const counts = new Map();
  for (const t of titles) {
    const words = (t || "").toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/);
    for (const w of words) {
      if (w.length < 3 || STOP.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}
