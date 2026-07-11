import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { computeOverview } from "./analytics.js";
import { objectivesWithProgress } from "./planning.js";

export const brainRouter = Router();
brainRouter.use(requireAuth, requirePerm("brain", "read"));

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const API = "https://api.anthropic.com/v1/messages";

// Compact, grounded snapshot of the marketing state for the model to reason over.
async function gatherContext() {
  const [overview, objectives, signals, topCampaigns] = await Promise.all([
    computeOverview(),
    objectivesWithProgress(),
    all(`SELECT title, source, "sentimentLabel", "publishedAt" FROM osint_signals
         ORDER BY COALESCE("publishedAt","fetchedAt") DESC LIMIT 12`),
    all(`SELECT c.name, COALESCE(SUM(l."valueUsd"),0)::float8 AS "pipelineUsd", COUNT(l.id)::int AS leads
         FROM campaigns c LEFT JOIN leads l ON l."campaignId" = c.id
         GROUP BY c.id, c.name HAVING COUNT(l.id) > 0 ORDER BY "pipelineUsd" DESC LIMIT 6`),
  ]);
  return {
    organization: "Saria Industrial Complex (Sudanese industrial group: batteries, plastics, solar, ICT)",
    currency: { usdToSdgRate: overview.scorecard.rate, note: "All money values are USD; SDG = USD × rate." },
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

function systemPrompt(lang) {
  const langLine = lang === "ar"
    ? "Respond ENTIRELY in Arabic (فصحى, clear and professional)."
    : "Respond in English.";
  return `You are HELM's AI CMO — the marketing brain for Saria Industrial Complex, an industrial B2B group in Sudan. You advise the Head of Marketing and channel leads.

GROUNDING RULES (critical):
- Reason ONLY from the marketing data provided in the user message (a JSON snapshot). Do not invent numbers.
- Always cite the specific figures behind any claim (e.g. "pipeline is $308k, 62% of the $500k target").
- When the data is insufficient to answer, say so plainly and state what's missing.
- This is industrial B2B with long sales cycles, distributors, and tenders. Money is USD with a dual SDG display.
- You ADVISE; humans decide. Be honest about uncertainty. Never fabricate.

STYLE:
- Be concise, structured, and decisively useful. Lead with the answer, then the why.
- Prefer short paragraphs and tight bullet lists. Bold the few numbers that matter.
- Give concrete, prioritized recommendations a CMO can act on this week.
- ${langLine}`;
}

async function callClaude({ system, prompt, maxTokens = 1100 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { configured: false };
  }
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.4,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    return { configured: true, error: "Couldn't reach the AI provider. Check network egress to api.anthropic.com." };
  }
  if (!res.ok) {
    const hint = res.status === 401 ? " — invalid ANTHROPIC_API_KEY"
      : res.status === 404 ? ` — model "${MODEL}" not found; set ANTHROPIC_MODEL`
      : res.status === 429 ? " — rate limited; try again shortly" : "";
    return { configured: true, error: `AI provider error ${res.status}${hint}.` };
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { configured: true, answer: text || "(no response)" };
}

// Executive brief — the daily/weekly summary.
brainRouter.post("/brief", async (req, res, next) => {
  try {
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ctx = await gatherContext();
    const prompt = `Here is the current marketing data snapshot (JSON):\n\n${JSON.stringify(ctx, null, 1)}\n\n` +
      `Write the executive marketing brief for the Head of Marketing. Cover, briefly: (1) the headline state of pipeline & revenue vs objectives, (2) what's working, (3) what's at risk or needs attention, (4) the top 3 actions to take this week. Cite the numbers. Keep it tight.`;
    const out = await callClaude({ system: systemPrompt(lang), prompt, maxTokens: 1300 });
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
    const out = await callClaude({ system: systemPrompt(lang), prompt });
    res.json(out);
  } catch (e) { next(e); }
});

// Lets the UI show "configured / not configured" without making a model call.
brainRouter.get("/status", (_req, res) => {
  res.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_API_KEY ? MODEL : null });
});
