import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { computeOverview } from "./analytics.js";
import { objectivesWithProgress } from "./planning.js";

export const brainRouter = Router();
brainRouter.use(requireAuth, requirePerm("brain", "read"));

// ── Conversation CRUD ──────────────────────────────────────────────────────

brainRouter.get("/conversations", async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT id, "userId", title, "createdAt", "updatedAt"
       FROM ai_conversations WHERE "userId" = $1
       ORDER BY "updatedAt" DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

brainRouter.post("/conversations", async (req, res, next) => {
  try {
    const title = (req.body?.title || "").trim().slice(0, 100) || "New conversation";
    const row = await get(
      `INSERT INTO ai_conversations ("userId", title) VALUES ($1, $2)
       RETURNING id, "userId", title, "createdAt", "updatedAt"`,
      [req.user.id, title]
    );
    res.status(201).json(row);
  } catch (e) { next(e); }
});

brainRouter.get("/conversations/:id", async (req, res, next) => {
  try {
    const convo = await get(
      `SELECT id, "userId", title, "createdAt", "updatedAt"
       FROM ai_conversations WHERE id = $1 AND "userId" = $2`,
      [req.params.id, req.user.id]
    );
    if (!convo) return res.status(404).json({ error: "Conversation not found" });
    const messages = await all(
      `SELECT id, role, text, reasoning, label, "createdAt"
       FROM ai_messages WHERE "conversationId" = $1
       ORDER BY "createdAt"`,
      [req.params.id]
    );
    res.json({ ...convo, messages });
  } catch (e) { next(e); }
});

brainRouter.patch("/conversations/:id", async (req, res, next) => {
  try {
    const title = (req.body?.title || "").trim().slice(0, 100);
    if (!title) return res.status(400).json({ error: "title is required" });
    const row = await get(
      `UPDATE ai_conversations SET title = $1, "updatedAt" = now()
       WHERE id = $2 AND "userId" = $3
       RETURNING id, "userId", title, "createdAt", "updatedAt"`,
      [title, req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ error: "Conversation not found" });
    res.json(row);
  } catch (e) { next(e); }
});

brainRouter.delete("/conversations/:id", async (req, res, next) => {
  try {
    const row = await get(
      `DELETE FROM ai_conversations WHERE id = $1 AND "userId" = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ error: "Conversation not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

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

async function callClaudeStream({ system, prompt, userText, maxTokens = 32000, userId, conversationId }, res) {
  const key = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.json({ configured: false, error: "No API key configured" });
    return;
  }

  // Save user message if conversationId provided (use userText for the label/display, not the full prompt)
  if (conversationId && userText) {
    await run(
      `INSERT INTO ai_messages ("conversationId", role, text) VALUES ($1, 'user', $2)`,
      [conversationId, userText]
    );
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

  let fullContent = "";
  let fullReasoning = "";

  try {
    const reader = orRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      res.write(chunk);

      // Accumulate content for DB save
      const lines = chunk.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") break;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning) fullReasoning += delta.reasoning;
          if (delta.content) fullContent += delta.content;
        } catch { /* skip malformed */ }
      }
    }
  } catch {
    // client disconnected
  }

  // Save AI message to conversation BEFORE res.end() so Vercel doesn't kill the async write
  if (conversationId && (fullContent || fullReasoning)) {
    try {
      await run(
        `INSERT INTO ai_messages ("conversationId", role, text, reasoning)
         VALUES ($1, 'cmo', $2, $3)`,
        [conversationId, fullContent, fullReasoning || null]
      );
      const msgCount = await get(
        `SELECT COUNT(*)::int AS cnt FROM ai_messages WHERE "conversationId" = $1`,
        [conversationId]
      );
      if (msgCount && msgCount.cnt <= 2) {
        const title = fullContent.replace(/["""«»]/g, "").trim().slice(0, 60) || "New conversation";
        await run(
          `UPDATE ai_conversations SET title = $1, "updatedAt" = now() WHERE id = $2`,
          [title, conversationId]
        );
      } else {
        await run(
          `UPDATE ai_conversations SET "updatedAt" = now() WHERE id = $1`,
          [conversationId]
        );
      }
    } catch { /* swallow save errors */ }
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

// Collect user text from the body for the prompt label (used to generate title).
function extractUserText(req) {
  return req.body?.question || req.body?.promptLabel || "";
}

async function ensureConversation(userId, userText, req) {
  let conversationId = req.body?.conversationId;
  if (conversationId) return conversationId;
  const title = userText ? userText.replace(/["""«»]/g, "").trim().slice(0, 60) : "New conversation";
  const row = await get(
    `INSERT INTO ai_conversations ("userId", title) VALUES ($1, $2) RETURNING id`,
    [userId, title || "New conversation"]
  );
  return row.id;
}

// Executive brief — the daily/weekly summary.
brainRouter.post("/brief", async (req, res, next) => {
  try {
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ctx = await buildContext();
    const prompt = `Here is the current marketing data snapshot (JSON):\n\n${JSON.stringify(ctx, null, 1)}\n\n` +
      `Write the executive marketing brief for the Head of Marketing. Cover, briefly: (1) the headline state of pipeline & revenue vs objectives, (2) what's working, (3) what's at risk or needs attention, (4) the top 3 actions to take this week. Cite the numbers. Keep it tight.`;
    if (req.body?.stream) {
      const conversationId = await ensureConversation(req.user.id, "(brief)", req);
      return callClaudeStream({ system: systemPrompt(lang), prompt, userText: "", maxTokens: 1300, userId: req.user.id, conversationId }, res);
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
      const conversationId = await ensureConversation(req.user.id, question, req);
      return callClaudeStream({ system: systemPrompt(lang), prompt, userText: question, userId: req.user.id, conversationId }, res);
    }
    const out = await callClaude({ system: systemPrompt(lang), prompt });
    res.json(out);
  } catch (e) { next(e); }
});

// Lets the UI show "configured / not configured" without making a model call.
brainRouter.get("/status", (_req, res) => {
  res.json({ configured: !!(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY), model: MODEL });
});
