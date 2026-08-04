import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import {
  IMPORT_TARGETS, IMPORT_FLOW, importTransitionError, parseCsv,
  previewImport, commitImport, buildRows,
  SEGMENT_SOURCES, definitionError, evaluateSegment, refreshSegmentCount,
} from "../dataimport.js";

// ═══ W4·B · IMPORT WIZARD + SEGMENT TARGETING ═════════════════════════

const r = Router();
r.use(requireAuth);
const canWrite = requirePerm("leads", "write");
const canRead = requirePerm("leads", "read");

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const hydrate = (job) => ({ ...job, header: parse(job.header), mapping: parse(job.mapping), stats: parse(job.stats), errors: parse(job.errors) });

/** What can be imported, and into which fields. The UI builds mapping from this. */
r.get("/targets", canRead, (req, res) => {
  res.json(Object.entries(IMPORT_TARGETS).map(([entity, t]) => ({
    entity, required: t.required, fields: Object.keys(t.fields),
  })));
});

r.get("/", canRead, async (req, res, next) => {
  try {
    res.json((await all(
      `SELECT j.id, j.entity, j.status, j.filename, j.stats, j."createdAt", j."committedAt", u.name AS "createdByName"
         FROM import_jobs j LEFT JOIN users u ON u.id = j."createdById"
        ORDER BY j."createdAt" DESC LIMIT 50`)).map((j) => ({ ...j, stats: parse(j.stats) })));
  } catch (e) { next(e); }
});

r.get("/:id", canRead, async (req, res, next) => {
  try {
    const job = await get(`SELECT * FROM import_jobs WHERE id = $1`, [req.params.id]);
    if (!job) return res.status(404).json({ error: "Import job not found" });
    res.json(hydrate(job));
  } catch (e) { next(e); }
});

/** UPLOADED — the CSV arrives and its header is detected. */
r.post("/", canWrite, async (req, res, next) => {
  try {
    const { entity = "leads", csv, filename } = req.body || {};
    if (!IMPORT_TARGETS[entity]) return res.status(400).json({ error: `Unknown import entity: ${entity}` });
    if (!csv || String(csv).trim().length < 3) return res.status(400).json({ error: "No CSV content" });
    const rows = parseCsv(csv);
    if (rows.length < 2) return res.status(400).json({ error: "CSV needs a header row and at least one data row" });
    const header = rows[0];
    // Best-effort auto-mapping: exact, case-insensitive column matches.
    const mapping = {};
    for (const field of Object.keys(IMPORT_TARGETS[entity].fields)) {
      const hit = header.find((h) => h.toLowerCase() === field.toLowerCase());
      if (hit) mapping[field] = hit;
    }
    const job = await get(
      `INSERT INTO import_jobs (entity, status, filename, raw, header, mapping, "createdById")
       VALUES ($1,'UPLOADED',$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING *`,
      [entity, filename || null, String(csv), JSON.stringify(header), JSON.stringify(mapping), req.user.id]);
    logAudit(req, "import.upload", "import_jobs", job.id, { entity, rows: rows.length - 1 });
    res.status(201).json({ ...hydrate(job), suggestedMapping: mapping, sampleRows: rows.slice(1, 4) });
  } catch (e) { next(e); }
});

/** MAPPED — the operator confirms which column feeds which field. */
r.patch("/:id/mapping", canWrite, async (req, res, next) => {
  try {
    const job = await get(`SELECT * FROM import_jobs WHERE id = $1`, [req.params.id]);
    if (!job) return res.status(404).json({ error: "Import job not found" });
    const err = importTransitionError(job.status, "MAPPED");
    if (err) return res.status(400).json({ error: err });
    const { mapping, dedupeOn, mergeStrategy, consentBasis, consentSource } = req.body || {};
    const target = IMPORT_TARGETS[job.entity];
    for (const field of Object.keys(mapping || {})) {
      if (!(field in target.fields)) return res.status(400).json({ error: `Unknown field for ${job.entity}: ${field}` });
    }
    const missing = target.required.filter((f) => !(mapping || {})[f]);
    if (missing.length) return res.status(400).json({ error: `Required field not mapped: ${missing.join(", ")}` });
    const updated = await get(
      `UPDATE import_jobs SET mapping = $2::jsonb, "dedupeOn" = COALESCE($3, "dedupeOn"),
         "mergeStrategy" = COALESCE($4, "mergeStrategy"), "consentBasis" = COALESCE($5, "consentBasis"),
         "consentSource" = COALESCE($6, "consentSource"), status = 'MAPPED', "updatedAt" = now()
       WHERE id = $1 RETURNING *`,
      [job.id, JSON.stringify(mapping || {}), dedupeOn || null, mergeStrategy || null, consentBasis || null, consentSource || null]);
    res.json(hydrate(updated));
  } catch (e) { next(e); }
});

/** VALIDATED — per-row typing and required-field checks. */
r.post("/:id/validate", canWrite, async (req, res, next) => {
  try {
    const job = hydrate(await get(`SELECT * FROM import_jobs WHERE id = $1`, [req.params.id]) || {});
    if (!job.id) return res.status(404).json({ error: "Import job not found" });
    const err = importTransitionError(job.status, "VALIDATED");
    if (err) return res.status(400).json({ error: err });
    const { rows, errors } = buildRows(job);
    const stats = { rows: rows.length + errors.length, valid: rows.length, invalid: errors.length };
    const updated = await get(
      `UPDATE import_jobs SET status = 'VALIDATED', stats = $2::jsonb, errors = $3::jsonb, "updatedAt" = now()
       WHERE id = $1 RETURNING *`, [job.id, JSON.stringify(stats), JSON.stringify(errors.slice(0, 200))]);
    res.json(hydrate(updated));
  } catch (e) { next(e); }
});

/** PREVIEWED — what the commit would do, before it does it. */
r.post("/:id/preview", canWrite, async (req, res, next) => {
  try {
    const job = hydrate(await get(`SELECT * FROM import_jobs WHERE id = $1`, [req.params.id]) || {});
    if (!job.id) return res.status(404).json({ error: "Import job not found" });
    const err = importTransitionError(job.status, "PREVIEWED");
    if (err) return res.status(400).json({ error: err });
    const { stats, errors, sample } = await previewImport(job);
    const updated = await get(
      `UPDATE import_jobs SET status = 'PREVIEWED', stats = $2::jsonb, errors = $3::jsonb, "updatedAt" = now()
       WHERE id = $1 RETURNING *`, [job.id, JSON.stringify(stats), JSON.stringify(errors.slice(0, 200))]);
    res.json({ ...hydrate(updated), sample });
  } catch (e) { next(e); }
});

/** COMMITTED — terminal. Re-committing is refused by the matrix, not by luck. */
r.post("/:id/commit", canWrite, async (req, res, next) => {
  try {
    const job = hydrate(await get(`SELECT * FROM import_jobs WHERE id = $1`, [req.params.id]) || {});
    if (!job.id) return res.status(404).json({ error: "Import job not found" });
    const err = importTransitionError(job.status, "COMMITTED");
    if (err) return res.status(400).json({ error: err });
    const result = await commitImport(job, req.user.id);
    const stats = { ...job.stats, ...result };
    const updated = await get(
      `UPDATE import_jobs SET status = 'COMMITTED', stats = $2::jsonb, "committedAt" = now(),
         raw = NULL, "updatedAt" = now() WHERE id = $1 RETURNING *`,
      [job.id, JSON.stringify(stats)]);
    logAudit(req, "import.commit", "import_jobs", job.id, result);
    res.json({ ...hydrate(updated), ...result });
  } catch (e) { next(e); }
});

r.post("/:id/cancel", canWrite, async (req, res, next) => {
  try {
    const job = await get(`SELECT * FROM import_jobs WHERE id = $1`, [req.params.id]);
    if (!job) return res.status(404).json({ error: "Import job not found" });
    const err = importTransitionError(job.status, "CANCELLED");
    if (err) return res.status(400).json({ error: err });
    await run(`UPDATE import_jobs SET status = 'CANCELLED', raw = NULL, "updatedAt" = now() WHERE id = $1`, [job.id]);
    logAudit(req, "import.cancel", "import_jobs", job.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;

// ── Segments: evaluation surface ─────────────────────────────────────
export const segmentEvalRouter = Router();
segmentEvalRouter.use(requireAuth);
const segRead = requirePerm("campaigns", "read");
const segWrite = requirePerm("campaigns", "write");

/** The fields a segment may test, per source. The builder UI reads this. */
segmentEvalRouter.get("/sources", segRead, (req, res) => {
  res.json(Object.entries(SEGMENT_SOURCES).map(([key, s]) => ({ key, label: s.label, fields: s.fields })));
});

/** Live count before saving — the practitioner's "how many is that?" */
segmentEvalRouter.post("/preview", segWrite, async (req, res, next) => {
  try {
    const def = req.body?.definition;
    const err = definitionError(def);
    if (err) return res.status(400).json({ error: err });
    if (!def) return res.json({ descriptive: true, count: 0, sample: [] });
    const { rows, count, source } = await evaluateSegment(def, { limit: 10 });
    res.json({ descriptive: false, source, count, sample: rows.slice(0, 10) });
  } catch (e) { next(e); }
});

segmentEvalRouter.get("/:id/members", segRead, async (req, res, next) => {
  try {
    const seg = await get(`SELECT * FROM segments WHERE id = $1`, [req.params.id]);
    if (!seg) return res.status(404).json({ error: "Segment not found" });
    if (!seg.definition) return res.json({ descriptive: true, count: 0, rows: [] });
    const { rows, count, source } = await evaluateSegment(parse(seg.definition), { limit: 500 });
    res.json({ descriptive: false, source, count, rows });
  } catch (e) { next(e); }
});

segmentEvalRouter.post("/:id/refresh", segWrite, async (req, res, next) => {
  try {
    const count = await refreshSegmentCount(req.params.id);
    if (count === null) return res.status(400).json({ error: "This segment is descriptive — it has no definition to evaluate" });
    res.json({ ok: true, count });
  } catch (e) { next(e); }
});
