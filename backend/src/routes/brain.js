import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { computeOverview } from "./analytics.js";
import { objectivesWithProgress } from "./planning.js";

export const brainRouter = Router();
brainRouter.use(requireAuth, requirePerm("brain", "read"));

// ── Conversation persistence ────────────────────────────────────────────
// A thread lives in the DB so the stream survives navigation: the server
// keeps writing partial tokens to ai_messages even after the user clicks
// away, and the poll on return resurfaced the growing text.

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
      `SELECT id, role, text, label, "createdAt"
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

// Update a message's text — used when the user edits and resends a prompt.
brainRouter.patch("/conversations/:id/messages/:msgId", async (req, res, next) => {
  try {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text is required" });
    const row = await get(
      `UPDATE ai_messages SET text = $1
       WHERE id = $2 AND "conversationId" IN (
         SELECT id FROM ai_conversations WHERE id = $3 AND "userId" = $4
       )
       RETURNING id, role, text, label, "createdAt"`,
      [text, req.params.msgId, req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ error: "Message not found" });
    res.json(row);
  } catch (e) { next(e); }
});

// Rewind: drop every message that came after `afterId` (edit + resend).
brainRouter.post("/conversations/:id/rewind", async (req, res, next) => {
  try {
    const afterId = req.body?.afterId;
    if (!afterId) return res.status(400).json({ error: "afterId is required" });
    await run(
      `DELETE FROM ai_messages
       WHERE "conversationId" = $1 AND "createdAt" >= (
         SELECT "createdAt" FROM ai_messages WHERE id = $2
       )
       AND "conversationId" IN (
         SELECT id FROM ai_conversations WHERE id = $1 AND "userId" = $3
       )`,
      [req.params.id, afterId, req.user.id]
    );
    await run(`UPDATE ai_conversations SET "updatedAt" = now() WHERE id = $1`, [req.params.id]);
    res.json({ rewound: true });
  } catch (e) { next(e); }
});

const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet";
const API = process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions";
const brainKey = () => process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || "";

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
  const hint = res.status === 401 ? " — invalid OPENROUTER_API_KEY"
    : res.status === 404 ? ` — model "${MODEL}" not found; set OPENROUTER_MODEL`
    : res.status === 429 ? " — rate limited; try again shortly" : "";
  return `AI provider error ${res.status}${hint}.`;
};

async function callClaude({ system, prompt, maxTokens = 1100 }) {
  const key = brainKey();
  if (!key) {
    return { configured: false };
  }
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
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
    return { configured: true, error: "Couldn't reach the AI provider. Check network egress to openrouter.ai." };
  }
  if (!res.ok) {
    return { configured: true, error: providerError(res) };
  }
  const data = await res.json();
  const text = typeof data?.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content
    : "";
  return { configured: true, answer: text.trim() || "(no response)" };
}

// Streaming variant — Anthropic `stream: true`, forwarded to the client as SSE.
// If a conversationId is given, the response is persisted to ai_messages as it
// arrives (roughly every 2s, plus a final save). The client may navigate away
// mid-stream: the fetch keeps running on the server side and the next time the
// user opens the conversation the poll picks up exactly where it stopped.
async function callClaudeStream({
  system, prompt, maxTokens = 1100, conversationId, userText,
}, req, res) {
  const key = brainKey();
  if (!key) {
    res.json({ configured: false });
    return;
  }

  // Persist this ask as a 'user' message and a placeholder 'cmo' message, so
  // the poll has a row to watch grow. Both are skipped when there is no
  // conversation (plain stateless /ask, e.g. from the test harness).
  let aiMsgId = null;
  if (conversationId) {
    if (userText) {
      await run(`INSERT INTO ai_messages ("conversationId", role, text) VALUES ($1, 'user', $2)`,
        [conversationId, userText]);
    }
    const row = await get(
      `INSERT INTO ai_messages ("conversationId", role, text) VALUES ($1, 'cmo', '') RETURNING id`,
      [conversationId]
    );
    aiMsgId = row?.id;
  }

  let upstream;
  try {
    upstream = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
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
    res.json({ configured: true, error: "Couldn't reach the AI provider. Check network egress to openrouter.ai." });
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
  let lastDbSave = 0;
  req.on("close", () => { aborted = true; });

  // Writes are the only part we skip after a client disconnect: the upstream
  // keeps streaming below so the DB still lands the full answer. The next
  // time the user opens this conversation, the poll shows it complete.
  const send = (frame) => {
    if (aborted) return;
    try { res.write(frame); } catch { aborted = true; }
  };

  const persist = async (final) => {
    if (!aiMsgId || !full) return;
    if (!final && Date.now() - lastDbSave < 2000) return;
    lastDbSave = Date.now();
    await run(`UPDATE ai_messages SET text = $1 WHERE id = $2`, [full, aiMsgId]);
  };

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
      // OpenRouter streams OpenAI-style SSE lines: `data: {...}` and `data: [DONE]`.
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
        const delta = evt.choices?.[0]?.delta;
        if (delta && typeof delta.content === "string" && delta.content) {
          full += delta.content;
          // Throttled DB write so the poll sees progress even mid-stream.
          if (aiMsgId && Date.now() - lastDbSave >= 2000) await persist(false);
          send(`data: ${JSON.stringify({ text: delta.content })}\n\n`);
        }
        if (evt.choices?.[0]?.finish_reason) break;
        if (evt.error) break;
      }
    }
  } catch {
    // socket or upstream hiccup — the final save below still runs
  }

  // Final save: complete content + bump the thread's title on first answer.
  if (aiMsgId) {
    try {
      await persist(true);
      if (conversationId) {
        const title = full.replace(/["""«»]/g, "").trim().slice(0, 60) || "New conversation";
        await run(
          `UPDATE ai_conversations SET title = $1, "updatedAt" = now() WHERE id = $2`,
          [title, conversationId]
        );
      }
    } catch { /* swallow save errors */ }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (!aborted) {
    if (full) {
      send(`data: ${JSON.stringify({ done: true, text: full, elapsed })}\n\n`);
    } else {
      send(`data: ${JSON.stringify({ error: "Stream ended without any content" })}\n\n`);
    }
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
      const conversationId = req.body?.conversationId || null;
      return await callClaudeStream(
        { system: systemPrompt(lang, ctx.organization), prompt, maxTokens: 1300, conversationId, userText: "" },
        req, res
      );
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
      const conversationId = req.body?.conversationId || null;
      return await callClaudeStream(
        { system: systemPrompt(lang, ctx.organization), prompt, conversationId, userText: question },
        req, res
      );
    }
    const out = await callClaude({ system: systemPrompt(lang, ctx.organization), prompt });
    res.json(out);
  } catch (e) { next(e); }
});

// Lets the UI show "configured / not configured" without making a model call.
brainRouter.get("/status", (_req, res) => {
  const key = brainKey();
  res.json({ configured: !!key, model: key ? MODEL : null });
});
