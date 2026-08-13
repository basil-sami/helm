import { all, get, run } from "../db.js";
import { groundedComplete, complete, cacheKeyFor } from "../ai.js";

// ═══ AI-SUPERCHARGED LISTENING (Wave 3·E) ════════════════════════════
// Wave 2 made listening trustworthy. This makes it fast — without
// spending the trust. Every function here produces a recommendation or a
// draft. None of them rule, and none of them write to a metric.

// The keyword gate is decisive at the extremes and weakest in the middle.
// Only the middle is worth a model's time — and the cost stays bounded
// because the band is narrow.
export const BAND_LOW = 0.35, BAND_HIGH = 0.65;

/**
 * Ask the model whether an ambiguous signal is actually about this topic.
 *
 * The verdict is written to `aiVerdict` — beside the analyst's ruling,
 * never into it. A model may recommend; it may not rule. Those rulings
 * are the ground truth that tunes the thresholds, and a model marking its
 * own homework would quietly destroy the measurement.
 */
export async function adjudicateRelevance(signalId) {
  const s = await get(
    `SELECT s.*, t.label AS "topicLabel", t.query, t."mustInclude", t."mustExclude", t."contextTerms"
     FROM osint_signals s JOIN osint_topics t ON t.id = s."topicId" WHERE s.id = $1`, [signalId]);
  if (!s) return { ok: false, error: "Signal not found" };

  const rel = Number(s.relevance ?? 0.5);
  if (rel < BAND_LOW || rel > BAND_HIGH) {
    return { ok: false, skipped: true, reason: "outside the ambiguous band — the keyword gate is already decisive here" };
  }

  const j = (v) => { try { const p = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };
  const evidence = [
    { kind: "signal", id: s.id, text: `Headline: ${s.title}${s.snippet ? ` — ${s.snippet.slice(0, 300)}` : ""}` },
    { kind: "topic", id: s.topicId, text: `Topic being monitored: ${s.topicLabel} (search: ${s.query || "—"})` },
  ];
  const mi = j(s.mustInclude), me = j(s.mustExclude), ct = j(s.contextTerms);
  if (mi.length) evidence.push({ kind: "topic", id: "mustInclude", text: `Must concern: ${mi.join(", ")}` });
  if (me.length) evidence.push({ kind: "topic", id: "mustExclude", text: `Must NOT be about: ${me.join(", ")}` });
  if (ct.length) evidence.push({ kind: "topic", id: "context", text: `Relevant context: ${ct.join(", ")}` });

  const r = await groundedComplete({
    feature: "relevance_adjudication",
    cacheKey: cacheKeyFor("relevance_adjudication", { t: s.title, topic: s.topicId }),
    system: [
      "Decide whether the headline genuinely concerns the monitored topic.",
      "Many Arabic names are also ordinary words — سارية is a flagpole, النيل is a river and half of Sudanese commerce.",
      "Answer on one line: RELEVANT, NOT_RELEVANT or UNSURE, then a short reason citing the evidence.",
      "Prefer UNSURE over guessing.",
    ].join(" "),
    question: "Does this headline concern the monitored topic?",
    evidence,
    maxTokens: 300,
  });
  if (!r.ok) return { ok: false, abstained: !!r.abstained, reason: r.reason || r.error };

  const verdict = /NOT_RELEVANT/i.test(r.text) ? "NOT_RELEVANT"
    : /\bRELEVANT\b/i.test(r.text) ? "RELEVANT" : "UNSURE";

  await run(
    `UPDATE osint_signals SET "aiVerdict" = $2, "aiReason" = $3,
       "aiRelevance" = CASE WHEN $2 = 'RELEVANT' THEN 0.8 WHEN $2 = 'NOT_RELEVANT' THEN 0.2 ELSE 0.5 END
     WHERE id = $1`, [s.id, verdict, r.text.slice(0, 400)]);

  // NOTE: reviewStatus is deliberately untouched. This is a recommendation
  // sitting next to the queue, not a decision taken from the analyst.
  return { ok: true, verdict, reason: r.text, cached: !!r.cached };
}

/** Sweep the ambiguous band — bounded by design, and never the whole corpus. */
export async function adjudicatePending({ limit = 15 } = {}) {
  const rows = await all(
    `SELECT id FROM osint_signals
     WHERE "reviewStatus" = 'PENDING' AND "aiVerdict" IS NULL
       AND relevance BETWEEN $1 AND $2
     ORDER BY "fetchedAt" DESC LIMIT ${Number(limit)}`, [BAND_LOW, BAND_HIGH]);
  let done = 0, unsure = 0;
  for (const r of rows) {
    const out = await adjudicateRelevance(r.id);
    if (out.ok) { done++; if (out.verdict === "UNSURE") unsure++; }
  }
  return { considered: rows.length, adjudicated: done, unsure };
}

/**
 * Does the model actually agree with the analysts?
 *
 * Measured, never assumed — and only over signals a human has ruled on,
 * so the number means something.
 */
export async function relevanceAgreement({ days = 30 } = {}) {
  const rows = await all(
    `SELECT "reviewStatus", "aiVerdict" FROM osint_signals
     WHERE "aiVerdict" IN ('RELEVANT','NOT_RELEVANT')
       AND "reviewStatus" IN ('CONFIRMED','REJECTED')
       AND "fetchedAt" >= now() - ($1 || ' days')::interval`, [String(days)]);
  if (!rows.length) return { ruled: 0, agreed: 0, pct: null };
  const agreed = rows.filter((r) =>
    (r.reviewStatus === "CONFIRMED" && r.aiVerdict === "RELEVANT") ||
    (r.reviewStatus === "REJECTED" && r.aiVerdict === "NOT_RELEVANT")).length;
  return { ruled: rows.length, agreed, pct: Math.round((agreed / rows.length) * 100) };
}

/**
 * Theme clustering — the feature a GM actually uses.
 *
 * Groups confirmed signals into named themes with volume and quotes, so
 * the answer to "how are we doing?" is three concrete things rather than
 * one averaged number.
 */
export async function clusterThemes(topicId, { days = 30, limit = 60 } = {}) {
  const topic = await get(`SELECT * FROM osint_topics WHERE id = $1`, [topicId]);
  if (!topic) return { ok: false, error: "Topic not found" };

  const rows = await all(
    `SELECT id, title, snippet, "sentimentLabel" FROM osint_signals
     WHERE "topicId" = $1 AND canonical = true AND "reviewStatus" IN ('AUTO','CONFIRMED')
       AND "fetchedAt" >= now() - ($2 || ' days')::interval
     ORDER BY "publishedAt" DESC NULLS LAST LIMIT ${Number(limit)}`, [topicId, String(days)]);
  if (rows.length < 4) {
    return { ok: false, abstained: true, reason: "not enough confirmed signals to find themes", count: rows.length };
  }

  const evidence = rows.map((r) => ({
    kind: "signal", id: r.id,
    text: `${r.title}${r.snippet ? ` — ${r.snippet.slice(0, 150)}` : ""}`,
  }));

  const r = await groundedComplete({
    feature: "theme_clustering",
    cacheKey: cacheKeyFor("theme_clustering", { topicId, ids: rows.map((x) => x.id) }),
    system: [
      "Group the evidence into at most five recurring themes — what people are talking about, not how they feel.",
      "For each theme output one line exactly as:",
      "THEME | short Arabic label | short English label | citations like [1][4][7]",
      "Only group things that genuinely recur. Fewer, truer themes beat more, vaguer ones.",
    ].join(" "),
    question: `What recurring themes appear in coverage of "${topic.label}"?`,
    evidence,
    maxTokens: 900,
  });
  if (!r.ok) return { ok: false, abstained: !!r.abstained, reason: r.reason || r.error };

  const created = [];
  for (const line of String(r.text).split("\n")) {
    if (!/^\s*THEME\s*\|/i.test(line)) continue;
    const parts = line.split("|").map((p) => p.trim());
    const labelAr = parts[1] || null, label = parts[2] || parts[1] || null;
    if (!label) continue;
    const cites = [...(parts[3] || "").matchAll(/\[(\d+)\]/g)]
      .map((m) => Number(m[1])).filter((n) => n >= 1 && n <= rows.length);
    if (!cites.length) continue;                    // a theme with no evidence is not a theme

    const signals = [...new Set(cites)].map((n) => rows[n - 1]);
    const pos = signals.filter((s) => s.sentimentLabel === "POS").length;
    const neg = signals.filter((s) => s.sentimentLabel === "NEG").length;

    const prior = await get(
      `SELECT COUNT(*)::int c FROM osint_signals
       WHERE "topicId" = $1 AND canonical = true
         AND "fetchedAt" < now() - ($2 || ' days')::interval
         AND "fetchedAt" >= now() - (($2::int * 2) || ' days')::interval
         AND (title ILIKE '%' || $3 || '%' OR snippet ILIKE '%' || $3 || '%')`,
      [topicId, String(days), (labelAr || label).slice(0, 20)]).catch(() => ({ c: 0 }));

    const theme = await get(
      `INSERT INTO osint_themes (label, "labelAr", "topicId", sentiment, "signalCount", "priorCount",
         emerging, "firstSeenAt", "lastSeenAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now()) RETURNING *`,
      [label, labelAr, topicId,
       signals.length ? Number(((pos - neg) / signals.length).toFixed(2)) : null,
       signals.length, prior?.c || 0,
       signals.length >= 3 && (prior?.c || 0) * 2 < signals.length]);

    for (const s of signals) {
      await run(`INSERT INTO osint_theme_signals ("themeId", "signalId", quote)
                 VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [theme.id, s.id, (s.title || "").slice(0, 300)]).catch(() => {});
    }
    created.push(theme);
  }

  return { ok: true, themes: created, scanned: rows.length, cached: !!r.cached };
}

/**
 * Query expansion learned from real rulings.
 *
 * The review queue is a labelled dataset. What analysts actually rejected
 * tells us what the gate should have excluded — and every ruling makes it
 * sharper. Proposals only; a person applies them.
 */
export async function suggestTerms(topicId) {
  const topic = await get(`SELECT * FROM osint_topics WHERE id = $1`, [topicId]);
  if (!topic) return { ok: false, error: "Topic not found" };

  const rejected = await all(
    `SELECT title FROM osint_signals WHERE "topicId" = $1 AND "reviewStatus" = 'REJECTED'
     ORDER BY "fetchedAt" DESC LIMIT 20`, [topicId]);
  const confirmed = await all(
    `SELECT title FROM osint_signals WHERE "topicId" = $1 AND "reviewStatus" = 'CONFIRMED'
     ORDER BY "fetchedAt" DESC LIMIT 20`, [topicId]);
  if (rejected.length < 3) {
    return { ok: false, abstained: true, reason: "not enough rejected signals to learn from", rejected: rejected.length };
  }

  const evidence = [
    ...rejected.map((r, i) => ({ kind: "rejected", id: `r${i}`, text: `REJECTED by an analyst: ${r.title}` })),
    ...confirmed.map((r, i) => ({ kind: "confirmed", id: `c${i}`, text: `CONFIRMED by an analyst: ${r.title}` })),
  ];

  const r = await groundedComplete({
    feature: "query_expansion",
    cacheKey: cacheKeyFor("query_expansion", { topicId, n: evidence.length }),
    system: [
      "Analysts rejected some results and confirmed others. Propose terms that would have separated them.",
      "Output exactly two lines:",
      "EXCLUDE: term [n], term [n]",
      "INCLUDE: term [n], term [n]",
      "Cite the evidence each term came from — a term you cannot point at is a guess, not a finding.",
      "Use terms that actually appear in the evidence. Propose few and precise, not many and broad.",
    ].join(" "),
    question: `Which terms would sharpen monitoring of "${topic.label}"?`,
    evidence,
    maxTokens: 300,
  });
  if (!r.ok) return { ok: false, abstained: !!r.abstained, reason: r.reason || r.error };

  const grab = (tag) => {
    const line = String(r.text).split("\n").find((l) => new RegExp(`^\\s*${tag}\\s*:`, "i").test(l));
    return line ? line.split(":").slice(1).join(":").split(/[,،]/).map((t) => t.trim().replace(/\[\d+\]/g, "").trim())
      .filter((t) => t && t.length > 1).slice(0, 8) : [];
  };
  const suggested = { exclude: grab("EXCLUDE"), include: grab("INCLUDE"), at: new Date().toISOString() };
  await run(`UPDATE osint_topics SET "suggestedTerms" = $2 WHERE id = $1`, [topicId, JSON.stringify(suggested)]);
  return { ok: true, suggested, learnedFrom: { rejected: rejected.length, confirmed: confirmed.length } };
}

/**
 * A competitor brief — from corroborated clusters only.
 *
 * The corroboration engine exists precisely so a model cannot launder a
 * single-source rumour into a board pack.
 */
export async function competitorBrief(entityId, { days = 30 } = {}) {
  const entity = await get(`SELECT * FROM osint_entities WHERE id = $1`, [entityId]);
  if (!entity) return { ok: false, error: "Entity not found" };

  const rows = await all(
    `SELECT s.id, s.title, s.source, se."sentimentLabel", s."corroborationCount"
     FROM osint_signal_entities se JOIN osint_signals s ON s.id = se."signalId"
     WHERE se."entityId" = $1 AND s.canonical = true AND s."reviewStatus" <> 'REJECTED'
       AND s.corroborated = true
       AND s."fetchedAt" >= now() - ($2 || ' days')::interval
     ORDER BY s."publishedAt" DESC NULLS LAST LIMIT 25`, [entityId, String(days)]);
  if (rows.length < 2) {
    return {
      ok: false, abstained: true,
      reason: "not enough corroborated coverage to brief on — single-source stories are deliberately excluded",
      corroborated: rows.length,
    };
  }

  const evidence = rows.map((r) => ({
    kind: "signal", id: r.id,
    text: `${r.source || "unknown"} (${r.sentimentLabel || "NEU"}, ${r.corroborationCount} independent sources): ${r.title}`,
  }));

  const r = await groundedComplete({
    feature: "competitor_brief",
    cacheKey: cacheKeyFor("competitor_brief", { entityId, ids: rows.map((x) => x.id) }),
    system: "Write a short competitor brief for a general manager: what they did, what changed, what to watch. Arabic. Cite every claim. Say plainly where the evidence is thin.",
    question: `Brief me on ${entity.nameAr || entity.name} over the last ${days} days.`,
    evidence,
    maxTokens: 800,
  });
  if (!r.ok) return { ok: false, abstained: !!r.abstained, reason: r.reason || r.error };

  const insight = await get(
    `INSERT INTO insights (title, "titleAr", body, source, impact, status, "aiGenerated", "signalIds")
     VALUES ($1,$2,$3,'LISTENING','MEDIUM','DRAFT',true,$4) RETURNING *`,
    [`Competitor brief — ${entity.name}`, `موجز عن ${entity.nameAr || entity.name}`,
     r.text, JSON.stringify(r.citations.map((c) => c.id))]);

  return { ok: true, insight, basedOn: rows.length, cached: !!r.cached };
}
