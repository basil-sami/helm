import crypto from "crypto";
import { all, get, run } from "./db.js";

// ═══ THE AI RAIL (Wave 3·C) ══════════════════════════════════════════
// One contract, exactly like mail and storage. The four laws from the
// Wave 3 brief are enforced here, in code, rather than trusted to whoever
// writes the next prompt:
//
//   1. AI drafts; humans dispose.   → callers write DRAFT rows only
//   2. Grounded or silent.          → groundedComplete() below
//   3. Bounded cost.                → the ceiling is checked before spending
//   4. Never the guardrailed things → refuseIfGuardrailed()

const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// Approximate per-million-token prices, used only to keep a running
// estimate against the ceiling. Configurable per instance.
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6;

export async function getAiCfg() {
  const s = await get(`SELECT integrations FROM settings WHERE id = 1`);
  const ints = typeof s?.integrations === "string" ? JSON.parse(s.integrations || "{}") : (s?.integrations || {});
  const cfg = ints.ai || {};
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || cfg.apiKey || null,
    apiUrl: cfg.apiUrl || API,
    model: cfg.model || MODEL,
    monthlyCapUsd: Number(cfg.monthlyCapUsd ?? 20),
    enabled: cfg.enabled !== false,
  };
}

export const cacheKeyFor = (feature, payload) =>
  `${feature}:${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32)}`;

/** Spend so far this calendar month. */
export async function spendThisMonth() {
  const r = await get(
    `SELECT COALESCE(SUM("costUsd"),0)::float8 v FROM ai_runs
     WHERE at >= date_trunc('month', now())`);
  return Number(r?.v || 0);
}

async function logRun(row) {
  await run(
    `INSERT INTO ai_runs (feature, model, status, "promptTokens", "completionTokens",
       "costUsd", "latencyMs", "cacheKey", detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [row.feature, row.model || null, row.status, row.promptTokens || 0, row.completionTokens || 0,
     row.costUsd || 0, row.latencyMs || null, row.cacheKey || null,
     row.detail ? String(row.detail).slice(0, 500) : null]).catch(() => {});
}

// ── LAW 4 · things the model is never pointed at ─────────────────────
// Not a filter on output — a refusal to construct the request at all.
const GUARDRAILED = [
  { test: (f) => /private|individual|person_profile/i.test(f),
    why: "Pulse does not profile private individuals" },
  { test: (f) => /wa_send|whatsapp_send/i.test(f),
    why: "WhatsApp messages are never drafted and sent by a model" },
  { test: (f) => /review_ruling|adjudicate_queue/i.test(f),
    why: "Analyst rulings are the ground truth that tunes the system; a model may recommend but never rule" },
];

export function refuseIfGuardrailed(feature) {
  const hit = GUARDRAILED.find((g) => g.test(String(feature)));
  return hit ? hit.why : null;
}

/**
 * One completion. Never throws — a failed or unaffordable call degrades to
 * `{ ok: false }` and the caller carries on without the feature.
 */
export async function complete({ feature, system, prompt, maxTokens = 1000, cacheKey = null, tools = null }) {
  const guard = refuseIfGuardrailed(feature);
  if (guard) {
    await logRun({ feature, status: "SKIPPED", detail: `guardrail: ${guard}` });
    return { ok: false, refused: true, error: guard };
  }

  const cfg = await getAiCfg();
  if (!cfg.enabled || !cfg.apiKey) {
    await logRun({ feature, status: "SKIPPED", detail: "AI is not configured" });
    return { ok: false, error: "AI is not configured on this instance" };
  }

  if (cacheKey) {
    const hit = await get(`SELECT response FROM ai_cache WHERE "cacheKey" = $1`, [cacheKey]).catch(() => null);
    if (hit) {
      await logRun({ feature, model: cfg.model, status: "CACHED", cacheKey });
      return { ok: true, text: hit.response, cached: true };
    }
  }

  // LAW 3 — the ceiling is checked before spending, not after
  const spent = await spendThisMonth();
  if (cfg.monthlyCapUsd > 0 && spent >= cfg.monthlyCapUsd) {
    await logRun({ feature, status: "SKIPPED", detail: `monthly cap reached ($${spent.toFixed(2)}/$${cfg.monthlyCapUsd})` });
    return { ok: false, capped: true, error: `AI budget for this month is spent ($${cfg.monthlyCapUsd})` };
  }

  const started = Date.now();
  try {
    const res = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        ...(tools ? { tools } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 200)}`);
    const data = JSON.parse(body);
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    const pIn = data.usage?.input_tokens || 0, pOut = data.usage?.output_tokens || 0;
    const costUsd = pIn * PRICE_IN + pOut * PRICE_OUT;

    if (cacheKey && text) {
      await run(`INSERT INTO ai_cache ("cacheKey", feature, response) VALUES ($1,$2,$3)
                 ON CONFLICT ("cacheKey") DO NOTHING`, [cacheKey, feature, text]).catch(() => {});
    }
    await logRun({ feature, model: cfg.model, status: "OK", promptTokens: pIn, completionTokens: pOut,
                   costUsd, latencyMs: Date.now() - started, cacheKey });
    return { ok: true, text, tokens: { in: pIn, out: pOut }, costUsd };
  } catch (e) {
    await logRun({ feature, model: cfg.model, status: "FAILED",
                   latencyMs: Date.now() - started, detail: e.message });
    return { ok: false, error: String(e.message).slice(0, 200) };
  }
}

/**
 * LAW 2 · grounded or silent.
 *
 * The model is handed a numbered evidence list and must cite from it. A
 * response citing nothing, or citing something it was never given, is
 * treated as an abstention — not as an answer. An AI that invents a
 * plausible reason for a metric move is worse than no explanation,
 * because it will be believed.
 */
export async function groundedComplete({ feature, system, question, evidence = [], maxTokens = 1200, cacheKey = null }) {
  if (!evidence.length) {
    await logRun({ feature, status: "ABSTAINED", detail: "no evidence to reason over" });
    return { ok: false, abstained: true, reason: "not enough evidence" };
  }

  const numbered = evidence.map((e, i) => `[${i + 1}] ${e.text}`).join("\n");
  const grounded = [
    system || "",
    "",
    "You are given numbered evidence. Rules you must follow:",
    "- Use ONLY the evidence below. Do not add facts from outside it.",
    "- Cite the evidence for every claim, as [1], [2], and so on.",
    '- If the evidence does not support an answer, reply exactly: NOT_ENOUGH_EVIDENCE',
    "- Reply in the same language as the question.",
  ].join("\n");

  const r = await complete({
    feature, system: grounded, maxTokens, cacheKey,
    prompt: `Evidence:\n${numbered}\n\nQuestion: ${question}`,
  });
  if (!r.ok) return r;

  const text = String(r.text || "");
  if (/NOT_ENOUGH_EVIDENCE/i.test(text) || !text.trim()) {
    await logRun({ feature, status: "ABSTAINED", detail: "model reported insufficient evidence" });
    return { ok: false, abstained: true, reason: "not enough evidence", cached: r.cached };
  }

  // a claim must point at evidence that was actually supplied
  const cited = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const valid = cited.filter((n) => n >= 1 && n <= evidence.length);
  if (!valid.length) {
    await logRun({ feature, status: "ABSTAINED", detail: "answer cited no supplied evidence — discarded" });
    return { ok: false, abstained: true, reason: "answer was not grounded in the evidence" };
  }
  if (cited.some((n) => n < 1 || n > evidence.length)) {
    await logRun({ feature, status: "ABSTAINED", detail: "answer cited evidence that does not exist — discarded" });
    return { ok: false, abstained: true, reason: "answer cited evidence that was never supplied" };
  }

  return {
    ok: true, text, cached: r.cached,
    citations: [...new Set(valid)].map((n) => evidence[n - 1]),
  };
}

/** What the admin needs to see: usage, cost, and how close to the ceiling. */
export async function aiStatus() {
  const cfg = await getAiCfg();
  const spent = await spendThisMonth();
  const recent = await all(
    `SELECT feature, status, model, "promptTokens", "completionTokens", "costUsd", "latencyMs", detail, at
     FROM ai_runs ORDER BY at DESC LIMIT 20`).catch(() => []);
  const byStatus = await all(
    `SELECT status, COUNT(*)::int c FROM ai_runs WHERE at >= now() - interval '30 days' GROUP BY status`)
    .catch(() => []);
  return {
    configured: !!cfg.apiKey && cfg.enabled,
    model: cfg.model,
    monthlyCapUsd: cfg.monthlyCapUsd,
    spentThisMonth: Number(spent.toFixed(4)),
    pctOfCap: cfg.monthlyCapUsd > 0 ? Math.round((spent / cfg.monthlyCapUsd) * 100) : 0,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.c])),
    recent,
  };
}
