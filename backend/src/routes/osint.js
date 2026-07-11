import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { computeListening } from "./listening.js";
import { notify } from "../notify.js";
import { gatherTopic, trendingTerms, scoreSentiment } from "../integrations/osint.js";

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
  const { label, query, lang, region, category, sources, feeds } = req.body;
  if (!label || !query) return res.status(400).json({ error: "label and query are required" });
  if (category && !CATS.includes(category)) return res.status(400).json({ error: "Invalid category" });
  try {
    const row = await get(
      `INSERT INTO osint_topics (label, query, lang, region, category, sources, feeds)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [label, query, lang || "en", region || "SD", category || "MARKET",
       JSON.stringify(sources || ["GOOGLE_NEWS", "GDELT"]), JSON.stringify(feeds || [])]
    );
    res.status(201).json(row);
  } catch (e) { next(e); }
});

osintRouter.patch("/topics/:id", requirePerm("intel"), async (req, res, next) => {
  const sets = [], params = [];
  const push = (col, val) => { params.push(val); sets.push(`"${col}" = $${params.length}`); };
  for (const f of ["label", "query", "lang", "region", "category", "active"]) {
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

// ── Refresh / ingest ─────────────────────────────────────────────────
async function refreshTopic(topic) {
  const { signals, errors } = await gatherTopic(topic);
  let inserted = 0, skipped = 0;
  const bySource = {};
  for (const s of signals) {
    if (s.url) {
      const dup = await get(`SELECT 1 FROM osint_signals WHERE "topicId" = $1 AND url = $2`, [topic.id, s.url]);
      if (dup) { skipped++; continue; }
    } else {
      const dup = await get(`SELECT 1 FROM osint_signals WHERE "topicId" = $1 AND title = $2`, [topic.id, s.title]);
      if (dup) { skipped++; continue; }
    }
    await run(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, snippet, author, lang, sentiment, "sentimentLabel", "publishedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [topic.id, s.source || null, s.sourceType || "RSS", s.title, s.url || null, s.snippet || null,
       s.author || null, s.lang || null, num(s.sentiment), s.sentimentLabel || "NEU", iso(s.publishedAt)]
    );
    inserted++;
    bySource[s.sourceType || "RSS"] = (bySource[s.sourceType || "RSS"] || 0) + 1;
  }
  await run(`UPDATE osint_topics SET "lastRunAt" = now() WHERE id = $1`, [topic.id]);
  return { topicId: topic.id, label: topic.label, fetched: signals.length, inserted, skipped, bySource, errors };
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

// Scheduled ingestion (Vercel Cron). Guarded by CRON_SECRET when set —
// Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically.
export async function osintCronHandler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  if (secret) {
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "Invalid cron secret" });
  } else if (process.env.NODE_ENV === "production") {
    return res.status(401).json({ error: "Set CRON_SECRET to enable scheduled refresh" });
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
    let sweepPushed = 0;
    try { sweepPushed = await hygieneSweep(); } catch { /* sweep must never fail the ingest */ }
    res.json({ ok: true, at: new Date().toISOString(), alertsPushed, sweepPushed, ...summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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
  const { topicId, sentiment, limit } = req.query;
  const where = [], params = [];
  if (topicId) { params.push(topicId); where.push(`s."topicId" = $${params.length}`); }
  if (sentiment) { params.push(sentiment); where.push(`s."sentimentLabel" = $${params.length}`); }
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
    const senti = scoreSentiment(`${title} ${snippet || ""}`);
    const row = await get(
      `INSERT INTO osint_signals ("topicId", source, "sourceType", title, url, snippet, sentiment, "sentimentLabel", "publishedAt")
       VALUES ($1,$2,'MANUAL',$3,$4,$5,$6,$7, now()) RETURNING *`,
      [topicId, source || "manual", title, url || null, snippet || null, senti.score, senti.label]
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
async function hygieneSweep() {
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
  ];

  const already = new Set((await all(
    `SELECT DISTINCT "userId" || ':' || type AS k FROM notifications
     WHERE type LIKE 'SWEEP_%' AND "createdAt" >= now() - interval '20 hours'`).catch(() => [])).map((r) => r.k));

  let pushed = 0;
  for (const s2 of sweeps) {
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