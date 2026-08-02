import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { computeListening } from "./listening.js";
import { notify } from "../notify.js";
import { gatherTopic, trendingTerms, scoreSentiment } from "../integrations/osint.js";
import { simhash, contentHash, scoreRelevance, credibilityFor, domainOf, isNearDuplicate } from "../osint/validate.js";
import { linkSignalEntities } from "../osint/entities.js";

export const osintRouter = Router();
osintRouter.use(requireAuth);

const CATS = ["BRAND", "COMPETITOR", "MARKET", "SECTOR", "CUSTOM"];
const num = (v) => Number(v || 0);
const iso = (d) => (d ? new Date(d).toISOString() : null);

// ── Topics ────────────────────────────────────────────────────────────
osintRouter.get("/topics", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(`
      SELECT t.*,
        (SELECT COUNT(*)::int FROM osint_signals s WHERE s."topicId" = t.id) AS "signalCount"
      FROM osint_topics t ORDER BY t."createdAt" DESC`));
  } catch (e) { next(e); }
});

osintRouter.post("/topics", requirePerm("intel"), async (req, res, next) => {
  const { label, query, lang, region, category, sources, feeds,
          mustInclude, mustExclude, contextTerms, reviewThreshold } = req.body;
  if (!label || !query) return res.status(400).json({ error: "label and query are required" });
  if (category && !CATS.includes(category)) return res.status(400).json({ error: "Invalid category" });
  try {
    const row = await get(
      `INSERT INTO osint_topics (label, query, lang, region, category, sources, feeds,
         "mustInclude", "mustExclude", "contextTerms", "reviewThreshold")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [label, query, lang || "en", region || "SD", category || "MARKET",
       JSON.stringify(sources || ["GOOGLE_NEWS", "GDELT"]), JSON.stringify(feeds || []),
       JSON.stringify(mustInclude || []), JSON.stringify(mustExclude || []),
       JSON.stringify(contextTerms || []), Number(reviewThreshold ?? 0.55)]
    );
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.patch("/topics/:id", requirePerm("intel"), async (req, res, next) => {
  const sets = [], params = [];
  const push = (col, val) => { params.push(val); sets.push(`"${col}" = $${params.length}`); };
  for (const f of ["label", "query", "lang", "region", "category", "active", "reviewThreshold"]) {
    if (req.body[f] !== undefined) push(f, req.body[f]);
  }
  if (req.body.sources !== undefined) push("sources", JSON.stringify(req.body.sources));
  if (req.body.feeds !== undefined) push("feeds", JSON.stringify(req.body.feeds));
  if (!sets.length) return res.status(400).json({ error: "No valid fields" });
  try {
    params.push(req.params.id);
    await run(`UPDATE osint_topics SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    res.json(await get("SELECT * FROM osint_topics WHERE id = $1", [req.params.id]));
  } catch (e) { next(e); }
});

osintRouter.delete("/topics/:id", requirePerm("intel"), async (req, res, next) => {
  try { await run("DELETE FROM osint_topics WHERE id = $1", [req.params.id]); res.status(204).end(); }
  catch (e) { next(e); }
});


// ── Wave 2·E · the source registry ───────────────────────────────────
osintRouter.get("/sources", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(`SELECT s.*, (SELECT COUNT(*)::int FROM osint_signals g
                          WHERE g.source = s.domain OR g.url LIKE '%' || s.domain || '%') AS "signalCount"
                        FROM osint_sources s ORDER BY s.reliability ASC, s.domain ASC`));
  } catch (e) { next(e); }
});

osintRouter.post("/sources", requirePerm("intel"), async (req, res, next) => {
  try {
    const domain = String(req.body?.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) return res.status(400).json({ error: "domain is required" });
    const { reliability } = req.body || {};
    if (reliability && !["A","B","C","D","E","F"].includes(reliability)) {
      return res.status(400).json({ error: "reliability must be A–F (Admiralty Code)" });
    }
    const dup = await get(`SELECT * FROM osint_sources WHERE domain = $1`, [domain]);
    if (dup) return res.status(409).json({ error: "Source already registered", source: dup });
    const row = await get(
      `INSERT INTO osint_sources (domain, name, kind, reliability, "ownerGroup", country, lang)
       VALUES ($1,$2,$3,COALESCE($4,'D'),$5,$6,$7) RETURNING *`,
      [domain, req.body.name || domain, req.body.kind || "NEWS", reliability || null,
       req.body.ownerGroup || null, req.body.country || null, req.body.lang || null]);
    logAudit(req, "osint.source.create", "osint_sources", row.id, { domain });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.patch("/sources/:id", requirePerm("intel"), async (req, res, next) => {
  try {
    const src = await get(`SELECT * FROM osint_sources WHERE id = $1`, [req.params.id]);
    if (!src) return res.status(404).json({ error: "Not found" });
    if (req.body.reliability && !["A","B","C","D","E","F"].includes(req.body.reliability)) {
      return res.status(400).json({ error: "reliability must be A–F (Admiralty Code)" });
    }
    for (const f of ["name", "nameAr", "kind", "reliability", "ownerGroup", "country", "lang", "paywalled", "robotsOk", "notes", "active"]) {
      if (req.body[f] !== undefined) await run(`UPDATE osint_sources SET "${f}" = $2, "updatedAt" = now() WHERE id = $1`, [src.id, req.body[f]]);
    }
    // re-rating a source re-grades its existing signals
    if (req.body.reliability) {
      const { credibilityFor } = await import("../osint/validate.js");
      await run(`UPDATE osint_signals SET credibility = $2
                 WHERE source = $1 OR url LIKE '%' || $1 || '%'`, [src.domain, credibilityFor(req.body.reliability)]);
    }
    res.json(await get(`SELECT * FROM osint_sources WHERE id = $1`, [src.id]));
  } catch (e) { next(e); }
});

// ── the analyst review queue ─────────────────────────────────────────
osintRouter.get("/review", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT s.id, s.title, s.snippet, s.url, s.source, s.relevance, s.credibility, s."clusterId",
              s."syndicationCount", s."publishedAt", t.label AS "topicLabel", t.id AS "topicId"
       FROM osint_signals s JOIN osint_topics t ON t.id = s."topicId"
       WHERE s."reviewStatus" = 'PENDING'
       ORDER BY s.relevance DESC, s."fetchedAt" DESC LIMIT $1`, [Number(req.query.limit) || 50]));
  } catch (e) { next(e); }
});

osintRouter.post("/signals/:id/review", requirePerm("intel"), async (req, res, next) => {
  try {
    const { status, topicId } = req.body || {};
    if (!["CONFIRMED", "REJECTED"].includes(status)) return res.status(400).json({ error: "status must be CONFIRMED or REJECTED" });
    const sig = await get(`SELECT * FROM osint_signals WHERE id = $1`, [req.params.id]);
    if (!sig) return res.status(404).json({ error: "Not found" });
    await run(`UPDATE osint_signals SET "reviewStatus" = $2, "reviewedById" = $3, "reviewedAt" = now(),
               "topicId" = COALESCE($4, "topicId") WHERE id = $1`,
      [sig.id, status, req.user.id, topicId || null]);
    logAudit(req, "osint.review", "osint_signals", sig.id, { status });
    res.json(await get(`SELECT * FROM osint_signals WHERE id = $1`, [sig.id]));
  } catch (e) { next(e); }
});

/** Per-topic precision, measured from what analysts actually ruled. */
osintRouter.get("/precision", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT t.id, t.label, t."reviewThreshold",
              COUNT(*) FILTER (WHERE s."reviewStatus" = 'CONFIRMED')::int AS confirmed,
              COUNT(*) FILTER (WHERE s."reviewStatus" = 'REJECTED')::int AS rejected,
              COUNT(*) FILTER (WHERE s."reviewStatus" = 'PENDING')::int AS pending
       FROM osint_topics t LEFT JOIN osint_signals s ON s."topicId" = t.id
       GROUP BY t.id, t.label, t."reviewThreshold" ORDER BY t.label`));
  } catch (e) { next(e); }
});

// ── backfill: grade the history we already have ──────────────────────
osintRouter.post("/backfill", requirePerm("intel"), async (req, res, next) => {
  try {
    const { simhash: sh, contentHash: ch, isNearDuplicate: isDup } = await import("../osint/validate.js");
    const rows = await all(`SELECT id, title, snippet FROM osint_signals WHERE "clusterId" IS NULL ORDER BY "fetchedAt" ASC`);
    const seen = [];   // [{ fp, text }]
    let clustered = 0, dups = 0;
    for (const r of rows) {
      const txt = `${r.title} ${r.snippet || ""}`;
      const fp = sh(txt);
      const hit = seen.find((x) => isDup(txt, x.text));
      const cid = hit ? hit.fp : fp;
      const canonical = !hit;
      if (!hit) seen.push({ fp, text: txt }); else dups++;
      await run(`UPDATE osint_signals SET "clusterId" = $2, canonical = $3, "contentHash" = $4 WHERE id = $1`,
        [r.id, cid, canonical, ch(`${r.title} ${r.snippet || ""}`)]);
      if (!canonical) await run(`UPDATE osint_signals SET "syndicationCount" = "syndicationCount" + 1
                                 WHERE "clusterId" = $1 AND canonical = true`, [cid]);
      clustered++;
    }
    logAudit(req, "osint.backfill", "osint_signals", null, { clustered, dups });
    res.json({ clustered, duplicatesFound: dups });
  } catch (e) { next(e); }
});


// ── Wave 2·E · one gate, whatever door a signal comes through ────────
// Manual entry is graded exactly like a fetched feed: the question is
// whether the signal is about the topic, not who typed it in.
export async function gradeSignal(topic, s) {
  const domain = domainOf(s.url) || (s.source || "").toLowerCase();
  let src = null;
  if (domain) {
    src = await get(`SELECT * FROM osint_sources WHERE domain = $1`, [domain]);
    if (!src) {
      src = await get(
        `INSERT INTO osint_sources (domain, name, kind, reliability) VALUES ($1,$2,'BLOG','D')
         ON CONFLICT (domain) DO UPDATE SET domain = EXCLUDED.domain RETURNING *`,
        [domain, s.source || domain]);
    }
  }

  const text = `${s.title} ${s.snippet || ""}`;
  const fp = simhash(text);
  let clusterId = fp, canonical = true;
  const recent = await all(
    `SELECT "clusterId", title, snippet FROM osint_signals
     WHERE "clusterId" IS NOT NULL AND "fetchedAt" >= now() - interval '14 days'
     ORDER BY "fetchedAt" DESC LIMIT 500`);
  for (const r of recent) {
    if (isNearDuplicate(text, `${r.title} ${r.snippet || ""}`)) { clusterId = r.clusterId; canonical = false; break; }
  }
  if (!canonical) {
    await run(`UPDATE osint_signals SET "syndicationCount" = "syndicationCount" + 1
               WHERE "clusterId" = $1 AND canonical = true`, [clusterId]);
  }

  const rel = scoreRelevance({ title: s.title, snippet: s.snippet, topic, source: src });
  const reviewStatus = rel.score >= Number(topic.reviewThreshold ?? 0.55) ? "AUTO" : "PENDING";
  return {
    credibility: credibilityFor(src?.reliability), relevance: rel.score,
    clusterId, canonical, reviewStatus, contentHash: contentHash(text),
  };
}

// ── Refresh / ingest ─────────────────────────────────────────────────
async function refreshTopic(topic) {
  const { signals, errors } = await gatherTopic(topic);
  let inserted = 0, skipped = 0;
  const bySource = {};
  let quarantined = 0, syndicated = 0;
  for (const s of signals) {
    if (s.url) {
      const dup = await get(`SELECT 1 FROM osint_signals WHERE "topicId" = $1 AND url = $2`, [topic.id, s.url]);
      if (dup) { skipped++; continue; }
    } else {
      const dup = await get(`SELECT 1 FROM osint_signals WHERE "topicId" = $1 AND title = $2`, [topic.id, s.title]);
      if (dup) { skipped++; continue; }
    }

    const g = await gradeSignal(topic, s);
    if (g.reviewStatus === "PENDING") quarantined++;
    if (!g.canonical) syndicated++;

    await run(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, snippet, author, lang,
         sentiment, "sentimentLabel", "publishedAt", credibility, relevance, "clusterId", canonical,
         "reviewStatus", "contentHash")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [topic.id, s.source || null, s.sourceType || "RSS", s.title, s.url || null, s.snippet || null,
       s.author || null, s.lang || null, num(s.sentiment), s.sentimentLabel || "NEU", iso(s.publishedAt),
       g.credibility, g.relevance, g.clusterId, g.canonical, g.reviewStatus, g.contentHash]
    );
    inserted++;
    // resolve who this actually names, with sentiment toward each of them
    try {
      const fresh = await get(`SELECT id FROM osint_signals WHERE "topicId" = $1 AND title = $2
                               ORDER BY "fetchedAt" DESC LIMIT 1`, [topic.id, s.title]);
      if (fresh) await linkSignalEntities(fresh.id, `${s.title} ${s.snippet || ""}`);
    } catch { /* resolution must never block collection */ }
    bySource[s.sourceType || "RSS"] = (bySource[s.sourceType || "RSS"] || 0) + 1;
  }
  await run(`UPDATE osint_topics SET "lastRunAt" = now() WHERE id = $1`, [topic.id]);
  return { topicId: topic.id, label: topic.label, fetched: signals.length, inserted, skipped, quarantined, syndicated, bySource, errors };
}

async function refreshAllTopics() {
  const topics = await all("SELECT * FROM osint_topics WHERE active = true");
  const results = [];
  for (const t of topics) results.push(await refreshTopic(t));
  return {
    topics: results.length,
    inserted: results.reduce((a, r) => a + r.inserted, 0),
    skipped: results.reduce((a, r) => a + r.skipped, 0),
    errors: results.flatMap((r) => r.errors.map((e) => ({ topic: r.label, ...e }))),
    results,
  };
}

// Intel portion of the Daily Pulse: ingestion + listening alerts.
// Flag-gated internally; orchestrated by src/dailypulse.js.
export async function runOsintDaily() {
  const { getModules, moduleEnabled } = await import("../flags.js");
  if (!moduleEnabled(await getModules(), "intel")) {
    return { skipped: true, reason: "intel module disabled" };
  }
  try {
    const summary = await refreshAllTopics();
    // Push fresh listening alerts to admins as notifications (once per day per type).
    let alertsPushed = 0;
    try {
      const { alerts } = await computeListening();
      if (alerts.length) {
        const admins = (await all(
          `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
           WHERE u.active = true AND (r.permissions->>'admin')::boolean IS TRUE`
        )).map((r) => r.id);
        const audience = admins.length ? admins
          : (await all(`SELECT id FROM users WHERE active = true AND role = 'HEAD'`)).map((r) => r.id);
        const recent = new Set((await all(
          `SELECT DISTINCT type FROM notifications WHERE type LIKE 'ALERT_%' AND "createdAt" >= now() - interval '20 hours'`
        )).map((r) => r.type));
        for (const a of alerts) {
          const type = `ALERT_${a.type}`;
          if (recent.has(type)) continue;
          await notify(audience, type, { value: a.value, baseline: a.baseline ?? null, platform: a.platform ?? null, handle: a.handle ?? null }, "/listening");
          recent.add(type); alertsPushed++;
        }
      }
    } catch { /* alerting must never fail the ingest */ }
    return { alertsPushed, ...summary };
  } catch (e) {
    return { error: e.message };
  }
}

osintRouter.post("/topics/:id/refresh", requirePerm("intel"), async (req, res, next) => {
  try {
    const topic = await get("SELECT * FROM osint_topics WHERE id = $1", [req.params.id]);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    res.json(await refreshTopic(topic));
  } catch (e) { next(e); }
});

osintRouter.post("/refresh", requirePerm("intel"), async (req, res, next) => {
  try {
    const summary = await refreshAllTopics();
    logAudit(req, "osint.refresh", "osint_signals", null, { inserted: summary.inserted, topics: summary.topics });
    res.json(summary);
  } catch (e) { next(e); }
});

// ── Signals ──────────────────────────────────────────────────────────
osintRouter.get("/signals", requirePerm("intel", "read"), async (req, res, next) => {
  const { topicId, sentiment, limit, include } = req.query;
  const where = [], params = [];
  if (topicId) { params.push(topicId); where.push(`s."topicId" = $${params.length}`); }
  if (sentiment) { params.push(sentiment); where.push(`s."sentimentLabel" = $${params.length}`); }
  // the browse list must agree with the numbers: rejected signals and
  // syndicated copies are hidden unless explicitly asked for
  if (include !== "all") where.push(`s.canonical = true AND s."reviewStatus" <> 'REJECTED'`);
  const lim = Math.min(Number(limit) || 100, 300);
  try {
    res.json(await all(
      `SELECT s.*, t.label AS "topicLabel", t.category FROM osint_signals s
       JOIN osint_topics t ON t.id = s."topicId"
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY COALESCE(s."publishedAt", s."fetchedAt") DESC LIMIT ${lim}`,
      params
    ));
  } catch (e) { next(e); }
});

// Manual observation (analyst-logged signal).
osintRouter.post("/signals", async (req, res, next) => {
  const { topicId, title, url, snippet, source } = req.body;
  if (!topicId || !title) return res.status(400).json({ error: "topicId and title required" });
  try {
    const topic = await get(`SELECT * FROM osint_topics WHERE id = $1`, [topicId]);
    if (!topic) return res.status(400).json({ error: "Unknown topic" });
    const senti = scoreSentiment(`${title} ${snippet || ""}`);
    const g = await gradeSignal(topic, { title, snippet, url, source });
    const row = await get(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, snippet, sentiment,
         "sentimentLabel", "publishedAt", credibility, relevance, "clusterId", canonical, "reviewStatus", "contentHash")
       VALUES ($1,$2,'MANUAL',$3,$4,$5,$6,$7, now(),$8,$9,$10,$11,$12,$13) RETURNING *`,
      [topicId, source || "manual", title, url || null, snippet || null, senti.score, senti.label,
       g.credibility, g.relevance, g.clusterId, g.canonical, g.reviewStatus, g.contentHash]
    );
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.delete("/signals/:id", requirePerm("intel"), async (req, res, next) => {
  try { await run("DELETE FROM osint_signals WHERE id = $1", [req.params.id]); res.status(204).end(); }
  catch (e) { next(e); }
});

// Turn a market signal into a lead in the pipeline.
osintRouter.post("/signals/:id/to-lead", async (req, res, next) => {
  try {
    const s = await get("SELECT * FROM osint_signals WHERE id = $1", [req.params.id]);
    if (!s) return res.status(404).json({ error: "Signal not found" });
    const lead = await get(
      `INSERT INTO leads (company, source, stage, notes, "ownerId")
       VALUES ($1,'OSINT','NEW',$2,$3) RETURNING *`,
      [s.source || s.title.slice(0, 60), `${s.title}\n${s.url || ""}`, req.user.id]
    );
    res.status(201).json(lead);
  } catch (e) { next(e); }
});

// ── Intelligence overview (dashboard) ────────────────────────────────
osintRouter.get("/overview", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    const [total, perDay, bySentiment, bySource, byTopic, titles, recent] = await Promise.all([
      get(`SELECT COUNT(*)::int AS n FROM osint_signals`),
      all(`SELECT to_char(COALESCE("publishedAt","fetchedAt"),'YYYY-MM-DD') AS d, COUNT(*)::int AS c
           FROM osint_signals WHERE COALESCE("publishedAt","fetchedAt") >= now() - interval '14 days'
           GROUP BY d ORDER BY d`),
      all(`SELECT "sentimentLabel" AS label, COUNT(*)::int AS c FROM osint_signals GROUP BY "sentimentLabel"`),
      all(`SELECT source, COUNT(*)::int AS c FROM osint_signals WHERE source IS NOT NULL
           GROUP BY source ORDER BY c DESC LIMIT 8`),
      all(`SELECT t.label, t.category, COUNT(s.id)::int AS c
           FROM osint_topics t LEFT JOIN osint_signals s ON s."topicId" = t.id
           GROUP BY t.id, t.label, t.category ORDER BY c DESC`),
      all(`SELECT title FROM osint_signals ORDER BY COALESCE("publishedAt","fetchedAt") DESC LIMIT 200`),
      all(`SELECT s.id, s.title, s.url, s.source, s."sentimentLabel", s."publishedAt", t.label AS "topicLabel"
           FROM osint_signals s JOIN osint_topics t ON t.id = s."topicId"
           ORDER BY COALESCE(s."publishedAt", s."fetchedAt") DESC LIMIT 10`),
    ]);
    res.json({
      total: total.n,
      perDay: perDay.map((r) => ({ date: r.d, count: r.c })),
      bySentiment, bySource, byTopic,
      trending: trendingTerms(titles.map((t) => t.title)),
      recent,
    });
  } catch (e) { next(e); }
});

// ── Hygiene sweep: stale leads, overdue tasks, content due, campaign
//    overruns, customer reviews → one aggregated notification per owner
//    per category per day. Unowned items fall to admins.
export async function hygieneSweep() {
  const settings = await get(`SELECT "staleLeadDays", "customerReviewDays" FROM settings WHERE id = 1`).catch(() => null);
  const staleDays = settings?.staleLeadDays || 3;
  const admins = (await all(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
     WHERE u.active = true AND (r.permissions->>'admin')::boolean IS TRUE`).catch(() => [])).map((r) => r.id);

  const sweeps = [
    { type: "SWEEP_STALE_LEADS", link: "/leads",
      sql: `SELECT "ownerId" AS owner, COUNT(*)::int AS n FROM leads
            WHERE stage NOT IN ('WON','LOST') AND "updatedAt" < now() - ($1 || ' days')::interval
            GROUP BY "ownerId"`, params: [String(staleDays)] },
    { type: "SWEEP_OVERDUE_TASKS", link: "/tasks",
      sql: `SELECT "assigneeId" AS owner, COUNT(*)::int AS n FROM tasks
            WHERE status <> 'DONE' AND "dueDate" IS NOT NULL AND "dueDate" < CURRENT_DATE
            GROUP BY "assigneeId"` },
    { type: "SWEEP_CONTENT_DUE", link: "/calendar",
      sql: `SELECT "authorId" AS owner, COUNT(*)::int AS n FROM content_items
            WHERE status NOT IN ('APPROVED','PUBLISHED') AND "scheduledAt" IS NOT NULL
              AND "scheduledAt" < now() + interval '48 hours' AND "scheduledAt" > now() - interval '7 days'
            GROUP BY "authorId"` },
    { type: "SWEEP_CAMPAIGN_OVERRUN", link: "/campaigns",
      sql: `SELECT "ownerId" AS owner, COUNT(*)::int AS n FROM campaigns
            WHERE status = 'ACTIVE' AND "endDate" IS NOT NULL AND "endDate" < now()
            GROUP BY "ownerId"` },
    { type: "SWEEP_CUSTOMER_REVIEW", link: "/customers",
      sql: `SELECT "accountOwnerId" AS owner, COUNT(*)::int AS n FROM customers
            WHERE status = 'ACTIVE' AND "nextReviewAt" IS NOT NULL AND "nextReviewAt" <= CURRENT_DATE
            GROUP BY "accountOwnerId"` },
    // Wave 1·A — studio SLA + agency fairness (chases OUR side too)
    { type: "SWEEP_STUDIO_SLA", link: "/studio", flag: "studio",
      sql: `SELECT COALESCE("assigneeId", "requesterId") AS owner, COUNT(*)::int AS n FROM creative_requests
            WHERE status NOT IN ('DONE','REJECTED') AND "slaDueAt" IS NOT NULL AND "slaDueAt" < now()
            GROUP BY COALESCE("assigneeId", "requesterId")` },
    { type: "SWEEP_AGENCY_OVERDUE", link: "/agency", flag: "agency",
      sql: `SELECT e."ownerId" AS owner, COUNT(*)::int AS n FROM deliverables d
            JOIN engagements e ON e.id = d."engagementId"
            WHERE d.status <> 'APPROVED' AND d."dueDate" IS NOT NULL AND d."dueDate" < now()
            GROUP BY e."ownerId"` },
    { type: "SWEEP_AGENCY_REVIEW", link: "/agency", flag: "agency",
      sql: `SELECT e."ownerId" AS owner, COUNT(*)::int AS n FROM deliverables d
            JOIN engagements e ON e.id = d."engagementId"
            WHERE d.status = 'SUBMITTED' AND d."submittedAt" IS NOT NULL AND d."submittedAt" < now() - interval '48 hours'
            GROUP BY e."ownerId"` },
  ];
  const { getModules, moduleEnabled } = await import("../flags.js");
  const mods = await getModules();
  const activeSweeps = sweeps.filter((sw) => !sw.flag || moduleEnabled(mods, sw.flag));

  const already = new Set((await all(
    `SELECT DISTINCT "userId" || ':' || type AS k FROM notifications
     WHERE type LIKE 'SWEEP_%' AND "createdAt" >= now() - interval '20 hours'`).catch(() => [])).map((r) => r.k));

  let pushed = 0;
  for (const s2 of activeSweeps) {
    const rows = await all(s2.sql, s2.params || []).catch(() => []);
    for (const row of rows) {
      const audience = row.owner ? [row.owner] : admins;
      for (const uid of audience) {
        if (already.has(`${uid}:${s2.type}`)) continue;
        await notify([uid], s2.type, { count: row.n }, s2.link);
        already.add(`${uid}:${s2.type}`); pushed++;
      }
    }
  }
  return pushed;
}

// ═══ P2 · entities, aliases, and honest share of voice ═══════════════
osintRouter.get("/entities", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT e.*, c.name AS "competitorName",
              (SELECT COUNT(*)::int FROM osint_aliases a WHERE a."entityId" = e.id) AS "aliasCount",
              (SELECT COUNT(*)::int FROM osint_signal_entities se WHERE se."entityId" = e.id) AS mentions
       FROM osint_entities e LEFT JOIN competitors c ON c.id = e."competitorId"
       ORDER BY e."isSelf" DESC, e.name`));
  } catch (e) { next(e); }
});

osintRouter.post("/entities", requirePerm("intel"), async (req, res, next) => {
  try {
    const { ENTITY_KINDS, seedAliases, bustEntityCache } = await import("../osint/entities.js");
    const { name, nameAr, kind = "ORG" } = req.body || {};
    if (!name && !nameAr) return res.status(400).json({ error: "name or nameAr is required" });
    // GUARDRAIL: this platform does not profile private individuals.
    if (!ENTITY_KINDS.includes(kind)) {
      return res.status(400).json({
        error: "Entities may only be ORG, BRAND, PRODUCT, OUTLET, or PUBLIC_FIGURE (official spokespeople). Pulse does not profile private individuals.",
      });
    }
    const row = await get(
      `INSERT INTO osint_entities (kind, name, "nameAr", country, notes, "competitorId", "customerId", "isSelf")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [kind, name || nameAr, nameAr || null, req.body.country || null, req.body.notes || null,
       req.body.competitorId || null, req.body.customerId || null, !!req.body.isSelf]);
    await seedAliases(row.id, { name: row.name, nameAr: row.nameAr });
    bustEntityCache();
    logAudit(req, "osint.entity.create", "osint_entities", row.id, { kind });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.patch("/entities/:id", requirePerm("intel"), async (req, res, next) => {
  try {
    const { ENTITY_KINDS, bustEntityCache } = await import("../osint/entities.js");
    const ent = await get(`SELECT * FROM osint_entities WHERE id = $1`, [req.params.id]);
    if (!ent) return res.status(404).json({ error: "Not found" });
    if (req.body.kind && !ENTITY_KINDS.includes(req.body.kind)) {
      return res.status(400).json({ error: "Unsupported entity kind" });
    }
    for (const f of ["kind", "name", "nameAr", "country", "notes", "competitorId", "customerId", "isSelf", "active"]) {
      if (req.body[f] !== undefined) {
        await run(`UPDATE osint_entities SET "${f}" = $2, "updatedAt" = now() WHERE id = $1`, [ent.id, req.body[f]]);
      }
    }
    bustEntityCache();
    res.json(await get(`SELECT * FROM osint_entities WHERE id = $1`, [ent.id]));
  } catch (e) { next(e); }
});

osintRouter.delete("/entities/:id", requirePerm("intel"), async (req, res, next) => {
  try {
    const { bustEntityCache } = await import("../osint/entities.js");
    await run(`DELETE FROM osint_entities WHERE id = $1`, [req.params.id]);
    bustEntityCache();
    res.status(204).end();
  } catch (e) { next(e); }
});

osintRouter.get("/entities/:id/aliases", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    res.json(await all(`SELECT * FROM osint_aliases WHERE "entityId" = $1 ORDER BY kind, surface`, [req.params.id]));
  } catch (e) { next(e); }
});

osintRouter.post("/entities/:id/aliases", requirePerm("intel"), async (req, res, next) => {
  try {
    const { normalizeAr } = await import("../osint/arabic.js");
    const { bustEntityCache } = await import("../osint/entities.js");
    const { surface, lang = "ar", kind = "EXACT", weight = 1 } = req.body || {};
    if (!surface) return res.status(400).json({ error: "surface is required" });
    const norm = normalizeAr(surface);
    if (norm.length < 2) return res.status(400).json({ error: "Alias is too short to match on" });
    const dup = await get(`SELECT 1 FROM osint_aliases WHERE "entityId" = $1 AND "surfaceNorm" = $2`, [req.params.id, norm]);
    if (dup) return res.status(409).json({ error: "Alias already exists" });
    const row = await get(
      `INSERT INTO osint_aliases ("entityId", surface, "surfaceNorm", lang, kind, weight)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.params.id, surface, norm, lang, kind, Number(weight) || 1]);
    bustEntityCache();
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.delete("/aliases/:id", requirePerm("intel"), async (req, res, next) => {
  try {
    const { bustEntityCache } = await import("../osint/entities.js");
    await run(`DELETE FROM osint_aliases WHERE id = $1`, [req.params.id]);
    bustEntityCache();
    res.status(204).end();
  } catch (e) { next(e); }
});

osintRouter.get("/sov", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    const { entitySov } = await import("../osint/entities.js");
    res.json(await entitySov({ days: Number(req.query.days) || 30 }));
  } catch (e) { next(e); }
});

osintRouter.post("/resolve", requirePerm("intel"), async (_req, res, next) => {
  try {
    const { resolveAllSignals } = await import("../osint/entities.js");
    res.json(await resolveAllSignals());
  } catch (e) { next(e); }
});

// ═══ P3 · evidence & case files ══════════════════════════════════════
osintRouter.post("/signals/:id/snapshot", requirePerm("intel"), async (req, res, next) => {
  try {
    const { captureSnapshot } = await import("../osint/evidence.js");
    const sig = await get(`SELECT * FROM osint_signals WHERE id = $1`, [req.params.id]);
    if (!sig) return res.status(404).json({ error: "Not found" });
    const out = await captureSnapshot(sig, req.user.id);
    logAudit(req, "osint.snapshot", "osint_signals", sig.id, { kind: out.kind });
    res.status(201).json(out);
  } catch (e) { next(e); }
});

osintRouter.get("/signals/:id/provenance", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    const { provenanceOf } = await import("../osint/evidence.js");
    const p = await provenanceOf(req.params.id);
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  } catch (e) { next(e); }
});

osintRouter.get("/cases", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT c.*, u.name AS "ownerName",
              (SELECT COUNT(*)::int FROM osint_case_items i WHERE i."caseId" = c.id) AS items
       FROM osint_cases c LEFT JOIN users u ON u.id = c."ownerId"
       ORDER BY c.status, c."updatedAt" DESC`));
  } catch (e) { next(e); }
});

osintRouter.post("/cases", requirePerm("intel"), async (req, res, next) => {
  try {
    if (!req.body?.title) return res.status(400).json({ error: "title is required" });
    const row = await get(
      `INSERT INTO osint_cases (title, "titleAr", question, "ownerId") VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.body.title, req.body.titleAr || null, req.body.question || null, req.user.id]);
    logAudit(req, "osint.case.create", "osint_cases", row.id, null);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.patch("/cases/:id", requirePerm("intel"), async (req, res, next) => {
  try {
    const c = await get(`SELECT * FROM osint_cases WHERE id = $1`, [req.params.id]);
    if (!c) return res.status(404).json({ error: "Not found" });
    for (const f of ["title", "titleAr", "question", "summary", "status"]) {
      if (req.body[f] !== undefined) {
        await run(`UPDATE osint_cases SET "${f}" = $2, "updatedAt" = now() WHERE id = $1`, [c.id, req.body[f]]);
      }
    }
    if (req.body.status === "CLOSED") await run(`UPDATE osint_cases SET "closedAt" = now() WHERE id = $1`, [c.id]);
    res.json(await get(`SELECT * FROM osint_cases WHERE id = $1`, [c.id]));
  } catch (e) { next(e); }
});

// A case is a timeline of evidence around a question.
osintRouter.get("/cases/:id/items", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT i.*, s.title, s.url, s.source, s."publishedAt", s."snapshotFileId", s.credibility,
              e.name AS "entityName", u.name AS "addedByName"
       FROM osint_case_items i
       LEFT JOIN osint_signals s ON s.id = i."signalId"
       LEFT JOIN osint_entities e ON e.id = i."entityId"
       LEFT JOIN users u ON u.id = i."addedById"
       WHERE i."caseId" = $1
       ORDER BY COALESCE(s."publishedAt", i."createdAt") ASC`, [req.params.id]));
  } catch (e) { next(e); }
});

osintRouter.post("/cases/:id/items", requirePerm("intel"), async (req, res, next) => {
  try {
    const c = await get(`SELECT * FROM osint_cases WHERE id = $1`, [req.params.id]);
    if (!c) return res.status(404).json({ error: "Not found" });
    const { signalId, entityId, note } = req.body || {};
    if (!signalId && !entityId && !note) return res.status(400).json({ error: "Add a signal, an entity, or a note" });
    if (signalId) {
      const dup = await get(`SELECT 1 FROM osint_case_items WHERE "caseId" = $1 AND "signalId" = $2`, [c.id, signalId]);
      if (dup) return res.status(409).json({ error: "Already in this case" });
    }
    const row = await get(
      `INSERT INTO osint_case_items ("caseId", "signalId", "entityId", note, "addedById")
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [c.id, signalId || null, entityId || null, note || null, req.user.id]);
    await run(`UPDATE osint_cases SET "updatedAt" = now() WHERE id = $1`, [c.id]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.delete("/case-items/:id", requirePerm("intel"), async (req, res, next) => {
  try {
    await run(`DELETE FROM osint_case_items WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ═══ P4 · discovery, corroboration, tuning ═══════════════════════════
osintRouter.get("/entities/:id/handles", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    const { candidatesFor } = await import("../osint/discovery.js");
    res.json(await candidatesFor(req.params.id));
  } catch (e) { next(e); }
});

osintRouter.post("/entities/:id/discover", requirePerm("intel"), async (req, res, next) => {
  try {
    const { discoverHandles } = await import("../osint/discovery.js");
    const cfg = await get(`SELECT integrations FROM settings WHERE id = 1`);
    const ints = typeof cfg?.integrations === "string" ? JSON.parse(cfg.integrations || "{}") : (cfg?.integrations || {});
    const out = await discoverHandles(req.params.id, { baseUrl: ints?.discovery?.baseUrl || null });
    if (out.error) return res.status(400).json(out);
    logAudit(req, "osint.discover", "osint_entities", req.params.id, out);
    res.json(out);
  } catch (e) { next(e); }
});

// Discovery proposes; this is where a human disposes.
osintRouter.post("/handles/:id/decide", requirePerm("intel"), async (req, res, next) => {
  try {
    const { decideCandidate } = await import("../osint/discovery.js");
    const { status } = req.body || {};
    if (!["CONFIRMED", "REJECTED"].includes(status)) return res.status(400).json({ error: "status must be CONFIRMED or REJECTED" });
    const row = await decideCandidate(req.params.id, status, req.user.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    logAudit(req, "osint.handle.decide", "osint_handle_candidates", row.id, { status });
    res.json(row);
  } catch (e) { next(e); }
});

osintRouter.get("/corroboration", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT s.id, s.title, s.source, s."clusterId", s."corroborationCount", s.corroborated,
              s."syndicationCount", s."publishedAt"
       FROM osint_signals s
       WHERE s.canonical = true AND s."reviewStatus" <> 'REJECTED'
         AND s."fetchedAt" >= now() - interval '30 days'
       ORDER BY s."corroborationCount" DESC, s."publishedAt" DESC NULLS LAST LIMIT 50`));
  } catch (e) { next(e); }
});

osintRouter.post("/corroborate", requirePerm("intel"), async (_req, res, next) => {
  try {
    const { corroborationSweep } = await import("../osint/corroborate.js");
    res.json(await corroborationSweep());
  } catch (e) { next(e); }
});

// The system measuring its own accuracy, from the analysts' rulings.
osintRouter.get("/tuning", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    const { tuningFor } = await import("../osint/corroborate.js");
    res.json(await tuningFor(req.query.topicId || null));
  } catch (e) { next(e); }
});

osintRouter.post("/topics/:id/threshold", requirePerm("intel"), async (req, res, next) => {
  try {
    const th = Number(req.body?.threshold);
    if (!(th >= 0 && th <= 1)) return res.status(400).json({ error: "threshold must be between 0 and 1" });
    const t = await get(`SELECT * FROM osint_topics WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Not found" });
    await run(`UPDATE osint_topics SET "reviewThreshold" = $2 WHERE id = $1`, [t.id, th]);
    logAudit(req, "osint.threshold", "osint_topics", t.id, { from: Number(t.reviewThreshold), to: th });
    res.json(await get(`SELECT id, label, "reviewThreshold" FROM osint_topics WHERE id = $1`, [t.id]));
  } catch (e) { next(e); }
});

// ═══ W3·E · AI-assisted listening ════════════════════════════════════
osintRouter.post("/signals/:id/adjudicate", requirePerm("intel"), async (req, res, next) => {
  try {
    const { adjudicateRelevance } = await import("../osint/ai-listening.js");
    const out = await adjudicateRelevance(req.params.id);
    res.status(out.ok ? 200 : 200).json(out);
  } catch (e) { next(e); }
});

osintRouter.post("/adjudicate", requirePerm("intel"), async (_req, res, next) => {
  try {
    const { adjudicatePending } = await import("../osint/ai-listening.js");
    res.json(await adjudicatePending());
  } catch (e) { next(e); }
});

// Does the model agree with the people who know? Measured, not assumed.
osintRouter.get("/agreement", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    const { relevanceAgreement } = await import("../osint/ai-listening.js");
    res.json(await relevanceAgreement());
  } catch (e) { next(e); }
});

osintRouter.get("/themes", requirePerm("intel", "read"), async (req, res, next) => {
  try {
    const where = req.query.topicId ? `WHERE t."topicId" = $1` : "";
    res.json(await all(
      `SELECT t.*, tp.label AS "topicLabel",
              (SELECT json_agg(json_build_object('id', ts."signalId", 'quote', ts.quote))
               FROM osint_theme_signals ts WHERE ts."themeId" = t.id) AS signals
       FROM osint_themes t LEFT JOIN osint_topics tp ON tp.id = t."topicId"
       ${where}
       ORDER BY t.emerging DESC, t."signalCount" DESC, t."createdAt" DESC LIMIT 40`,
      req.query.topicId ? [req.query.topicId] : []));
  } catch (e) { next(e); }
});

osintRouter.post("/topics/:id/themes", requirePerm("intel"), async (req, res, next) => {
  try {
    const { clusterThemes } = await import("../osint/ai-listening.js");
    const out = await clusterThemes(req.params.id, { days: Number(req.body?.days) || 30 });
    if (!out.ok) return res.status(out.abstained ? 200 : 400).json(out);
    logAudit(req, "osint.themes", "osint_topics", req.params.id, { themes: out.themes.length });
    res.status(201).json(out);
  } catch (e) { next(e); }
});

osintRouter.post("/themes/:id/decide", requirePerm("intel"), async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["ACCEPTED", "DISMISSED"].includes(status)) {
      return res.status(400).json({ error: "status must be ACCEPTED or DISMISSED" });
    }
    const t = await get(`SELECT * FROM osint_themes WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Not found" });
    await run(`UPDATE osint_themes SET status = $2 WHERE id = $1`, [t.id, status]);
    res.json(await get(`SELECT * FROM osint_themes WHERE id = $1`, [t.id]));
  } catch (e) { next(e); }
});

osintRouter.post("/topics/:id/suggest-terms", requirePerm("intel"), async (req, res, next) => {
  try {
    const { suggestTerms } = await import("../osint/ai-listening.js");
    const out = await suggestTerms(req.params.id);
    res.status(out.ok ? 200 : 200).json(out);
  } catch (e) { next(e); }
});

osintRouter.post("/entities/:id/brief", requirePerm("intel"), async (req, res, next) => {
  try {
    const { competitorBrief } = await import("../osint/ai-listening.js");
    const out = await competitorBrief(req.params.id, { days: Number(req.body?.days) || 30 });
    if (!out.ok) return res.status(out.abstained ? 200 : 400).json(out);
    logAudit(req, "osint.brief", "insights", out.insight.id, { entityId: req.params.id });
    res.status(201).json(out);
  } catch (e) { next(e); }
});
