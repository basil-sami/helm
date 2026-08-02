import { all, get, run } from "./db.js";
import { notify } from "./notify.js";

// ═══ THE AUTOMATION ENGINE (Wave 1·E) ════════════════════════════════
// Event bus + curated action library. Events fire from the code paths
// that matter (lead created, stage changed, form submitted); a workflow
// is { trigger: { event, filters }, actions: [{ type, ...params }] }.
// Every execution writes a workflow_runs row — automation you can audit.

const parseJ = (v, fb) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? fb); } catch { return fb; } };

export const EVENTS = ["lead.created", "lead.stage_changed", "form.submitted"];

// ── The curated action library ───────────────────────────────────────
// Each action: async ({ params, ctx }) => detail-string. ctx carries
// { event, payload, leadId? } — most actions act on the lead at hand.
const needLead = (ctx) => {
  if (!ctx.leadId) throw new Error("action needs a lead in context");
  return ctx.leadId;
};

async function admins() {
  return (await all(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
     WHERE u.active AND (r.permissions->>'admin')::boolean IS TRUE`)).map((u) => u.id);
}

export const ACTIONS = {
  // Route the lead to a person.
  ASSIGN_OWNER: async ({ params, ctx }) => {
    const leadId = needLead(ctx);
    const user = await get(`SELECT id, name FROM users WHERE id = $1 AND active`, [params.userId]);
    if (!user) throw new Error("ASSIGN_OWNER: unknown or inactive user");
    await run(`UPDATE leads SET "ownerId" = $2, "updatedAt" = now() WHERE id = $1`, [leadId, user.id]);
    await notify([user.id], "LEAD_ASSIGNED", { company: ctx.payload.company || null }, "/leads");
    return `owner → ${user.name}`;
  },

  // Append a tag (deduped) to the lead's tags jsonb.
  ADD_TAG: async ({ params, ctx }) => {
    const leadId = needLead(ctx);
    if (!params.tag) throw new Error("ADD_TAG: tag is required");
    await run(
      `UPDATE leads SET tags = CASE WHEN tags ? $2 THEN tags ELSE tags || to_jsonb($2::text) END,
       "updatedAt" = now() WHERE id = $1`, [leadId, String(params.tag)]);
    return `tag +${params.tag}`;
  },

  // One task, optionally dated and assigned.
  CREATE_TASK: async ({ params, ctx }) => {
    if (!params.title) throw new Error("CREATE_TASK: title is required");
    const due = params.dueInDays != null ? `now() + interval '${Number(params.dueInDays) || 0} days'` : "null";
    const t = await get(
      `INSERT INTO tasks (title, status, priority, "dueDate", "assigneeId", "leadId")
       VALUES ($1, 'TODO', $2, ${due}, $3, $4) RETURNING id`,
      [params.title, ["LOW", "MEDIUM", "HIGH"].includes(params.priority) ? params.priority : "MEDIUM",
       params.assigneeId || null, ctx.leadId || null]);
    if (params.assigneeId) await notify([params.assigneeId], "TASK_ASSIGNED", { title: params.title }, "/tasks");
    return `task ${t.id}`;
  },

  // Instantiate a whole process template against the lead.
  START_PROCESS: async ({ params, ctx }) => {
    const tpl = await get(`SELECT * FROM process_templates WHERE key = $1`, [params.templateKey]);
    if (!tpl) throw new Error(`START_PROCESS: unknown template ${params.templateKey}`);
    const tasks = parseJ(tpl.tasks, []);
    let n = 0;
    for (const t of tasks) {
      await run(
        `INSERT INTO tasks (title, status, priority, "dueDate", "assigneeId", "leadId")
         VALUES ($1, 'TODO', $2, now() + ($3 || ' days')::interval, $4, $5)`,
        [t.t?.ar || t.t?.en || "مهمة", ["LOW", "MEDIUM", "HIGH"].includes(t.priority) ? t.priority : "MEDIUM",
         String(Number(t.offset) || 0), params.assigneeId || null, ctx.leadId || null]);
      n++;
    }
    return `process ${params.templateKey} → ${n} tasks`;
  },

  // Ping people.
  NOTIFY: async ({ params, ctx }) => {
    const aud = Array.isArray(params.userIds) && params.userIds.length ? params.userIds : await admins();
    await notify(aud, "WORKFLOW", { message: params.message || null, company: ctx.payload.company || null }, "/leads");
    return `notified ${aud.length}`;
  },

  // Draft a WhatsApp send from the template library, logged on the lead.
  SEND_WA_DRAFT: async ({ params, ctx }) => {
    const leadId = needLead(ctx);
    const out = await renderWaTemplate(params.templateId, leadId, params.vars || {});
    return `WA draft (${out.templateName})`;
  },
};

// ── WhatsApp templates: render + log ─────────────────────────────────
const merge = (text, vars) =>
  (text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? `{{${k}}}`));

/** Render a template against a lead (+extra vars), log the send, bump uses. */
export async function renderWaTemplate(templateId, leadId, extraVars = {}, actorName = "Pulse") {
  const tpl = await get(`SELECT * FROM wa_templates WHERE id = $1`, [templateId]);
  if (!tpl) throw new Error("Unknown WA template");
  let lead = null;
  if (leadId) {
    lead = await get(`SELECT * FROM leads WHERE id = $1`, [leadId]);
    if (!lead) throw new Error("Unknown lead");
  }
  const vars = {
    company: lead?.company || "", contactName: lead?.contactName || "",
    phone: lead?.phone || "", source: lead?.source || "", ...extraVars,
  };
  const text = merge(tpl.body, vars);
  const textAr = merge(tpl.bodyAr, vars);
  const digits = (lead?.phone || "").replace(/[^\d]/g, "");
  const waUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(textAr || text)}` : null;
  await run(`UPDATE wa_templates SET uses = uses + 1, "updatedAt" = now() WHERE id = $1`, [tpl.id]);
  if (lead) {
    await run(
      `INSERT INTO lead_activities ("leadId", "actorName", kind, body, meta) VALUES ($1,$2,'WA',$3,$4)`,
      [lead.id, actorName, (textAr || text).slice(0, 500),
       JSON.stringify({ templateId: tpl.id, templateName: tpl.name })]);
  }
  return { text, textAr, waUrl, templateName: tpl.name };
}

// ── The event bus ────────────────────────────────────────────────────
const matches = (filters, payload) =>
  Object.entries(filters || {}).every(([k, v]) => String(payload[k] ?? "") === String(v));

/** Fire an event through every active matching workflow. Never throws. */
export async function fireEvent(event, payload = {}, ctxExtra = {}) {
  try {
    const { getModules, moduleEnabled } = await import("./flags.js");
    if (!moduleEnabled(await getModules(), "automate")) return 0;
    const rows = await all(`SELECT * FROM workflows WHERE active = true`);
    let fired = 0;
    for (const wf of rows) {
      const trig = parseJ(wf.trigger, {});
      if (trig.event !== event || !matches(trig.filters, payload)) continue;
      await runWorkflow(wf, { event, payload, ...ctxExtra });
      fired++;
    }
    return fired;
  } catch (e) {
    console.error("fireEvent failed", e.message);
    return 0;
  }
}

/** Execute one workflow's actions; one failing action never stops the rest. */
// The same comparison vocabulary the scoring rules use — a workflow branch
// and a scoring rule should never mean different things by "gte".
export const OPS = {
  eq: (a, b) => String(a ?? "") === String(b),
  neq: (a, b) => String(a ?? "") !== String(b),
  gte: (a, b) => Number(a) >= Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  contains: (a, b) => String(a ?? "").toLowerCase().includes(String(b).toLowerCase()),
  notnull: (a) => a !== null && a !== undefined && String(a).trim() !== "",
};

/** Read a field off the event context — payload first, then the lead row. */
export function fieldValue(field, ctx) {
  if (!field) return undefined;
  const p = ctx.payload || {};
  if (field in p) return p[field];
  if (ctx.lead && field in ctx.lead) return ctx.lead[field];
  return undefined;
}

export function evalCond(cond = {}, ctx) {
  const fn = OPS[cond.op];
  if (!fn) return false;
  return !!fn(fieldValue(cond.field, ctx), cond.value);
}

/**
 * Walk one branch of a flow.
 *
 * `actions` stays exactly the flat jsonb array it has always been — an IF is
 * just another node in it, holding two nested lists. Every workflow written
 * before the builder existed is still a valid, unchanged flow.
 */
async function walk(nodes, ctx, log, dryRun = false, depth = 0) {
  let ok = true;
  if (depth > 10) {                                  // nested IFs cannot run away
    log.push({ action: "IF", ok: false, detail: "nesting too deep" });
    return false;
  }
  for (const a of nodes || []) {
    if (a?.type === "IF") {
      const took = evalCond(a.cond, ctx);
      // record the branch, so the audit answers *why this lead got no task*
      log.push({ action: "IF", ok: true, branch: took ? "then" : "else",
                 detail: `${a.cond?.field || "?"} ${a.cond?.op || "?"} ${a.cond?.value ?? ""} → ${took ? "then" : "else"}` });
      const inner = await walk(took ? a.then : a.else, ctx, log, dryRun, depth + 1);
      if (!inner) ok = false;
      continue;
    }
    try {
      const fn = ACTIONS[a.type];
      if (!fn) throw new Error(`unknown action ${a.type}`);
      if (dryRun) {
        log.push({ action: a.type, ok: true, dryRun: true, detail: describeAction(a) });
      } else {
        log.push({ action: a.type, ok: true, detail: await fn({ params: a, ctx }) });
      }
    } catch (e) {
      ok = false;
      log.push({ action: a.type, ok: false, detail: e.message });
    }
  }
  return ok;
}

/** What an action *would* do, for the dry run — no writes. */
function describeAction(a) {
  switch (a.type) {
    case "ASSIGN_OWNER": return `would assign owner ${a.userId || "?"}`;
    case "ADD_TAG": return `would add tag "${a.tag || "?"}"`;
    case "CREATE_TASK": return `would create task "${a.title || "?"}"`;
    case "START_PROCESS": return `would start process ${a.processId || "?"}`;
    case "NOTIFY": return `would notify ${a.userId || "owner"}`;
    default: return `would run ${a.type}`;
  }
}

/**
 * Replay a flow against a real record without touching anything. This is
 * what lets someone press "try it" before trusting it at 3am.
 */
export async function dryRunWorkflow(actions, ctx) {
  const log = [];
  const ok = await walk(parseJ(actions, []), ctx, log, true);
  return { ok, log };
}

export async function runWorkflow(wf, ctx) {
  const log = [];
  const ok = await walk(parseJ(wf.actions, []), ctx, log, false);
  await run(
    `INSERT INTO workflow_runs ("workflowId", entity, "entityId", status, log) VALUES ($1,$2,$3,$4,$5)`,
    [wf.id, ctx.entity || (ctx.leadId ? "leads" : null), ctx.leadId || ctx.entityId || null,
     ok ? "DONE" : "ERROR", JSON.stringify(log)]);
  await run(`UPDATE workflows SET "lastRunAt" = now() WHERE id = $1`, [wf.id]);
  return { ok, log };
}

// ── Lead scoring ─────────────────────────────────────────────────────

export const HOT_SCORE = 70;

function scoreLead(lead, rules) {
  let score = 0;
  for (const r of rules) {
    const c = parseJ(r.condition, {});
    const fn = OPS[c.op];
    if (!fn) continue;
    if (fn(lead[c.field], c.value)) score += Number(r.points) || 0;
  }
  return score;
}

/** Recompute one lead's cached score. Returns the new score. */
export async function recomputeLeadScore(leadId) {
  const lead = await get(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  if (!lead) return 0;
  const rules = await all(`SELECT * FROM lead_score_rules WHERE active = true`);
  const score = scoreLead(lead, rules);
  if (score !== Number(lead.score)) await run(`UPDATE leads SET score = $2 WHERE id = $1`, [leadId, score]);
  return score;
}

/** Full rescore (rule changes + the nightly Daily Pulse). Returns changed count. */
export async function recomputeAllScores() {
  const rules = await all(`SELECT * FROM lead_score_rules WHERE active = true`);
  const leads = await all(`SELECT * FROM leads`);
  let changed = 0;
  for (const l of leads) {
    const score = scoreLead(l, rules);
    if (score !== Number(l.score)) {
      await run(`UPDATE leads SET score = $2 WHERE id = $1`, [l.id, score]);
      changed++;
    }
  }
  return changed;
}

/** Daily Pulse step: hot open leads gone quiet → ping the owner. */
export async function hotLeadSweep() {
  const { getModules, moduleEnabled } = await import("./flags.js");
  if (!moduleEnabled(await getModules(), "automate")) return 0;
  const hot = await all(
    `SELECT l.id, l.company, l."ownerId", l.score FROM leads l
     WHERE l.score >= $1 AND l.stage NOT IN ('WON','LOST')
     AND NOT EXISTS (SELECT 1 FROM lead_activities a WHERE a."leadId" = l.id
                     AND a."createdAt" >= now() - interval '3 days')`, [HOT_SCORE]);
  if (!hot.length) return 0;
  const adm = await admins();
  let pushed = 0;
  for (const l of hot) {
    const dup = await get(
      `SELECT 1 FROM notifications WHERE type = 'HOT_LEAD' AND meta->>'leadId' = $1
       AND "createdAt" >= now() - interval '20 hours' LIMIT 1`, [String(l.id)]);
    if (dup) continue;
    await notify(l.ownerId ? [l.ownerId] : adm, "HOT_LEAD",
      { leadId: l.id, company: l.company, score: Number(l.score) }, "/leads");
    pushed++;
  }
  return pushed;
}
