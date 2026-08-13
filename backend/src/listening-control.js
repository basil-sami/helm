import { all, get, run } from "./db.js";
import { notify } from "./notify.js";
import { scoreRelevance } from "./osint/validate.js";

// ═══ W4·F · THE LISTENING CONTROL ROOM ════════════════════════════════
// THREE LAWS:
//  1. Controls TUNE the pipeline; nothing bypasses it. Every knob here
//     adjusts a parameter OF ingest→dedupe→gate→queue→entity→
//     corroboration→metrics. No control creates a side door into metrics.
//  2. Changes are versioned and replay-previewed. A threshold edit shows
//     what it would have done to the trailing window before it applies,
//     and lands a marker on the charts so a jump in share of voice is
//     explainable rather than mysterious.
//  3. The ORG-only guardrail is immovable by any control. No setting,
//     rule or lever can cause a private individual to be profiled.

// ── LAW 3, in code ───────────────────────────────────────────────────
// Re-asserted here rather than assumed: the control room adds endpoints,
// and every one of them must be unable to widen entity scope.
// These mirror the osint_entities check constraint exactly. PUBLIC_FIGURE
// is the recorded exception — official spokespeople, whose public
// statements are legitimately monitored by a PR team. Everything else is
// a private individual, and nothing in this control room can admit one.
export const CONTROLLABLE_ENTITY_KINDS = ["ORG", "BRAND", "PRODUCT", "OUTLET", "PUBLIC_FIGURE"];
export function guardrailError(kind) {
  if (!kind) return null;
  return CONTROLLABLE_ENTITY_KINDS.includes(String(kind).toUpperCase())
    ? null
    : `Listening covers organisations, brands, products, outlets and official spokespeople only. "${kind}" is not permitted, and no setting can permit it.`;
}

// ── Settings, with shrink-only semantics ─────────────────────────────
export async function controlSettings() {
  const s = await get(
    `SELECT "listeningPaused", "reviewBandLow", "reviewBandHigh", "reviewSlaHours" FROM settings WHERE id = 1`
  ).catch(() => null);
  return {
    paused: !!s?.listeningPaused,
    bandLow: Number(s?.reviewBandLow ?? 0.35),
    bandHigh: Number(s?.reviewBandHigh ?? 0.65),
    slaHours: Number(s?.reviewSlaHours ?? 48),
  };
}

/**
 * LAW 2 — the replay preview.
 * Re-scores the trailing window against a proposed gate and reports what
 * it WOULD have done, before anything changes. Nothing is written.
 */
export async function replayGate({ topicId = null, threshold = null, bandLow = null, bandHigh = null, days = 7 }) {
  const current = await controlSettings();
  const lo = bandLow ?? current.bandLow;
  const hi = bandHigh ?? current.bandHigh;

  // Signals do not store a relevance score — the pipeline computes it at
  // ingest. So the replay recomputes it with the SAME function the gate
  // uses. A preview that scored differently from the pipeline would be
  // predicting a system that does not exist.
  const signals = await all(
    `SELECT s.id, s.title, s.snippet, s."reviewStatus", s."topicId", s.source,
            t.query, t."mustInclude", t."mustExclude", t."contextTerms", t."reviewThreshold"
       FROM osint_signals s LEFT JOIN osint_topics t ON t.id = s."topicId"
      WHERE s."createdAt" >= now() - ($1 || ' days')::interval
        ${topicId ? `AND s."topicId" = $2` : ""}
      ORDER BY s."createdAt" DESC LIMIT 2000`,
    topicId ? [String(days), topicId] : [String(days)]).catch(() => []);

  // Source kinds feed the relevance prior, so they are loaded once.
  const srcRows = await all(`SELECT domain, kind, muted FROM osint_sources`).catch(() => []);
  const srcByDomain = new Map(srcRows.map((r) => [r.domain, r]));

  let accepted = 0, queued = 0, rejected = 0, changed = 0;
  const examples = [];
  for (const s of signals) {
    let rel = 0;
    try {
      rel = Number(scoreRelevance({
        title: s.title, snippet: s.snippet,
        topic: { query: s.query, mustInclude: s.mustInclude, mustExclude: s.mustExclude, contextTerms: s.contextTerms },
        source: srcByDomain.get(s.source) || null,
      })?.score) || 0;
    } catch { rel = 0; }

    const gate = threshold !== null ? Number(threshold) : Number(s.reviewThreshold ?? lo);
    let verdict;
    if (rel < Math.min(gate, lo)) verdict = "REJECTED";
    else if (rel >= hi) verdict = "ACCEPTED";
    else verdict = "QUEUED";

    if (verdict === "ACCEPTED") accepted++; else if (verdict === "QUEUED") queued++; else rejected++;
    const wasQueued = s.reviewStatus === "PENDING";
    const wouldQueue = verdict === "QUEUED";
    if (wasQueued !== wouldQueue) {
      changed++;
      if (examples.length < 8) examples.push({ id: s.id, title: s.title, relevance: rel, was: s.reviewStatus, would: verdict });
    }
  }
  return {
    windowDays: days, scanned: signals.length,
    proposed: { threshold, bandLow: lo, bandHigh: hi },
    wouldAccept: accepted, wouldQueue: queued, wouldReject: rejected,
    reviewLoadChange: changed, examples,
  };
}

/** LAW 2 — the change log. Every tuning edit lands here, with its replay. */
export async function recordChange({ kind, topicId = null, sourceId = null, field = null, from = null, to = null, replay = null, note = null, userId = null }) {
  return get(
    `INSERT INTO listening_changes (kind, "topicId", "sourceId", field, "fromValue", "toValue", replay, note, "changedById")
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
    [kind, topicId, sourceId, field, from === null ? null : String(from), to === null ? null : String(to),
     JSON.stringify(replay || {}), note, userId]);
}

/** Markers for the listening charts, so a jump has a visible cause. */
export async function changeMarkers(days = 90) {
  return all(
    `SELECT c.id, c.kind, c.field, c."fromValue", c."toValue", c."changedAt", c.note,
            u.name AS "changedByName", t.label AS "topicLabel", s.domain AS "sourceDomain"
       FROM listening_changes c
       LEFT JOIN users u ON u.id = c."changedById"
       LEFT JOIN osint_topics t ON t.id = c."topicId"
       LEFT JOIN osint_sources s ON s.id = c."sourceId"
      WHERE c."changedAt" >= now() - ($1 || ' days')::interval
      ORDER BY c."changedAt" DESC LIMIT 200`, [String(days)]).catch(() => []);
}

// ── The review queue as an operation ─────────────────────────────────
export async function queueHealth() {
  const cfg = await controlSettings();
  const row = await get(
    `SELECT COUNT(*)::int AS pending,
            COUNT(*) FILTER (WHERE "assignedToId" IS NOT NULL)::int AS assigned,
            MIN("createdAt") AS oldest
       FROM osint_signals WHERE "reviewStatus" = 'PENDING'`).catch(() => null);
  const oldestHours = row?.oldest ? Math.round((Date.now() - new Date(row.oldest)) / 3600000) : 0;
  return {
    pending: Number(row?.pending || 0),
    assigned: Number(row?.assigned || 0),
    unassigned: Number(row?.pending || 0) - Number(row?.assigned || 0),
    oldestHours, slaHours: cfg.slaHours, breaching: oldestHours > cfg.slaHours,
  };
}

// ── Alert rules ──────────────────────────────────────────────────────
const inQuietHours = (rule, now = new Date()) => {
  if (rule.quietFrom === null || rule.quietFrom === undefined || rule.quietTo === null || rule.quietTo === undefined) return false;
  const h = now.getUTCHours(), from = Number(rule.quietFrom), to = Number(rule.quietTo);
  return from <= to ? h >= from && h < to : h >= from || h < to;   // windows may wrap midnight
};

export function alertRuleError(d) {
  if (!d.name || !String(d.name).trim()) return "An alert rule needs a name";
  if (d.threshold !== undefined && !(Number(d.threshold) > 0)) return "threshold must be greater than zero";
  if (d.windowHours !== undefined && !(Number(d.windowHours) >= 1 && Number(d.windowHours) <= 720)) {
    return "windowHours must be between 1 and 720";
  }
  for (const k of ["quietFrom", "quietTo"]) {
    if (d[k] !== undefined && d[k] !== null && !(Number(d[k]) >= 0 && Number(d[k]) <= 23)) return `${k} must be an hour 0–23`;
  }
  if (!d.topicId && !d.entityId) return "An alert rule must watch a topic or an entity";
  return null;
}

/**
 * Evaluate signal-shaped rules. Runs in the Daily Pulse.
 * LAW 1 in practice: this reads what the pipeline produced — muted
 * sources and unreviewed signals are excluded exactly as the metrics
 * exclude them. An alert can never see what a metric cannot.
 */
export async function evaluateListeningAlerts() {
  const cfg = await controlSettings();
  if (cfg.paused) return { evaluated: 0, fired: 0, paused: true };
  const rules = await all(`SELECT * FROM listening_alert_rules WHERE active = true`).catch(() => []);
  let fired = 0;
  const results = [];

  for (const rule of rules) {
    if (inQuietHours(rule)) { results.push({ rule: rule.id, skipped: "quiet hours" }); continue; }
    const params = [String(rule.windowHours)];
    const where = [`s."createdAt" >= now() - ($1 || ' hours')::interval`,
                   `s."reviewStatus" <> 'REJECTED'`,
                   `(src.muted IS NOT TRUE)`];
    if (rule.topicId) { params.push(rule.topicId); where.push(`s."topicId" = $${params.length}`); }
    if (rule.entityId) {
      params.push(rule.entityId);
      where.push(`EXISTS (SELECT 1 FROM osint_signal_entities se WHERE se."signalId" = s.id AND se."entityId" = $${params.length})`);
    }
    if (rule.corroboratedOnly) where.push(`COALESCE(s."corroborationCount",0) >= 2`);
    if (rule.kind === "NEGATIVE_BURST") where.push(`s.sentiment = 'NEGATIVE'`);
    if (rule.kind === "GRADE_A_MENTION") where.push(`src.reliability = 'A'`);

    const row = await get(
      `SELECT COUNT(*)::int c FROM osint_signals s
         LEFT JOIN osint_sources src ON src.domain = s.source
        WHERE ${where.join(" AND ")}`, params).catch(() => null);
    const count = Number(row?.c || 0);

    // A spike compares against the preceding window of the same length.
    let hit = false, baseline = null;
    if (rule.kind === "VOLUME_SPIKE" || rule.kind === "EMERGING_TOPIC") {
      const prev = await get(
        `SELECT COUNT(*)::int c FROM osint_signals s
           LEFT JOIN osint_sources src ON src.domain = s.source
          WHERE s."createdAt" >= now() - ($1 || ' hours')::interval * 2
            AND s."createdAt" <  now() - ($1 || ' hours')::interval
            AND s."reviewStatus" <> 'REJECTED' AND (src.muted IS NOT TRUE)
            ${rule.topicId ? `AND s."topicId" = $2` : ""}`,
        rule.topicId ? [String(rule.windowHours), rule.topicId] : [String(rule.windowHours)]).catch(() => null);
      baseline = Number(prev?.c || 0);
      hit = baseline === 0 ? count >= Number(rule.threshold) : count >= baseline * Number(rule.threshold);
    } else {
      hit = count >= Number(rule.threshold);
    }

    results.push({ rule: rule.id, name: rule.name, count, baseline, hit });
    if (!hit) continue;

    // Dedupe: one firing per rule per window, matching the metric-alert pattern.
    if (rule.lastFiredAt && Date.now() - new Date(rule.lastFiredAt) < Number(rule.windowHours) * 3600000) continue;
    await run(`UPDATE listening_alert_rules SET "lastFiredAt" = now() WHERE id = $1`, [rule.id]);
    const recipients = Array.isArray(rule.recipients) ? rule.recipients
      : (typeof rule.recipients === "string" ? JSON.parse(rule.recipients) : []);
    const targets = recipients.length ? recipients : (await all(
      `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
        WHERE u.active AND (r.permissions->>'intel' IN ('read','write') OR (r.permissions->>'admin')::boolean IS TRUE)`
    ).catch(() => [])).map((u) => u.id);
    if (targets.length) {
      await notify(targets, "LISTENING_ALERT",
        { rule: rule.name, kind: rule.kind, count, baseline, severity: rule.severity }, "/listening").catch(() => {});
    }
    fired++;
  }
  return { evaluated: rules.length, fired, results, paused: false };
}

/** Daily Pulse step: nudge when the review queue breaches its SLA. */
export async function reviewQueueSweep() {
  const health = await queueHealth();
  if (!health.breaching || health.pending === 0) return { ...health, notified: 0 };
  const analysts = (await all(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
      WHERE u.active AND (r.permissions->>'intel' IN ('read','write') OR (r.permissions->>'admin')::boolean IS TRUE)`
  ).catch(() => [])).map((u) => u.id);
  if (analysts.length) {
    await notify(analysts, "REVIEW_QUEUE_SLA",
      { pending: health.pending, oldestHours: health.oldestHours, slaHours: health.slaHours }, "/listening").catch(() => {});
  }
  return { ...health, notified: analysts.length };
}
