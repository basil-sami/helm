import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";
import {
  controlSettings, replayGate, recordChange, changeMarkers, queueHealth,
  evaluateListeningAlerts, alertRuleError, guardrailError, CONTROLLABLE_ENTITY_KINDS,
} from "../listening-control.js";

// ═══ W4·F · THE LISTENING CONTROL ROOM ════════════════════════════════
// Every endpoint here tunes the pipeline. None of them bypasses it.

const r = Router();
r.use(requireAuth);
const read = requirePerm("intel", "read");
const write = requirePerm("intel", "write");

/** The cockpit in one call: settings, queue health, budgets, recent changes. */
r.get("/", read, async (_req, res, next) => {
  try {
    const [cfg, queue, markers] = await Promise.all([controlSettings(), queueHealth(), changeMarkers(30)]);
    // The search rail already computes spend against caps; reusing it
    // keeps one budget truth instead of a second meter that can disagree.
    let budgetMap = {};
    try { budgetMap = await (await import("../search.js")).budgets(); } catch { budgetMap = {}; }
    const sources = await get(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER (WHERE active = false)::int blocked,
              COUNT(*) FILTER (WHERE muted = true)::int muted FROM osint_sources`).catch(() => null);
    const watches = await get(
      `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE paused = true)::int paused FROM osint_topics`).catch(() => null);
    res.json({
      settings: cfg, queue,
      sources: sources || { total: 0, blocked: 0, muted: 0 },
      watches: watches || { total: 0, paused: 0 },
      budgets: Object.values(budgetMap).map((b) => ({
        ...b, warn: b.pctOfCap >= 80 && !b.exhausted,
      })),
      recentChanges: markers.slice(0, 10),
      guardrail: { entityKinds: CONTROLLABLE_ENTITY_KINDS, note: "No control can widen this. Private individuals are never profiled." },
    });
  } catch (e) { next(e); }
});

// ── LAW 2 · replay preview before anything changes ───────────────────
r.post("/replay", write, async (req, res, next) => {
  try {
    const { topicId = null, threshold = null, bandLow = null, bandHigh = null, days = 7 } = req.body || {};
    for (const [k, v] of Object.entries({ threshold, bandLow, bandHigh })) {
      if (v !== null && v !== undefined && !(Number(v) >= 0 && Number(v) <= 1)) {
        return res.status(400).json({ error: `${k} must be between 0 and 1` });
      }
    }
    if (bandLow !== null && bandHigh !== null && Number(bandLow) >= Number(bandHigh)) {
      return res.status(400).json({ error: "bandLow must be below bandHigh" });
    }
    const d = Math.min(90, Math.max(1, Number(days) || 7));
    res.json(await replayGate({ topicId, threshold, bandLow, bandHigh, days: d }));
  } catch (e) { next(e); }
});

/** Apply a band change — replay first, record the change, drop a marker. */
r.patch("/band", write, async (req, res, next) => {
  try {
    const cur = await controlSettings();
    const lo = req.body?.bandLow !== undefined ? Number(req.body.bandLow) : cur.bandLow;
    const hi = req.body?.bandHigh !== undefined ? Number(req.body.bandHigh) : cur.bandHigh;
    if (!(lo >= 0 && lo <= 1 && hi >= 0 && hi <= 1)) return res.status(400).json({ error: "Band edges must be between 0 and 1" });
    if (lo >= hi) return res.status(400).json({ error: "bandLow must be below bandHigh" });
    const replay = await replayGate({ bandLow: lo, bandHigh: hi, days: 7 });
    await run(`UPDATE settings SET "reviewBandLow" = $1, "reviewBandHigh" = $2 WHERE id = 1`, [lo, hi]);
    await recordChange({ kind: "BAND", field: "reviewBand", from: `${cur.bandLow}–${cur.bandHigh}`,
      to: `${lo}–${hi}`, replay, note: req.body?.note || null, userId: req.user.id });
    logAudit(req, "listening.band", "settings", null, { from: [cur.bandLow, cur.bandHigh], to: [lo, hi] });
    res.json({ ok: true, settings: await controlSettings(), replay });
  } catch (e) { next(e); }
});

/** The review SLA and the shrink-only pause. */
r.patch("/settings", write, async (req, res, next) => {
  try {
    const cur = await controlSettings();
    const out = {};
    if (req.body?.slaHours !== undefined) {
      const h = Number(req.body.slaHours);
      if (!(h >= 1 && h <= 720)) return res.status(400).json({ error: "slaHours must be between 1 and 720" });
      await run(`UPDATE settings SET "reviewSlaHours" = $1 WHERE id = 1`, [h]);
      out.slaHours = h;
    }
    if (req.body?.paused !== undefined) {
      const paused = !!req.body.paused;
      await run(`UPDATE settings SET "listeningPaused" = $1 WHERE id = 1`, [paused]);
      await recordChange({ kind: "WATCH_PAUSE", field: "listeningPaused", from: cur.paused, to: paused,
        note: req.body?.note || null, userId: req.user.id });
      out.paused = paused;
    }
    logAudit(req, "listening.settings", "settings", null, out);
    res.json({ ok: true, settings: await controlSettings() });
  } catch (e) { next(e); }
});

// ── Source levers: block and mute are different problems ─────────────
r.get("/sources", read, async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT s.*, u.name AS "gradedByName",
              (SELECT COUNT(*)::int FROM osint_signals g WHERE g.source = s.domain) AS signals
         FROM osint_sources s LEFT JOIN users u ON u.id = s."gradedById"
        ORDER BY s.reliability NULLS LAST, s.domain`));
  } catch (e) { next(e); }
});

/** Regrading is head-admin work and always carries a written reason. */
r.patch("/sources/:id/grade", requireAdmin, async (req, res, next) => {
  try {
    const src = await get(`SELECT * FROM osint_sources WHERE id = $1`, [req.params.id]);
    if (!src) return res.status(404).json({ error: "Source not found" });
    const grade = String(req.body?.reliability || "").toUpperCase();
    if (!/^[A-F]$/.test(grade)) return res.status(400).json({ error: "reliability must be an Admiralty grade A–F" });
    const note = String(req.body?.note || "").trim();
    if (note.length < 3) return res.status(400).json({ error: "A regrade needs a written reason" });
    await run(
      `UPDATE osint_sources SET reliability = $2, "gradeNote" = $3, "gradedById" = $4, "gradedAt" = now(), "updatedAt" = now()
        WHERE id = $1`, [src.id, grade, note, req.user.id]);
    await recordChange({ kind: "SOURCE_GRADE", sourceId: src.id, field: "reliability",
      from: src.reliability, to: grade, note, userId: req.user.id });
    logAudit(req, "listening.regrade", "osint_sources", src.id, { from: src.reliability, to: grade });
    res.json(await get(`SELECT * FROM osint_sources WHERE id = $1`, [src.id]));
  } catch (e) { next(e); }
});

/**
 * Block stops ingestion. Mute keeps ingesting for the evidence trail but
 * suppresses the source from alerts and metrics. Two problems, two levers.
 */
r.patch("/sources/:id/lever", write, async (req, res, next) => {
  try {
    const src = await get(`SELECT * FROM osint_sources WHERE id = $1`, [req.params.id]);
    if (!src) return res.status(404).json({ error: "Source not found" });
    const { blocked, muted, note } = req.body || {};
    if (blocked === undefined && muted === undefined) return res.status(400).json({ error: "Set blocked or muted" });
    if (blocked !== undefined) {
      await run(`UPDATE osint_sources SET active = $2, "updatedAt" = now() WHERE id = $1`, [src.id, !blocked]);
      await recordChange({ kind: "SOURCE_BLOCK", sourceId: src.id, field: "active",
        from: src.active, to: !blocked, note: note || null, userId: req.user.id });
    }
    if (muted !== undefined) {
      await run(`UPDATE osint_sources SET muted = $2, "updatedAt" = now() WHERE id = $1`, [src.id, !!muted]);
      await recordChange({ kind: "SOURCE_MUTE", sourceId: src.id, field: "muted",
        from: src.muted, to: !!muted, note: note || null, userId: req.user.id });
    }
    logAudit(req, "listening.sourceLever", "osint_sources", src.id, { blocked, muted });
    res.json(await get(`SELECT * FROM osint_sources WHERE id = $1`, [src.id]));
  } catch (e) { next(e); }
});

// ── Watches (promoted topics) ────────────────────────────────────────
r.get("/watches", read, async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT t.*, c.name AS "campaignName", u.name AS "assigneeName",
              (SELECT COUNT(*)::int FROM osint_signals s WHERE s."topicId" = t.id) AS signals,
              (SELECT COUNT(*)::int FROM osint_signals s WHERE s."topicId" = t.id AND s."reviewStatus" = 'PENDING') AS pending
         FROM osint_topics t
         LEFT JOIN campaigns c ON c.id = t."campaignId"
         LEFT JOIN users u ON u.id = t."assigneeId"
        ORDER BY t.label`));
  } catch (e) { next(e); }
});

/** Attach a watch to a campaign, assign it, or pause it. */
r.patch("/watches/:id", write, async (req, res, next) => {
  try {
    const t = await get(`SELECT * FROM osint_topics WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Watch not found" });
    const { campaignId, assigneeId, paused } = req.body || {};
    if (campaignId !== undefined && campaignId !== null) {
      const c = await get(`SELECT id FROM campaigns WHERE id = $1`, [campaignId]);
      if (!c) return res.status(400).json({ error: "No such campaign" });
    }
    await run(
      `UPDATE osint_topics SET "campaignId" = COALESCE($2, "campaignId"), "assigneeId" = COALESCE($3, "assigneeId"),
         paused = COALESCE($4, paused) WHERE id = $1`,
      [t.id, campaignId ?? null, assigneeId ?? null, paused === undefined ? null : !!paused]);
    if (paused !== undefined && !!paused !== t.paused) {
      await recordChange({ kind: "WATCH_PAUSE", topicId: t.id, field: "paused", from: t.paused, to: !!paused, userId: req.user.id });
    }
    logAudit(req, "listening.watch", "osint_topics", t.id, { campaignId, paused });
    res.json(await get(`SELECT * FROM osint_topics WHERE id = $1`, [t.id]));
  } catch (e) { next(e); }
});

// ── Review queue operations ──────────────────────────────────────────
r.get("/queue", read, async (req, res, next) => {
  try {
    const health = await queueHealth();
    const items = await all(
      `SELECT s.id, s.title, s.source, s."topicId", s."createdAt", s."assignedToId",
              s."aiRelevance", s."aiVerdict", t.label AS "topicLabel", u.name AS "assignedToName",
              src.reliability, src.muted
         FROM osint_signals s
         LEFT JOIN osint_topics t ON t.id = s."topicId"
         LEFT JOIN users u ON u.id = s."assignedToId"
         LEFT JOIN osint_sources src ON src.domain = s.source
        WHERE s."reviewStatus" = 'PENDING'
        ORDER BY s."createdAt" ASC LIMIT 100`);
    res.json({ health, items });
  } catch (e) { next(e); }
});

r.post("/queue/assign", write, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
    if (!ids.length) return res.status(400).json({ error: "ids must be a non-empty array" });
    const to = req.body?.assigneeId || req.user.id;
    const done = await all(
      `UPDATE osint_signals SET "assignedToId" = $2 WHERE id = ANY($1::uuid[]) AND "reviewStatus" = 'PENDING' RETURNING id`,
      [ids, to]);
    logAudit(req, "listening.assign", "osint_signals", null, { count: done.length, to });
    res.json({ assigned: done.length, requested: ids.length });
  } catch (e) { next(e); }
});

/**
 * Bulk ruling. LAW 1: each ruling is the same write the single-signal
 * review endpoint performs — the queue is not a side door into metrics.
 * Rulings keep feeding W3·E's query expansion and the agreement KPI.
 */
r.post("/queue/rule", write, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
    const verdict = String(req.body?.verdict || "").toUpperCase();
    if (!ids.length) return res.status(400).json({ error: "ids must be a non-empty array" });
    if (!["CONFIRMED", "REJECTED"].includes(verdict)) return res.status(400).json({ error: "verdict must be CONFIRMED or REJECTED" });
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 200) : null;
    const done = await all(
      `UPDATE osint_signals SET "reviewStatus" = $2, "reviewedById" = $3, "reviewedAt" = now()
        WHERE id = ANY($1::uuid[]) AND "reviewStatus" = 'PENDING' RETURNING id, "aiVerdict"`,
      [ids, verdict, req.user.id]);
    // The agreement KPI compares analyst rulings against the model's
    // recommendation — recorded here, never used to auto-rule. The two
    // live in different vocabularies (CONFIRMED/REJECTED vs RELEVANT/
    // NOT_RELEVANT), mapped here exactly as the metrics engine maps them
    // — the raw comparison this replaced was structurally always zero.
    const wantAi = verdict === "CONFIRMED" ? "RELEVANT" : "NOT_RELEVANT";
    const agreed = done.filter((d) => d.aiVerdict && d.aiVerdict.toUpperCase() === wantAi).length;
    logAudit(req, "listening.bulkRule", "osint_signals", null, { count: done.length, verdict, reason, agreedWithAi: agreed });
    res.json({ ruled: done.length, requested: ids.length, skipped: ids.length - done.length, agreedWithAi: agreed });
  } catch (e) { next(e); }
});

// ── Alert rules ──────────────────────────────────────────────────────
r.get("/rules", read, async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT r.*, t.label AS "topicLabel", e.name AS "entityName" FROM listening_alert_rules r
         LEFT JOIN osint_topics t ON t.id = r."topicId"
         LEFT JOIN osint_entities e ON e.id = r."entityId"
        ORDER BY r.active DESC, r."createdAt" DESC`));
  } catch (e) { next(e); }
});

r.post("/rules", write, async (req, res, next) => {
  try {
    const d = req.body || {};
    const err = alertRuleError(d);
    if (err) return res.status(400).json({ error: err });
    // LAW 3: a rule may not be aimed at anything outside the guardrail.
    if (d.entityId) {
      const e = await get(`SELECT kind FROM osint_entities WHERE id = $1`, [d.entityId]);
      if (!e) return res.status(400).json({ error: "No such entity" });
      const g = guardrailError(e.kind);
      if (g) return res.status(400).json({ error: g });
    }
    const row = await get(
      `INSERT INTO listening_alert_rules (name, "nameAr", kind, "topicId", "entityId", threshold, "windowHours",
         severity, "corroboratedOnly", "quietFrom", "quietTo", recipients, channel)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,2),COALESCE($7,24),COALESCE($8,'MEDIUM'),COALESCE($9,false),$10,$11,
               COALESCE($12::jsonb,'[]'::jsonb),COALESCE($13,'INAPP')) RETURNING *`,
      [d.name, d.nameAr || null, d.kind || "VOLUME_SPIKE", d.topicId || null, d.entityId || null,
       d.threshold ?? null, d.windowHours ?? null, d.severity || null, d.corroboratedOnly ?? null,
       d.quietFrom ?? null, d.quietTo ?? null, JSON.stringify(d.recipients || []), d.channel || null]);
    await recordChange({ kind: "ALERT_RULE", topicId: d.topicId || null, field: "created", to: d.name, userId: req.user.id });
    logAudit(req, "listening.ruleCreate", "listening_alert_rules", row.id, { kind: row.kind });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

r.patch("/rules/:id", write, async (req, res, next) => {
  try {
    const rule = await get(`SELECT * FROM listening_alert_rules WHERE id = $1`, [req.params.id]);
    if (!rule) return res.status(404).json({ error: "Rule not found" });
    const merged = { ...rule, ...req.body };
    const err = alertRuleError(merged);
    if (err) return res.status(400).json({ error: err });
    await run(
      `UPDATE listening_alert_rules SET name = $2, threshold = $3, "windowHours" = $4, severity = $5,
         "corroboratedOnly" = $6, active = $7 WHERE id = $1`,
      [rule.id, merged.name, merged.threshold, merged.windowHours, merged.severity,
       !!merged.corroboratedOnly, merged.active === undefined ? rule.active : !!merged.active]);
    logAudit(req, "listening.ruleUpdate", "listening_alert_rules", rule.id, {});
    res.json(await get(`SELECT * FROM listening_alert_rules WHERE id = $1`, [rule.id]));
  } catch (e) { next(e); }
});

r.delete("/rules/:id", write, async (req, res, next) => {
  try {
    await run(`DELETE FROM listening_alert_rules WHERE id = $1`, [req.params.id]);
    logAudit(req, "listening.ruleDelete", "listening_alert_rules", req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Dry-run the rules without notifying — the operator's "what would fire?" */
r.post("/rules/evaluate", write, async (_req, res, next) => {
  try { res.json(await evaluateListeningAlerts()); } catch (e) { next(e); }
});

/** LAW 2 — the markers a chart needs to explain its own jumps. */
r.get("/changes", read, async (req, res, next) => {
  try { res.json(await changeMarkers(Math.min(365, Math.max(1, Number(req.query.days) || 90)))); }
  catch (e) { next(e); }
});

export default r;
