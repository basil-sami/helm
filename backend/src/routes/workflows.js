import { Router } from "express";
import { crudRouter } from "../crud.js";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { EVENTS, ACTIONS, runWorkflow, recomputeAllScores, renderWaTemplate } from "../automate-engine.js";

// ── AUTOMATE (Wave 1·E) — workflows, scoring, WA templates ───────────

const jsonFix = (...keys) => (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};
const parseJ = (v, fb) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? fb); } catch { return fb; } };

// ── Workflows ────────────────────────────────────────────────────────
const BRANCH_OPS = ["eq", "neq", "gte", "lte", "contains", "notnull"];

/**
 * Walk the flow at save time. A flow that cannot work should be refused
 * here, in front of a person who can fix it — not at 3am in front of nobody.
 */
function validateNodes(nodes, depth) {
  if (depth > 5) return "branches are nested too deeply (max 5)";
  for (const a of nodes) {
    if (a?.type === "IF") {
      const c = a.cond || {};
      if (!c.field) return "a branch is missing the field it tests";
      if (!BRANCH_OPS.includes(c.op)) return `branch comparison must be one of: ${BRANCH_OPS.join(", ")}`;
      if (c.op !== "notnull" && (c.value === undefined || c.value === null || c.value === "")) {
        return "a branch is missing the value it compares against";
      }
      const t = Array.isArray(a.then) ? a.then : [];
      const e = Array.isArray(a.else) ? a.else : [];
      if (!t.length && !e.length) return "a branch does nothing on either side — remove it or fill a side";
      const inner = validateNodes(t, depth + 1) || validateNodes(e, depth + 1);
      if (inner) return inner;
      continue;
    }
    if (!a?.type || !ACTIONS[a.type]) {
      return `unknown action type: ${a?.type} (library: ${Object.keys(ACTIONS).join(", ")})`;
    }
  }
  return null;
}

function validateWorkflow(data) {
  if (data.trigger !== undefined) {
    const t = parseJ(data.trigger, null);
    if (!t || !EVENTS.includes(t.event)) return `trigger.event must be one of: ${EVENTS.join(", ")}`;
    if (t.filters && typeof t.filters !== "object") return "trigger.filters must be an object";
  }
  if (data.actions !== undefined) {
    const acts = parseJ(data.actions, null);
    if (!Array.isArray(acts) || acts.length === 0) return "actions must be a non-empty array";
    const bad = validateNodes(acts, 0);
    if (bad) return bad;
  }
  return jsonFix("trigger", "actions")(data);
}

export const workflowsExtraRouter = Router();
workflowsExtraRouter.use(requireAuth);

// The action library + event list, for the builder UI.
workflowsExtraRouter.get("/library", requirePerm("automate", "read"), (_req, res) => {
  // The palette is generated from the registry, so a new action appears in
  // the builder the moment it exists in the engine.
  res.json({
    events: EVENTS,
    actions: Object.keys(ACTIONS),
    branchOps: BRANCH_OPS,
    branchFields: ["source", "businessUnit", "stage", "valueUsd", "company", "email", "phone", "score", "campaignId", "productId"],
  });
});

/**
 * Dry run: replay a flow against a real recent lead and report what it
 * *would* do — including which branch it would take — without doing it.
 * This is what makes the builder trustworthy to someone non-technical.
 */
workflowsExtraRouter.post("/dry-run", requirePerm("automate"), async (req, res, next) => {
  try {
    const { actions, leadId } = req.body || {};
    const acts = parseJ(actions, null);
    if (!Array.isArray(acts) || !acts.length) return res.status(400).json({ error: "actions must be a non-empty array" });
    const bad = validateNodes(acts, 0);
    if (bad) return res.status(400).json({ error: bad });

    const lead = leadId
      ? await get(`SELECT * FROM leads WHERE id = $1`, [leadId])
      : await get(`SELECT * FROM leads ORDER BY "createdAt" DESC LIMIT 1`);
    if (!lead) return res.status(400).json({ error: "No lead available to test against" });

    const { dryRunWorkflow } = await import("../automate-engine.js");
    const out = await dryRunWorkflow(acts, { event: "dry-run", payload: lead, lead, leadId: lead.id });
    res.json({ ...out, lead: { id: lead.id, company: lead.company, stage: lead.stage, source: lead.source } });
  } catch (e) { next(e); }
});

// Recent runs — the audit trail of automation.
workflowsExtraRouter.get("/runs", requirePerm("automate", "read"), async (req, res, next) => {
  try {
    const wf = req.query.workflowId;
    res.json(await all(
      `SELECT r.*, w.name AS "workflowName", w."nameAr" AS "workflowNameAr"
       FROM workflow_runs r JOIN workflows w ON w.id = r."workflowId"
       ${wf ? `WHERE r."workflowId" = $1` : ""}
       ORDER BY r."createdAt" DESC LIMIT 50`, wf ? [wf] : []));
  } catch (e) { next(e); }
});

// Dry-fire a workflow against a sample payload (writes a real run row —
// automation you can rehearse is automation you can trust).
workflowsExtraRouter.post("/:id/test", requirePerm("automate"), async (req, res, next) => {
  try {
    const wf = await get(`SELECT * FROM workflows WHERE id = $1`, [req.params.id]);
    if (!wf) return res.status(404).json({ error: "Not found" });
    const payload = req.body?.payload || {};
    const out = await runWorkflow(wf, { event: "test", payload, leadId: payload.leadId || null });
    logAudit(req, "workflows.test", "workflows", wf.id, { ok: out.ok });
    res.json(out);
  } catch (e) { next(e); }
});

export const workflowsRouter = crudRouter({
  table: "workflows",
  module: "automate",
  fields: ["name", "nameAr", "trigger", "actions", "active"],
  touchUpdatedAt: true,
  orderBy: `"createdAt" DESC`,
  listSql: `SELECT w.*, (SELECT COUNT(*)::int FROM workflow_runs r WHERE r."workflowId" = w.id) AS "runCount"
            FROM workflows w ORDER BY w."createdAt" DESC`,
  validateCreate: (d) => (!d.name ? "name is required" : validateWorkflow(d)),
  validateUpdate: validateWorkflow,
});

// ── Lead score rules ─────────────────────────────────────────────────
const SCORE_OPS = ["eq", "neq", "gte", "lte", "contains", "notnull"];
const SCORE_FIELDS = ["source", "businessUnit", "stage", "valueUsd", "email", "phone", "company", "campaignId", "productId"];

function validateRule(data) {
  if (data.condition !== undefined) {
    const c = parseJ(data.condition, null);
    if (!c || !SCORE_FIELDS.includes(c.field)) return `condition.field must be one of: ${SCORE_FIELDS.join(", ")}`;
    if (!SCORE_OPS.includes(c.op)) return `condition.op must be one of: ${SCORE_OPS.join(", ")}`;
    if (c.op !== "notnull" && (c.value === undefined || c.value === null)) return "condition.value is required";
  }
  if (data.points !== undefined && Number.isNaN(Number(data.points))) return "points must be a number";
  return jsonFix("condition")(data);
}

export const scoreRulesExtraRouter = Router();
scoreRulesExtraRouter.use(requireAuth);
scoreRulesExtraRouter.post("/recompute", requirePerm("automate"), async (req, res, next) => {
  try {
    const changed = await recomputeAllScores();
    logAudit(req, "scoring.recompute", "lead_score_rules", null, { changed });
    res.json({ changed });
  } catch (e) { next(e); }
});

export const scoreRulesRouter = crudRouter({
  table: "lead_score_rules",
  module: "automate",
  fields: ["label", "labelAr", "condition", "points", "active"],
  orderBy: `points DESC, "createdAt" ASC`,
  validateCreate: (d) => (!d.label ? "label is required" : validateRule(d)),
  validateUpdate: validateRule,
  afterWrite: async () => { await recomputeAllScores(); }, // rules changed → cache follows
});

// ── WhatsApp templates ───────────────────────────────────────────────
export const waTemplatesExtraRouter = Router();
waTemplatesExtraRouter.use(requireAuth);
waTemplatesExtraRouter.post("/:id/render", requirePerm("automate"), async (req, res, next) => {
  try {
    const out = await renderWaTemplate(req.params.id, req.body?.leadId || null, req.body?.vars || {}, req.user.name);
    logAudit(req, "wa.render", "wa_templates", req.params.id, { leadId: req.body?.leadId || null });
    res.json(out);
  } catch (e) {
    if (/Unknown/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

export const waTemplatesRouter = crudRouter({
  table: "wa_templates",
  module: "automate",
  fields: ["name", "nameAr", "body", "bodyAr", "variables", "category"],
  touchUpdatedAt: true,
  orderBy: `uses DESC, "createdAt" DESC`,
  validateCreate: (d) => (!d.name ? "name is required" : jsonFix("variables")(d)),
  validateUpdate: jsonFix("variables"),
});
