import { all, get, run } from "../db.js";
import { domainOf } from "./validate.js";

// ═══ CORROBORATION & TUNING (Wave 2·E · P4) ══════════════════════════

export const MIN_INDEPENDENT_SOURCES = 2;

/**
 * How many *independent* sources carry a story.
 *
 * Independence is judged by owner, not by masthead: a media group's six
 * brands republishing one wire report is one source, not six. Where an
 * owner is unknown we fall back to the registrable domain.
 */
export async function corroborationFor(clusterId) {
  if (!clusterId) return { count: 1, owners: [] };
  const rows = await all(
    `SELECT s.url, s.source, src."ownerGroup", src.domain
     FROM osint_signals s
     LEFT JOIN osint_sources src ON s.url LIKE '%' || src.domain || '%'
     WHERE s."clusterId" = $1 AND s."reviewStatus" <> 'REJECTED'`, [clusterId]);

  const owners = new Set();
  for (const r of rows) {
    const key = (r.ownerGroup && r.ownerGroup.trim())
      || r.domain
      || domainOf(r.url || "")
      || (r.source || "unknown");
    owners.add(String(key).toLowerCase());
  }
  return { count: owners.size, owners: [...owners] };
}

/** Recompute corroboration across recent clusters. */
export async function corroborationSweep({ days = 60 } = {}) {
  const clusters = await all(
    `SELECT DISTINCT "clusterId" FROM osint_signals
     WHERE "clusterId" IS NOT NULL AND "fetchedAt" >= now() - ($1 || ' days')::interval`, [String(days)]);
  let corroborated = 0;
  for (const c of clusters) {
    const { count } = await corroborationFor(c.clusterId);
    const ok = count >= MIN_INDEPENDENT_SOURCES;
    if (ok) corroborated++;
    await run(
      `UPDATE osint_signals SET "corroborationCount" = $2, corroborated = $3 WHERE "clusterId" = $1`,
      [c.clusterId, count, ok]).catch(() => {});
  }
  return { clusters: clusters.length, corroborated };
}

/**
 * Threshold tuning from the analysts' own rulings.
 *
 * Their confirms and rejects are labels. We can therefore measure what a
 * given threshold *would have* done, and recommend one — rather than
 * asserting a precision number the system never verified.
 */
export async function tuningFor(topicId = null) {
  const topics = await all(
    topicId
      ? `SELECT id, label, "reviewThreshold" FROM osint_topics WHERE id = $1`
      : `SELECT id, label, "reviewThreshold" FROM osint_topics ORDER BY label`,
    topicId ? [topicId] : []);

  const out = [];
  for (const t of topics) {
    const ruled = await all(
      `SELECT relevance, "reviewStatus" FROM osint_signals
       WHERE "topicId" = $1 AND "reviewStatus" IN ('CONFIRMED','REJECTED')`, [t.id]);

    if (ruled.length < 5) {
      out.push({
        topicId: t.id, label: t.label, threshold: Number(t.reviewThreshold),
        ruled: ruled.length, enough: false,
        note: "Not enough rulings yet to recommend a change",
      });
      continue;
    }

    // sweep candidate thresholds and score each against what humans decided
    let best = null;
    for (let th = 0.2; th <= 0.85; th = Number((th + 0.05).toFixed(2))) {
      let tp = 0, fp = 0, fn = 0;
      for (const r of ruled) {
        const kept = Number(r.relevance) >= th;         // above threshold = auto-kept
        const good = r.reviewStatus === "CONFIRMED";
        if (kept && good) tp++;
        else if (kept && !good) fp++;
        else if (!kept && good) fn++;
      }
      const precision = tp + fp ? tp / (tp + fp) : 0;
      const recall = tp + fn ? tp / (tp + fn) : 0;
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      if (!best || f1 > best.f1) best = { threshold: th, precision, recall, f1 };
    }

    const current = (() => {
      const th = Number(t.reviewThreshold);
      let tp = 0, fp = 0, fn = 0;
      for (const r of ruled) {
        const kept = Number(r.relevance) >= th, good = r.reviewStatus === "CONFIRMED";
        if (kept && good) tp++; else if (kept && !good) fp++; else if (!kept && good) fn++;
      }
      const p = tp + fp ? tp / (tp + fp) : 0, rc = tp + fn ? tp / (tp + fn) : 0;
      return { precision: p, recall: rc, f1: p + rc ? (2 * p * rc) / (p + rc) : 0 };
    })();

    out.push({
      topicId: t.id, label: t.label, threshold: Number(t.reviewThreshold), ruled: ruled.length, enough: true,
      current: { precision: Math.round(current.precision * 100), recall: Math.round(current.recall * 100) },
      recommended: {
        threshold: best.threshold,
        precision: Math.round(best.precision * 100),
        recall: Math.round(best.recall * 100),
      },
      gain: Math.round((best.f1 - current.f1) * 100),
    });
  }
  return out;
}

/** A claim stands on two independent legs, or it says so. */
export async function assessInsight(signalIds = []) {
  if (!signalIds.length) return { corroborated: false, sources: 0, owners: [] };
  const rows = await all(
    `SELECT s.url, s.source, src."ownerGroup", src.domain
     FROM osint_signals s LEFT JOIN osint_sources src ON s.url LIKE '%' || src.domain || '%'
     WHERE s.id = ANY($1::uuid[])`, [signalIds]);
  const owners = new Set(rows.map((r) =>
    String((r.ownerGroup && r.ownerGroup.trim()) || r.domain || domainOf(r.url || "") || r.source || "unknown").toLowerCase()));
  return { corroborated: owners.size >= MIN_INDEPENDENT_SOURCES, sources: owners.size, owners: [...owners] };
}
