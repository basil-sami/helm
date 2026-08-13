import crypto from "crypto";

// ═══ SIGNAL VALIDATION (Wave 2·E) ════════════════════════════════════
// Three questions asked of every incoming signal, in order:
//   1. Who said it?      → source registry → Admiralty credibility
//   2. Have we heard it? → SimHash cluster → syndication, counted once
//   3. Is it about us?   → relevance gate  → quarantine if unsure
// A signal that cannot answer the third confidently never reaches a KPI.

// ── Arabic-aware normalization ───────────────────────────────────────
// Arabic surfaces the same word many ways; comparing raw strings makes
// duplicate detection and term matching quietly unreliable.
export function normalize(text = "") {
  return String(text)
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")   // diacritics + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const tokens = (text) => normalize(text).split(" ").filter((w) => w.length > 1);

export const contentHash = (text) => crypto.createHash("sha256").update(normalize(text)).digest("hex").slice(0, 32);

// ── SimHash: near-duplicate detection ────────────────────────────────
// One agency story republished by a dozen outlets is one story. Exact
// URL matching never caught that; a fingerprint over the text does.
export function simhash(text) {
  const bits = new Array(64).fill(0);
  const list = tokens(text);
  if (!list.length) return "0".repeat(16);
  for (const t of list) {
    const h = crypto.createHash("md5").update(t).digest();
    for (let i = 0; i < 64; i++) {
      const bit = (h[i >> 3] >> (i & 7)) & 1;
      bits[i] += bit ? 1 : -1;
    }
  }
  let hex = "";
  for (let nib = 0; nib < 16; nib++) {
    let v = 0;
    for (let b = 0; b < 4; b++) v = (v << 1) | (bits[nib * 4 + b] > 0 ? 1 : 0);
    hex += v.toString(16);
  }
  return hex;
}

export function hamming(a = "", b = "") {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export const NEAR_DUP_DISTANCE = 3;

/**
 * Token overlap, as a second opinion.
 * SimHash over a short headline is brittle: inserting one word ("today")
 * into an eleven-token title moves ~5 bits, past any sane threshold. So a
 * pair counts as the same story if EITHER the fingerprints are close OR
 * the vocabularies substantially agree. Long texts lean on the former,
 * headlines on the latter.
 */
export function jaccard(a = [], b = []) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export const JACCARD_DUP = 0.7;

export function isNearDuplicate(textA, textB) {
  if (hamming(simhash(textA), simhash(textB)) <= NEAR_DUP_DISTANCE) return true;
  return jaccard(tokens(textA), tokens(textB)) >= JACCARD_DUP;
}

// ── Admiralty Code ───────────────────────────────────────────────────
// Source reliability (A–F) sets the default information credibility
// (1–6). An unrated blog and a wire service stop weighing the same.
const RELIABILITY_TO_CREDIBILITY = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };
export const credibilityFor = (reliability) => RELIABILITY_TO_CREDIBILITY[reliability] || 4;

// Kind priors nudge relevance: a wire report is likelier to be real news
// about a company than a forum post mentioning the same word.
const KIND_PRIOR = { WIRE: 0.15, NEWS: 0.12, GOV: 0.15, TRADE: 0.1, AGGREGATOR: 0.02, BLOG: 0, SOCIAL: -0.05, FORUM: -0.08 };

export function domainOf(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

// ── The relevance gate ───────────────────────────────────────────────
/**
 * Score 0–1 that this signal is really about the topic.
 * Below the topic's threshold the signal is quarantined for review and
 * kept out of every metric until a human rules on it.
 */
export function scoreRelevance({ title = "", snippet = "", topic = {}, source = null }) {
  const parse = (v) => { try { const x = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(x) ? x : []; } catch { return []; } };
  const must = parse(topic.mustInclude).map(normalize).filter(Boolean);
  const never = parse(topic.mustExclude).map(normalize).filter(Boolean);
  const context = parse(topic.contextTerms).map(normalize).filter(Boolean);

  const t = normalize(title), sn = normalize(snippet), both = `${t} ${sn}`;

  // an excluded term is decisive: "سارية" next to "علم" is a flagpole
  for (const x of never) if (x && both.includes(x)) return { score: 0, reason: `excluded:${x}` };

  // every required term must appear somewhere
  for (const m of must) if (m && !both.includes(m)) return { score: 0.2, reason: `missing:${m}` };

  let score = 0.4;
  if (must.length) score += 0.25;                                   // all required terms present
  const query = normalize(topic.query || "").split(" ").filter((w) => w.length > 2);
  if (query.length && query.some((q) => t.includes(q))) score += 0.2; // named in the headline, not buried
  const ctxHits = context.filter((c) => both.includes(c)).length;
  if (context.length) score += Math.min(0.25, ctxHits * 0.12);
  if (!must.length && !context.length) score += 0.15;                // untuned topic: don't over-quarantine
  score += KIND_PRIOR[source?.kind] ?? 0;

  return { score: Math.max(0, Math.min(1, Number(score.toFixed(3)))), reason: "scored" };
}
