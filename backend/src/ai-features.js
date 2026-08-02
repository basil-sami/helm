import { all, get, run } from "./db.js";
import { groundedComplete, complete, cacheKeyFor } from "./ai.js";

// ═══ AI FEATURES (Wave 3·C) ══════════════════════════════════════════
// Each one assembles its own evidence, hands over only that, and writes a
// DRAFT. Nothing here writes a fact, sends a message, or rules a queue.

/**
 * Explain an anomaly.
 *
 * The single highest-value use of a model in this product: turning
 * "leads fell 30%" into ranked competing explanations, each pointing at
 * something that actually changed. The output lands in the ACH-lite
 * `insights.hypotheses` field as a DRAFT — a person accepts or dismisses it.
 */
export async function explainAnomaly(alertId, { userId = null } = {}) {
  const alert = await get(
    `SELECT a.*, m.name AS label, m."nameAr" AS "labelAr", m.unit FROM metric_alerts a
     JOIN metrics m ON m.key = a."metricKey" WHERE a.id = $1`, [alertId]);
  if (!alert) return { ok: false, error: "Alert not found" };

  const evidence = [];

  // 1 · the metric's own recent shape
  const series = await all(
    `SELECT date, value FROM metric_snapshots WHERE "metricKey" = $1
     ORDER BY date DESC LIMIT 21`, [alert.metricKey]);
  if (series.length >= 3) {
    const recent = series.slice(0, 7).map((r) => Number(r.value));
    const prior = series.slice(7, 14).map((r) => Number(r.value));
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    evidence.push({
      kind: "metric", id: alert.metricKey,
      text: `Metric "${alert.label}" averaged ${avg(recent).toFixed(1)} over the last 7 days versus ${avg(prior).toFixed(1)} the week before.`,
    });
  }

  // 2 · other metrics that moved in the same window
  const movers = await all(
    `WITH w AS (
       SELECT "metricKey",
              AVG(value) FILTER (WHERE date >= CURRENT_DATE - 7) AS recent,
              AVG(value) FILTER (WHERE date < CURRENT_DATE - 7 AND date >= CURRENT_DATE - 14) AS prior
       FROM metric_snapshots WHERE date >= CURRENT_DATE - 14 GROUP BY "metricKey")
     SELECT w."metricKey", m.name AS label, w.recent, w.prior,
            CASE WHEN w.prior > 0 THEN (w.recent - w.prior) / w.prior * 100 ELSE NULL END AS "pctChange"
     FROM w JOIN metrics m ON m.key = w."metricKey"
     WHERE w.prior IS NOT NULL AND w.recent IS NOT NULL AND w.prior > 0
       AND ABS((w.recent - w.prior) / w.prior) > 0.15 AND w."metricKey" <> $1
     ORDER BY ABS((w.recent - w.prior) / w.prior) DESC LIMIT 6`, [alert.metricKey]);
  for (const m of movers) {
    evidence.push({
      kind: "metric", id: m.metricKey,
      text: `Metric "${m.label}" moved ${Number(m.pctChange).toFixed(0)}% over the same period (${Number(m.prior).toFixed(1)} → ${Number(m.recent).toFixed(1)}).`,
    });
  }

  // 3 · spend changes
  const spend = await all(
    `SELECT platform,
            SUM("amountUsd") FILTER (WHERE date >= CURRENT_DATE - 7) AS recent,
            SUM("amountUsd") FILTER (WHERE date < CURRENT_DATE - 7 AND date >= CURRENT_DATE - 14) AS prior
     FROM ad_spend WHERE date >= CURRENT_DATE - 14 GROUP BY platform`).catch(() => []);
  for (const s of spend) {
    if (Number(s.recent || 0) === Number(s.prior || 0)) continue;
    evidence.push({
      kind: "spend", id: s.platform,
      text: `Paid spend on ${s.platform} was $${Number(s.recent || 0).toFixed(0)} in the last 7 days versus $${Number(s.prior || 0).toFixed(0)} the week before.`,
    });
  }

  // 4 · what listening was saying, corroborated only
  const signals = await all(
    `SELECT s.id, s.title, s."sentimentLabel", s.source FROM osint_signals s
     WHERE s.canonical = true AND s."reviewStatus" <> 'REJECTED'
       AND s."fetchedAt" >= now() - interval '14 days'
       AND (s.corroborated = true OR s."sentimentLabel" = 'NEG')
     ORDER BY s."publishedAt" DESC NULLS LAST LIMIT 6`).catch(() => []);
  for (const s of signals) {
    evidence.push({ kind: "signal", id: s.id, text: `Listening (${s.source || "unknown"}, ${s.sentimentLabel}): ${s.title}` });
  }

  // 5 · publishing gaps
  const pub = await get(
    `SELECT COUNT(*) FILTER (WHERE "scheduledAt" >= now() - interval '7 days') AS recent,
            COUNT(*) FILTER (WHERE "scheduledAt" < now() - interval '7 days'
                             AND "scheduledAt" >= now() - interval '14 days') AS prior
     FROM scheduled_posts WHERE status = 'PUBLISHED'`).catch(() => null);
  if (pub && Number(pub.recent) !== Number(pub.prior)) {
    evidence.push({
      kind: "publish", id: "scheduled_posts",
      text: `${pub.recent} posts published in the last 7 days versus ${pub.prior} the week before.`,
    });
  }

  const r = await groundedComplete({
    feature: "anomaly_explanation",
    cacheKey: cacheKeyFor("anomaly_explanation", { alertId, evidence: evidence.map((e) => e.text) }),
    system: [
      "You are a marketing analyst explaining why a metric moved.",
      "Give at most three competing explanations, ranked by how well the evidence supports them.",
      "Format each as: a one-line hypothesis, then the citation(s), then a one-line note on what would confirm or rule it out.",
      "Be plain and short. Never assert a cause the evidence cannot support — say what is consistent with it.",
    ].join(" "),
    question: `The alert "${alert.label}" fired (condition ${alert.condition}, threshold ${alert.threshold}). What could explain this?`,
    evidence,
  });

  if (!r.ok) return { ok: false, abstained: !!r.abstained, reason: r.reason || r.error, evidenceCount: evidence.length };

  const signalIds = r.citations.filter((c) => c.kind === "signal").map((c) => c.id);
  const row = await get(
    `INSERT INTO insights (title, "titleAr", body, source, impact, status, "aiGenerated", "alertId",
       hypotheses, "signalIds")
     VALUES ($1,$2,$3,'DATA','MEDIUM','DRAFT',true,$4,$5,$6) RETURNING *`,
    [`Why "${alert.label}" moved`, `لماذا تحرّك مؤشر "${alert.labelAr || alert.label}"`,
     r.text, alert.id,
     JSON.stringify(r.citations.map((c) => ({ kind: c.kind, id: c.id, text: c.text }))),
     JSON.stringify(signalIds)]);

  return { ok: true, insight: row, evidenceCount: evidence.length, cached: !!r.cached, userId };
}

/** Two or three sentences over numbers already computed. Cheap and daily. */
export async function narrateMorning(digest) {
  const facts = [];
  const push = (t) => t && facts.push({ kind: "digest", id: String(facts.length + 1), text: t });
  push(digest?.pulseIndex != null ? `The Pulse Index is ${digest.pulseIndex} out of 100.` : null);
  push(digest?.newLeads != null ? `${digest.newLeads} new leads arrived yesterday.` : null);
  push(digest?.dueTasks != null ? `${digest.dueTasks} tasks are due today.` : null);
  push(digest?.alerts != null ? `${digest.alerts} metric alerts are open.` : null);
  push(digest?.publishDue != null ? `${digest.publishDue} posts are scheduled to go out today.` : null);
  if (facts.length < 2) return { ok: false, abstained: true, reason: "not enough to say" };

  return await groundedComplete({
    feature: "morning_narrative",
    cacheKey: cacheKeyFor("morning_narrative", facts.map((f) => f.text)),
    system: "Write two or three short sentences for a busy general manager, in Arabic. State what matters and what to do first. No greeting, no filler, no invented numbers.",
    question: "Summarise today's position.",
    evidence: facts,
    maxTokens: 400,
  });
}

/** A creative brief drafted from the request and the brand's own voice. */
export async function draftBrief(requestId) {
  const req = await get(
    `SELECT cr.*, c.name AS "campaignName" FROM creative_requests cr
     LEFT JOIN campaigns c ON c.id = cr."campaignId" WHERE cr.id = $1`, [requestId]);
  if (!req) return { ok: false, error: "Request not found" };

  const evidence = [{ kind: "request", id: req.id, text: `Request: ${req.title}. ${req.brief || ""}`.trim() }];
  if (req.campaignName) evidence.push({ kind: "campaign", id: req.campaignId, text: `Campaign: ${req.campaignName}` });

  const tone = await all(`SELECT label, "labelAr", value FROM brand_assets WHERE kind = 'TONE' LIMIT 6`).catch(() => []);
  for (const t of tone) evidence.push({ kind: "brand", id: t.label, text: `Brand tone — ${t.label}: ${t.value || t.labelAr || ""}` });
  const copy = await all(
    `SELECT text, "textAr" FROM copy_bank WHERE approved = true ORDER BY "createdAt" DESC LIMIT 5`).catch(() => []);
  for (const c of copy) evidence.push({ kind: "copy", id: "copy_bank", text: `Approved copy: ${c.textAr || c.text}` });

  const r = await groundedComplete({
    feature: "creative_brief",
    cacheKey: cacheKeyFor("creative_brief", { id: req.id, n: evidence.length }),
    system: "Draft a short creative brief: objective, audience, key message, tone, deliverables. Follow the brand's own voice from the evidence. Arabic if the request is Arabic.",
    question: `Draft a creative brief for: ${req.title}`,
    evidence,
    maxTokens: 900,
  });
  if (!r.ok) return { ok: false, abstained: !!r.abstained, reason: r.reason || r.error };

  // The brief lands as a draft row in the existing Studio table — the
  // approval chain there is what catches it before anyone acts on it.
  const row = await get(
    `INSERT INTO creative_briefs (title, "requestId", spec, format) VALUES ($1,$2,$3,$4) RETURNING *`,
    [`${req.title} — draft`, req.id, r.text.slice(0, 4000), req.kind || null]).catch(() => null);
  return { ok: true, text: r.text, brief: row };
}
