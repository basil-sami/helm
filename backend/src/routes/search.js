import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";
import { budgets, runSearch, searchAndIngest, PROVIDERS } from "../search.js";

// ═══ LIVE SEARCH (Wave 3·D) ══════════════════════════════════════════

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get("/budgets", requirePerm("intel", "read"), async (_req, res, next) => {
  try { res.json({ providers: await budgets() }); } catch (e) { next(e); }
});

searchRouter.patch("/budgets/:provider", requireAdmin, async (req, res, next) => {
  try {
    const p = String(req.params.provider).toUpperCase();
    if (!PROVIDERS.includes(p)) return res.status(400).json({ error: "Unknown provider" });
    const { monthlyCapUsd, active, costPerUnit } = req.body || {};
    if (monthlyCapUsd !== undefined && !(Number(monthlyCapUsd) >= 0)) {
      return res.status(400).json({ error: "monthlyCapUsd must be zero or more" });
    }
    await run(
      // explicit casts: COALESCE($2, 0) otherwise infers integer from the
      // literal and rejects a fractional ceiling
      `INSERT INTO search_budget (provider, "monthlyCapUsd", "costPerUnit", active)
       VALUES ($1, COALESCE($2::numeric, 0), COALESCE($3::numeric, 0), COALESCE($4::boolean, true))
       ON CONFLICT (provider) DO UPDATE SET
         "monthlyCapUsd" = COALESCE($2::numeric, search_budget."monthlyCapUsd"),
         "costPerUnit"   = COALESCE($3::numeric, search_budget."costPerUnit"),
         active          = COALESCE($4::boolean, search_budget.active),
         "updatedAt"     = now()`,
      [p, monthlyCapUsd ?? null, costPerUnit ?? null, active ?? null]);
    logAudit(req, "search.budget", "search_budget", null, { provider: p, monthlyCapUsd, active });
    res.json((await budgets())[p]);
  } catch (e) { next(e); }
});

searchRouter.get("/runs", requirePerm("intel", "read"), async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT s.*, u.name AS "runByName" FROM search_runs s
       LEFT JOIN users u ON u.id = s."runById" ORDER BY s.at DESC LIMIT 40`));
  } catch (e) { next(e); }
});

// A look, without keeping anything — for checking a provider works.
searchRouter.post("/preview", requirePerm("intel"), async (req, res, next) => {
  try {
    const { provider = "WEB", query } = req.body || {};
    if (!query) return res.status(400).json({ error: "query is required" });
    const r = await runSearch({ provider, query, userId: req.user.id });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { next(e); }
});

/**
 * Search and keep. Results enter the same pipeline RSS does — nothing
 * here reaches a metric without passing the relevance gate first.
 */
searchRouter.post("/topics/:id/search", requirePerm("intel"), async (req, res, next) => {
  try {
    const { provider = "WEB", query } = req.body || {};
    const topic = await get(`SELECT * FROM osint_topics WHERE id = $1`, [req.params.id]);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    const q = query || topic.query || topic.label;
    const out = await searchAndIngest({ provider, query: q, topicId: topic.id, userId: req.user.id });
    if (!out.ok) return res.status(400).json(out);
    logAudit(req, "search.ingest", "osint_topics", topic.id, { provider: out.provider, inserted: out.inserted });
    res.json(out);
  } catch (e) { next(e); }
});

/**
 * Ask your listening.
 *
 * Answered from what has already been collected and confirmed, with the
 * rows cited. Live search is reached for only when the stored corpus is
 * too thin to answer — the cheapest honest answer first.
 */
searchRouter.post("/ask", requirePerm("intel"), async (req, res, next) => {
  try {
    const { question, days = 30 } = req.body || {};
    if (!question) return res.status(400).json({ error: "question is required" });

    const rows = await all(
      `SELECT s.id, s.title, s.snippet, s.source, s."sentimentLabel", s."publishedAt"
       FROM osint_signals s
       WHERE s.canonical = true AND s."reviewStatus" IN ('AUTO','CONFIRMED')
         AND s."fetchedAt" >= now() - ($1 || ' days')::interval
       ORDER BY s."publishedAt" DESC NULLS LAST LIMIT 40`, [String(days)]);

    const evidence = rows.map((r) => ({
      kind: "signal", id: r.id,
      text: `${r.source || "unknown"} (${r.sentimentLabel || "NEU"}): ${r.title}${r.snippet ? ` — ${r.snippet.slice(0, 200)}` : ""}`,
    }));

    const { groundedComplete, cacheKeyFor } = await import("../ai.js");
    const r = await groundedComplete({
      feature: "ask_listening",
      cacheKey: cacheKeyFor("ask_listening", { question, ids: rows.map((x) => x.id) }),
      system: "Answer from the collected listening evidence only. Be brief and concrete. Reply in the question's language.",
      question,
      evidence,
    });

    if (!r.ok) {
      return res.json({
        ok: false, abstained: !!r.abstained, reason: r.reason || r.error,
        corpusSize: rows.length,
        hint: rows.length < 5 ? "thin_corpus" : null,
      });
    }
    res.json({ ok: true, answer: r.text, cached: !!r.cached, corpusSize: rows.length,
               citations: r.citations.map((c) => ({ id: c.id, text: c.text })) });
  } catch (e) { next(e); }
});
