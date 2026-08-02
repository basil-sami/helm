import { all, get, run } from "./db.js";

// ═══ THE SEARCH RAIL (Wave 3·D) ══════════════════════════════════════
// One contract, providers behind it — the connector layer's shape again.
//
// THE LOAD-BEARING RULE: live results do not bypass the validation
// pipeline, they feed it. Everything found here enters as an osint_signal
// and passes source registry → dedupe → relevance gate → review queue →
// entity resolution → corroboration, exactly as RSS does. Real-time noise
// reaching the Pulse Index unfiltered is the very defect W2·E fixed;
// speed is not a reason to lower the evidence bar.
//
// On the "make it like Grok" question: we cannot, and no architecture
// changes that — xAI owns X, and that access *is* their product. As of
// Feb 2026 X is pay-per-use with no free tier and full-archive search is
// Enterprise-only at tens of thousands a month. So X here is a metered,
// hard-capped provider for a handful of high-value queries, and the open
// web (searched through the AI rail, grounded and cited) is the default.

export const PROVIDERS = ["WEB", "X", "REDDIT", "YOUTUBE"];
export const FREE_PROVIDERS = ["REDDIT", "YOUTUBE"];

export async function searchCfg() {
  const s = await get(`SELECT integrations FROM settings WHERE id = 1`);
  const ints = typeof s?.integrations === "string" ? JSON.parse(s.integrations || "{}") : (s?.integrations || {});
  return ints.search || {};
}

export async function budgets() {
  const rows = await all(`SELECT * FROM search_budget ORDER BY provider`);
  const out = {};
  for (const r of rows) {
    const spent = await get(
      `SELECT COALESCE(SUM("costUsd"),0)::float8 v FROM search_runs
       WHERE provider = $1 AND at >= date_trunc('month', now())`, [r.provider]);
    const cap = Number(r.monthlyCapUsd);
    const used = Number(spent?.v || 0);
    out[r.provider] = {
      provider: r.provider, active: r.active, monthlyCapUsd: cap,
      costPerUnit: Number(r.costPerUnit), spentThisMonth: Number(used.toFixed(4)),
      pctOfCap: cap > 0 ? Math.round((used / cap) * 100) : 0,
      exhausted: cap > 0 && used >= cap,
    };
  }
  return out;
}

async function logSearch(row) {
  await run(
    `INSERT INTO search_runs (provider, query, "topicId", results, ingested, "costUsd", status, detail, "runById")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [row.provider, String(row.query).slice(0, 300), row.topicId || null, row.results || 0,
     row.ingested || 0, row.costUsd || 0, row.status,
     row.detail ? String(row.detail).slice(0, 400) : null, row.userId || null]).catch(() => {});
}

// ── providers ────────────────────────────────────────────────────────

/**
 * The open web, searched through the AI rail so results arrive already
 * grounded and cited. This is the default and the cheapest honest path.
 */
async function searchWeb(query, cfg) {
  const { complete } = await import("./ai.js");
  const r = await complete({
    feature: "web_search",
    maxTokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    system: "Search the web and report what you find. For each result give a line of the form: TITLE :: URL :: one-sentence summary. Report only what the sources say. If you find nothing relevant, reply NONE.",
    prompt: query,
  });
  if (!r.ok) return { ok: false, error: r.error, results: [] };

  const results = [];
  for (const line of String(r.text || "").split("\n")) {
    const m = line.match(/^\s*(?:[-*\d.]+\s*)?(.+?)\s*::\s*(https?:\/\/\S+)\s*::\s*(.+)$/);
    if (!m) continue;
    results.push({
      title: m[1].trim().slice(0, 300),
      url: m[2].trim(),
      snippet: m[3].trim().slice(0, 600),
      source: hostOf(m[2]),
      sourceType: "SEARCH",
    });
  }
  return { ok: true, results, costUsd: Number(r.costUsd || 0) };
}

/** X, metered. Narrow high-value queries only — never a firehose. */
async function searchX(query, cfg, max) {
  const token = cfg.xBearerToken;
  if (!token) return { ok: false, error: "X needs a bearer token before it can be used", results: [] };
  const base = (cfg.xApiUrl || "https://api.twitter.com/2").replace(/\/$/, "");
  const url = `${base}/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${Math.min(max, 25)}&tweet.fields=created_at,author_id`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `${res.status} ${text.slice(0, 200)}`, results: [] };
  const data = JSON.parse(text || "{}");
  const results = (data.data || []).map((t) => ({
    title: String(t.text || "").slice(0, 200),
    url: `https://x.com/i/status/${t.id}`,
    snippet: String(t.text || "").slice(0, 600),
    source: "x.com",
    sourceType: "SEARCH",
    publishedAt: t.created_at || null,
  }));
  return { ok: true, results, reads: results.length };
}

async function searchReddit(query, cfg, max) {
  const base = (cfg.redditApiUrl || "https://www.reddit.com").replace(/\/$/, "");
  const res = await fetch(`${base}/search.json?q=${encodeURIComponent(query)}&limit=${Math.min(max, 25)}&sort=new`, {
    headers: { "User-Agent": "PulseBot/1.0 (+listening)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return { ok: false, error: `${res.status}`, results: [] };
  const data = await res.json();
  const results = (data?.data?.children || []).map((c) => ({
    title: String(c.data?.title || "").slice(0, 300),
    url: c.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : c.data?.url,
    snippet: String(c.data?.selftext || c.data?.title || "").slice(0, 600),
    source: "reddit.com",
    sourceType: "REDDIT",
    publishedAt: c.data?.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : null,
  })).filter((r) => r.url);
  return { ok: true, results };
}

async function searchYouTube(query, cfg, max) {
  if (!cfg.youtubeApiKey) return { ok: false, error: "YouTube needs an API key", results: [] };
  const base = (cfg.youtubeApiUrl || "https://www.googleapis.com/youtube/v3").replace(/\/$/, "");
  const res = await fetch(
    `${base}/search?part=snippet&type=video&maxResults=${Math.min(max, 25)}&q=${encodeURIComponent(query)}&key=${cfg.youtubeApiKey}`,
    { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { ok: false, error: `${res.status}`, results: [] };
  const data = await res.json();
  const results = (data.items || []).map((i) => ({
    title: String(i.snippet?.title || "").slice(0, 300),
    url: `https://www.youtube.com/watch?v=${i.id?.videoId}`,
    snippet: String(i.snippet?.description || "").slice(0, 600),
    source: "youtube.com",
    sourceType: "SEARCH",
    publishedAt: i.snippet?.publishedAt || null,
  })).filter((r) => r.url.includes("watch?v=undefined") === false);
  return { ok: true, results };
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };

/**
 * Run one provider, respecting its ceiling.
 *
 * A provider that would exceed its cap does not fail the query — it
 * declines, and the caller falls back to a free provider. Degrading is
 * better than a dead feature, and far better than a surprise invoice.
 */
export async function runSearch({ provider, query, topicId = null, max = 15, userId = null }) {
  if (!PROVIDERS.includes(provider)) return { ok: false, error: `Unknown provider ${provider}` };
  const cfg = await searchCfg();
  const b = (await budgets())[provider];

  if (!b?.active) {
    await logSearch({ provider, query, topicId, status: "SKIPPED", detail: "provider is switched off", userId });
    return { ok: false, inactive: true, error: `${provider} is switched off for this instance`, results: [] };
  }
  if (b.exhausted) {
    await logSearch({ provider, query, topicId, status: "CAPPED",
      detail: `monthly cap reached ($${b.spentThisMonth}/$${b.monthlyCapUsd})`, userId });
    return { ok: false, capped: true, error: `${provider} has spent its budget for this month`, results: [] };
  }

  try {
    let out;
    if (provider === "WEB") out = await searchWeb(query, cfg);
    else if (provider === "X") out = await searchX(query, cfg, max);
    else if (provider === "REDDIT") out = await searchReddit(query, cfg, max);
    else out = await searchYouTube(query, cfg, max);

    if (!out.ok) {
      await logSearch({ provider, query, topicId, status: "FAILED", detail: out.error, userId });
      return { ok: false, error: out.error, results: [] };
    }
    const costUsd = provider === "WEB"
      ? Number(out.costUsd || 0)
      : Number(b.costPerUnit) * (out.reads ?? out.results.length);

    await logSearch({ provider, query, topicId, results: out.results.length, costUsd, status: "OK", userId });
    return { ok: true, provider, results: out.results, costUsd };
  } catch (e) {
    await logSearch({ provider, query, topicId, status: "FAILED", detail: e.message, userId });
    return { ok: false, error: String(e.message).slice(0, 200), results: [] };
  }
}

/**
 * Search, then feed the pipeline.
 *
 * Note what this does NOT do: write straight into the metrics. Results
 * are graded exactly like RSS — source registered at D, near-duplicates
 * clustered, relevance scored, anything ambiguous quarantined as PENDING
 * for an analyst — then entity-resolved. A live result and a feed result
 * are the same kind of thing by the time they reach a number.
 */
export async function searchAndIngest({ provider, query, topicId, max = 15, userId = null }) {
  const topic = await get(`SELECT * FROM osint_topics WHERE id = $1`, [topicId]);
  if (!topic) return { ok: false, error: "Topic not found" };

  let r = await runSearch({ provider, query, topicId, max, userId });

  // degrade rather than fail: a capped provider falls back to a free one
  let degradedFrom = null;
  if (!r.ok && (r.capped || r.inactive)) {
    for (const alt of FREE_PROVIDERS) {
      const t = await runSearch({ provider: alt, query, topicId, max, userId });
      if (t.ok && t.results.length) { degradedFrom = provider; r = t; break; }
    }
  }
  if (!r.ok) return { ok: false, error: r.error, capped: r.capped, inactive: r.inactive };

  const { gradeSignal } = await import("./routes/osint.js");
  const { linkSignalEntities } = await import("./osint/entities.js");

  let inserted = 0, quarantined = 0, syndicated = 0, skipped = 0;
  for (const s of r.results) {
    if (!s.title || !s.url) { skipped++; continue; }
    const dup = await get(`SELECT 1 FROM osint_signals WHERE "topicId" = $1 AND url = $2`, [topicId, s.url]);
    if (dup) { skipped++; continue; }

    const g = await gradeSignal(topic, s);
    if (g.reviewStatus === "PENDING") quarantined++;
    if (!g.canonical) syndicated++;

    await run(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, snippet, lang,
         "publishedAt", credibility, relevance, "clusterId", canonical, "reviewStatus", "contentHash")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [topicId, s.source || null, s.sourceType || "SEARCH", s.title, s.url, s.snippet || null,
       s.lang || null, s.publishedAt || null, g.credibility, g.relevance, g.clusterId,
       g.canonical, g.reviewStatus, g.contentHash]);
    inserted++;

    const fresh = await get(
      `SELECT id FROM osint_signals WHERE "topicId" = $1 AND url = $2 LIMIT 1`, [topicId, s.url]);
    if (fresh) await linkSignalEntities(fresh.id, `${s.title} ${s.snippet || ""}`).catch(() => {});
  }

  await run(`UPDATE search_runs SET ingested = $2 WHERE provider = $3 AND query = $4
             AND at = (SELECT MAX(at) FROM search_runs WHERE provider = $3 AND query = $4)`,
    [null, inserted, r.provider, String(query).slice(0, 300)]).catch(() => {});

  return {
    ok: true, provider: r.provider, degradedFrom,
    found: r.results.length, inserted, quarantined, syndicated, skipped,
    costUsd: Number(r.costUsd || 0),
  };
}
