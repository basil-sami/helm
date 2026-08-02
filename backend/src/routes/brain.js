import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { computeOverview } from "./analytics.js";
import { objectivesWithProgress } from "./planning.js";

export const brainRouter = Router();
brainRouter.use(requireAuth, requirePerm("brain", "read"));

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const API = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";

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

const providerError = (res) => {
  const hint = res.status === 401 ? " — invalid ANTHROPIC_API_KEY"
    : res.status === 404 ? ` — model "${MODEL}" not found; set ANTHROPIC_MODEL`
    : res.status === 429 ? " — rate limited; try again shortly" : "";
  return `AI provider error ${res.status}${hint}.`;
};

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
    return { configured: true, error: providerError(res) };
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { configured: true, answer: text || "(no response)" };
}

// Streaming variant — Anthropic `stream: true`, forwarded to the client as SSE.
// Keeps the upstream fetch alive until the stream finishes (or the client
// disconnects) so mid-stream Vercel timeouts surface as a visible error instead
// of a silently truncated message.
async function callClaudeStream({ system, prompt, maxTokens = 1100 }, req, res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.json({ configured: false });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(API, {
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
        stream: true,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    res.json({ configured: true, error: "Couldn't reach the AI provider. Check network egress to api.anthropic.com." });
    return;
  }
  if (!upstream.ok) {
    res.json({ configured: true, error: providerError(upstream) });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const started = Date.now();
  let full = "";
  let aborted = false;
  req.on("close", () => { aborted = true; });

  try {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    // Anthropic message API streams SSE lines: `event:` / `data: {...}`.
    // We forward a normalized SSE frame per text delta.
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Anthropic floats newlines between events; parse complete SSE blocks.
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
          full += evt.delta.text;
          if (aborted) return;
          res.write(`data: ${JSON.stringify({ text: evt.delta.text })}\n\n`);
        }
        if (evt.type === "message_stop" || evt.type === "error") {
          if (aborted) return;
          break;
        }
      }
    }
  } catch {
    if (aborted) return;
  }

  if (aborted) return;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (full) {
    res.write(`data: ${JSON.stringify({ done: true, text: full, elapsed })}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ error: "Stream ended without any content" })}\n\n`);
  }
  res.end();
}

// Executive brief — the daily/weekly summary.
brainRouter.post("/brief", async (req, res, next) => {
  try {
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ctx = await gatherContext();
    const prompt = `Here is the current marketing data snapshot (JSON):\n\n${JSON.stringify(ctx, null, 1)}\n\n` +
      `Write the executive marketing brief for the Head of Marketing. Cover, briefly: (1) the headline state of pipeline & revenue vs objectives, (2) what's working, (3) what's at risk or needs attention, (4) the top 3 actions to take this week. Cite the numbers. Keep it tight.`;
    if (req.body?.stream) {
      return await callClaudeStream({ system: systemPrompt(lang, ctx.organization), prompt, maxTokens: 1300 }, req, res);
    }
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
    if (req.body?.stream) {
      return await callClaudeStream({ system: systemPrompt(lang, ctx.organization), prompt }, req, res);
    }
    const out = await callClaude({ system: systemPrompt(lang, ctx.organization), prompt });
    res.json(out);
  } catch (e) { next(e); }
});

// Lets the UI show "configured / not configured" without making a model call.
brainRouter.get("/status", (_req, res) => {
  res.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_API_KEY ? MODEL : null });
});
