import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { computeOverview } from "./analytics.js";
import { objectivesWithProgress } from "./planning.js";

export const brainRouter = Router();
brainRouter.use(requireAuth, requirePerm("brain", "read"));

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet";

// Compact, grounded snapshot of the marketing state for the model to reason over.
async function gatherContext() {
  const [overview, objectives, signals, topCampaigns, org] = await Promise.all([
    computeOverview(),
    objectivesWithProgress(),
    all(`SELECT title, source, "sentimentLabel", "publishedAt" FROM osint_signals
         ORDER BY COALESCE("publishedAt","fetchedAt") DESC LIMIT 12`),
    all(`SELECT c.name, COALESCE(SUM(l."valueUsd"),0)::float8 AS "pipelineUsd", COUNT(l.id)::int AS leads
         FROM campaigns c LEFT JOIN leads l ON l."campaignId" = c.id
         GROUP BY c.id, c.name HAVING COUNT(l.id) > 0 ORDER BY "pipelineUsd" DESC LIMIT 6`),
    get(`SELECT "orgName", "orgNameAr", "businessUnits", "localCurrency" FROM settings WHERE id = 1`),
  ]);
  let bus = org?.businessUnits ?? [];
  if (typeof bus === "string") { try { bus = JSON.parse(bus); } catch { bus = []; } }
  return {
    organization: `${org?.orgName || "the client organization"}${bus.length ? ` (business units: ${bus.join(", ")})` : ""}`,
    currency: { usdToLocalRate: overview.scorecard.rate, localCurrency: org?.localCurrency || "SDG", note: "All money values are USD; local = USD × rate." },
    scorecard: overview.scorecard,
    funnel: overview.funnel,
    pipeline: overview.pipeline,
    channels: overview.channels,
    trends6mo: overview.trends,
    contentByStatus: overview.contentByStatus,
    marketSentiment: overview.sentiment,
    objectives: objectives.map((o) => ({
      label: o.label, metric: o.metric, current: Math.round(o.current),
      target: Number(o.targetValue), progressPct: Math.round(o.progress * 100), pace: o.pace,
      window: [o.startDate, o.endDate],
    })),
    recentMarketSignals: signals.map((s) => ({ title: s.title, source: s.source, sentiment: s.sentimentLabel })),
    topCampaignsByPipeline: topCampaigns,
  };
}

function systemPrompt(lang, orgName) {
  const langLine = lang === "ar"
    ? "Respond ENTIRELY in Arabic (فصحى, clear and professional)."
    : "Respond in English.";
  return `You are Pulse's AI CMO (نبض) — the marketing brain for ${orgName || "this organization"}. You advise the Head of Marketing and channel leads.

GROUNDING RULES (critical):
- Reason ONLY from the marketing data provided in the user message (a JSON snapshot). Do not invent numbers.
- Always cite the specific figures behind any claim (e.g. "pipeline is $308k, 62% of the $500k target").
- When the data is insufficient to answer, say so plainly and state what's missing.
- The organization line in the snapshot tells you the industry and business units — ground your advice in that context. Money is USD with a dual local-currency display.
- You ADVISE; humans decide. Be honest about uncertainty. Never fabricate.

STYLE:
- Be concise, structured, and decisively useful. Lead with the answer, then the why.
- Prefer short paragraphs and tight bullet lists. Bold the few numbers that matter.
- Give concrete, prioritized recommendations a CMO can act on this week.
- ${langLine}`;
}

async function brainConfig() {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, provider: "anthropic", model: ANTHROPIC_MODEL };
  if (process.env.OPENROUTER_API_KEY) return { key: process.env.OPENROUTER_API_KEY, provider: "openrouter", model: OPENROUTER_MODEL };
  const s = await get(`SELECT integrations FROM settings WHERE id = 1`);
  const ints = typeof s?.integrations === "string" ? JSON.parse(s.integrations || "{}") : (s?.integrations || {});
  if (!ints?.ai?.apiKey) return null;
  const provider = ints.ai.provider === "openrouter" ? "openrouter" : "anthropic";
  return { key: ints.ai.apiKey, provider, model: ints.ai.model || (provider === "openrouter" ? OPENROUTER_MODEL : ANTHROPIC_MODEL) };
}

async function callClaude({ system, prompt, maxTokens = 1100 }) {
  const cfg = await brainConfig();
  if (!cfg) {
    return { configured: false };
  }
  let res;
  try {
    const openRouter = cfg.provider === "openrouter";
    res = await fetch(openRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(openRouter
          ? { authorization: `Bearer ${cfg.key}`, "http-referer": "https://helm-inky-iota.vercel.app", "x-title": "Pulse AI CMO" }
          : { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" }),
      },
      body: JSON.stringify(openRouter
        ? { model: cfg.model, max_tokens: maxTokens, temperature: 0.4, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }
        : { model: cfg.model, max_tokens: maxTokens, temperature: 0.4, system, messages: [{ role: "user", content: prompt }] }),
    });
  } catch {
    return { configured: true, error: `Couldn't reach the ${cfg.provider} AI provider.` };
  }
  if (!res.ok) {
    const hint = res.status === 401 ? ` — invalid ${cfg.provider} API key`
      : res.status === 404 ? ` — model "${cfg.model}" not found; check the configured model`
      : res.status === 429 ? " — rate limited; try again shortly" : "";
    return { configured: true, error: `AI provider error ${res.status}${hint}.` };
  }
  const data = await res.json();
  const text = cfg.provider === "openrouter"
    ? data.choices?.[0]?.message?.content || ""
    : (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { configured: true, answer: text || "(no response)" };
}

// Executive brief — the daily/weekly summary.
brainRouter.post("/brief", async (req, res, next) => {
  try {
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ctx = await gatherContext();
    const prompt = `Here is the current marketing data snapshot (JSON):\n\n${JSON.stringify(ctx, null, 1)}\n\n` +
      `Write the executive marketing brief for the Head of Marketing. Cover, briefly: (1) the headline state of pipeline & revenue vs objectives, (2) what's working, (3) what's at risk or needs attention, (4) the top 3 actions to take this week. Cite the numbers. Keep it tight.`;
    const out = await callClaude({ system: systemPrompt(lang, ctx.organization), prompt, maxTokens: 1300 });
    res.json(out);
  } catch (e) { next(e); }
});

// Free-form consult / diagnose / forecast / strategy — all grounded in the data.
brainRouter.post("/ask", async (req, res, next) => {
  const question = (req.body?.question || "").toString().trim();
  if (!question) return res.status(400).json({ error: "question is required" });
  try {
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ctx = await gatherContext();
    const prompt = `Marketing data snapshot (JSON):\n\n${JSON.stringify(ctx, null, 1)}\n\n` +
      `The marketing lead asks:\n"""${question}"""\n\nAnswer using the data above. Cite the relevant figures.`;
    const out = await callClaude({ system: systemPrompt(lang, ctx.organization), prompt });
    res.json(out);
  } catch (e) { next(e); }
});

// Lets the UI show "configured / not configured" without making a model call.
brainRouter.get("/status", async (_req, res) => {
  const cfg = await brainConfig();
  res.json({ configured: !!cfg, model: cfg?.model || null, provider: cfg?.provider || null });
});
