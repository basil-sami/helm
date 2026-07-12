import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { computeOverview } from "./analytics.js";
import { objectivesWithProgress } from "./planning.js";

export const brainRouter = Router();
brainRouter.use(requireAuth, requirePerm("brain", "read"));

const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet";
const API = "https://openrouter.ai/api/v1/chat/completions";

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

async function callClaude({ system, prompt, maxTokens = 2500 }) {
  const key = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { configured: false };
  }
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch {
    return { configured: true, error: "Couldn't reach the AI provider. Check network egress." };
  }
  const body = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 ? " — invalid API key"
      : res.status === 404 ? ` — model "${MODEL}" not found; set OPENROUTER_MODEL`
      : res.status === 429 ? " — rate limited; try again shortly" : "";
    return { configured: true, error: `AI provider error ${res.status}${hint}.`, detail: body };
  }
  let data;
  try { data = JSON.parse(body); } catch {
    return { configured: true, error: "Invalid JSON from AI provider." };
  }
  if (data.error) {
    return { configured: true, error: `AI provider error: ${data.error.message || JSON.stringify(data.error)}` };
  }
  const msg = data.choices?.[0]?.message;
  const text = typeof msg?.content === "string" ? msg.content
    : Array.isArray(msg?.content) ? msg.content.map((b) => b.text || "").join("\n")
    : msg?.reasoning || "";
  return { configured: true, answer: text || "(no response)" };
}

async function callClaudeStream({ system, prompt, maxTokens = 8000 }, res) {
  const key = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.json({ configured: false, error: "No API key configured" });
    return;
  }
  let orRes;
  try {
    orRes = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.4,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch {
    res.json({ configured: true, error: "Couldn't reach the AI provider. Check network egress." });
    return;
  }
  if (!orRes.ok) {
    const body = await orRes.text();
    res.json({ configured: true, error: `AI provider error ${orRes.status}.`, detail: body });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  try {
    const reader = orRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }
  } catch {
    // client disconnected
  }
  res.end();
}

function buildContext() {
  return gatherContext().then((ctx) => ({
    organization: ctx.organization,
    rate: ctx.currency.usdToSdgRate,
    scorecard: ctx.scorecard,
    funnel: ctx.funnel,
    pipeline: ctx.pipeline,
    channels: ctx.channels,
    trends6mo: ctx.trends6mo,
    contentByStatus: ctx.contentByStatus,
    sentiment: ctx.marketSentiment,
    objectives: ctx.objectives,
    recentSignals: ctx.recentMarketSignals,
    topCampaigns: ctx.topCampaignsByPipeline,
  }));
}

// Executive brief — the daily/weekly summary.
brainRouter.post("/brief", async (req, res, next) => {
  try {
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ctx = await buildContext();
    const prompt = `Here is the current marketing data snapshot (JSON):\n\n${JSON.stringify(ctx, null, 1)}\n\n` +
      `Write the executive marketing brief for the Head of Marketing. Cover, briefly: (1) the headline state of pipeline & revenue vs objectives, (2) what's working, (3) what's at risk or needs attention, (4) the top 3 actions to take this week. Cite the numbers. Keep it tight.`;
    if (req.body?.stream) {
      return callClaudeStream({ system: systemPrompt(lang), prompt }, res);
    }
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
    const ctx = await buildContext();
    const prompt = `Marketing data snapshot (JSON):\n\n${JSON.stringify(ctx, null, 1)}\n\n` +
      `The marketing lead asks:\n"""${question}"""\n\nAnswer using the data above. Cite the relevant figures.`;
    if (req.body?.stream) {
      return callClaudeStream({ system: systemPrompt(lang), prompt }, res);
    }
    const out = await callClaude({ system: systemPrompt(lang), prompt });
    res.json(out);
  } catch (e) { next(e); }
});

// Lets the UI show "configured / not configured" without making a model call.
brainRouter.get("/status", (_req, res) => {
  res.json({ configured: !!(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY), model: MODEL });
});
