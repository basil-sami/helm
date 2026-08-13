import { Router } from "express";
import { all, get, run, transaction } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { warRoom, retroFacts, closeCampaign, CAMPAIGN_FLOW, CAMPAIGN_LINKS, transitionError } from "../campaign.js";

// ═══ W4·A · THE WAR ROOM ══════════════════════════════════════════════
// The screen the practitioner audit found missing: one place where a
// campaign's pieces, money, approvals and results sit together.

const r = Router();
r.use(requireAuth);
// Permission guards use the shared middleware rather than hand-rolled
// checks — one authorization idiom in the codebase, not two.
const readOnly = requirePerm("campaigns", "read");
const writeOnly = requirePerm("campaigns", "write");

// Department scoping mirrors crudRouter: a scoped user sees their own
// department's campaigns plus unassigned ones.
const scopeOf = (req) => (req.user?.isAdmin ? null : req.user?.departmentId || null);
const visible = (req, row) => {
  const scope = scopeOf(req);
  if (!scope || !row) return true;
  return row.departmentId === null || row.departmentId === undefined || row.departmentId === scope;
};

/** The registry itself — the UI builds its attach menu from this. */
r.get("/links", readOnly, (req, res) => {
  res.json(CAMPAIGN_LINKS.map(({ table, module, label, labelAr }) => ({ table, module, label, labelAr })));
});

/** GET /api/campaigns/:id/room — everything about one campaign. */
r.get("/:id/room", readOnly, async (req, res) => {
  const room = await warRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Campaign not found" });
  if (!visible(req, room.campaign)) return res.status(404).json({ error: "Campaign not found" });
  res.json(room);
});

/** POST /api/campaigns/:id/transition — the matrix, enforced in one door. */
r.post("/:id/transition", writeOnly, async (req, res, next) => {
  const { to, learnings } = req.body || {};
  const prev = await get(`SELECT * FROM campaigns WHERE id = $1`, [req.params.id]);
  if (!prev) return res.status(404).json({ error: "Campaign not found" });
  if (!visible(req, prev)) return res.status(404).json({ error: "Campaign not found" });

  const err = transitionError(prev.status, to);
  if (err) return res.status(400).json({ error: err });

  // The gate that predates this wave and survives it: no activation
  // without a brief. Kept because it was the right rule.
  if (to === "ACTIVE" && prev.status !== "ACTIVE") {
    const brief = await get(`SELECT 1 FROM campaign_briefs WHERE "campaignId" = $1`, [prev.id]);
    if (!brief) return res.status(400).json({ error: "A campaign brief is required before activation (open the campaign → Brief)" });
  }

  let retro = null;
  if (to === "COMPLETED") {
    try {
      await transaction(async (tx) => {
        const changed = await tx.run(`UPDATE campaigns SET status = $2, "updatedAt" = now() WHERE id = $1 AND status = $3`, [prev.id, to, prev.status]);
        if (!changed.rowCount) throw new Error("Campaign status changed before this transition completed");
        await closeCampaign(prev.id, learnings, tx);
      });
    } catch (e) { return next(e); }
    retro = await retroFacts(prev.id);
  } else {
    const changed = await run(`UPDATE campaigns SET status = $2, "updatedAt" = now() WHERE id = $1 AND status = $3`, [prev.id, to, prev.status]);
    if (!changed.rowCount) return res.status(409).json({ error: "Campaign status changed before this transition completed" });
  }
  logAudit(req, "campaigns.transition", "campaigns", prev.id, { from: prev.status, to });
  res.json({ ok: true, from: prev.status, to, allowedNext: CAMPAIGN_FLOW[to] || [], retro });
});

/** GET /api/campaigns/:id/retro — the facts a retro is built from. */
r.get("/:id/retro", readOnly, async (req, res) => {
  const facts = await retroFacts(req.params.id);
  if (!facts) return res.status(404).json({ error: "Campaign not found" });
  res.json(facts);
});

/**
 * POST /api/campaigns/:id/retro/draft — the system drafts, humans dispose.
 * Rides the AI rail under its own laws: grounded in this campaign's rows
 * or it declines. With AI switched off, the endpoint still returns the
 * facts, so the ritual works without the model.
 */
r.post("/:id/retro/draft", writeOnly, async (req, res) => {
  const facts = await retroFacts(req.params.id);
  if (!facts) return res.status(404).json({ error: "Campaign not found" });

  const thin = facts.results.leads === 0 && facts.spend.spentUsd === 0 && !facts.shipped.length;
  if (thin) {
    return res.json({ ok: true, grounded: false, facts,
      draft: null, reason: "Not enough evidence: this campaign has no attached work, no spend and no attributed leads." });
  }
  try {
    const { groundedComplete } = await import("../ai.js");
    // Evidence is the campaign's own rows, one numbered fact per line.
    const ev = [];
    ev.push({ text: `Campaign "${facts.name}" ran ${facts.window.from || "?"} → ${facts.window.to || "?"}.` });
    if (facts.objective) ev.push({ text: `Stated objective: ${facts.objective}` });
    if (facts.kpiTarget?.metric) ev.push({ text: `KPI target: ${facts.kpiTarget.metric} = ${facts.kpiTarget.target}` });
    for (const s of facts.shipped) ev.push({ text: `Shipped ${s.count} item(s) in ${s.territory}.` });
    ev.push({ text: `Budget $${facts.spend.budgetUsd}; spent $${facts.spend.spentUsd} (pace ${facts.spend.pacePct ?? "n/a"}%).` });
    ev.push({ text: `Attributed leads: ${facts.results.leads}; won ${facts.results.won} worth $${facts.results.wonValueUsd}; lost ${facts.results.lost}.` });
    for (const l of facts.results.lostReasons || []) ev.push({ text: `Lost for reason "${l.d}": ${l.v} lead(s).` });
    if (facts.kpis.cplUsd !== null) ev.push({ text: `Cost per lead: $${facts.kpis.cplUsd}.` });
    if (facts.kpis.roiPct !== null) ev.push({ text: `Return on spend: ${facts.kpis.roiPct}%.` });

    const out = await groundedComplete({
      feature: "campaign_retro",
      system: "You are a marketing analyst writing a campaign retrospective for the marketing team. Two short paragraphs, then three bullet lessons. Plain professional language.",
      question: `Write the retrospective for the campaign "${facts.name}".`,
      evidence: ev,
    });
    if (!out?.ok) {
      return res.json({ ok: true, grounded: false, facts, draft: null,
        reason: out?.abstained ? "not enough evidence" : (out?.reason || "AI is not configured on this instance.") });
    }
    logAudit(req, "campaigns.retroDraft", "campaigns", req.params.id, {});
    return res.json({ ok: true, grounded: true, facts, draft: out.text });
  } catch (e) {
    return res.json({ ok: true, grounded: false, facts, draft: null, reason: e.message });
  }
});

/** PATCH /api/campaigns/:id/retro — the human's version is the one that is kept. */
r.patch("/:id/retro", writeOnly, async (req, res) => {
  const { retro, retroAr } = req.body || {};
  const prev = await get(`SELECT id FROM campaigns WHERE id = $1`, [req.params.id]);
  if (!prev) return res.status(404).json({ error: "Campaign not found" });
  await run(`UPDATE campaigns SET retro = COALESCE($2, retro), "retroAr" = COALESCE($3, "retroAr"), "updatedAt" = now() WHERE id = $1`,
    [req.params.id, retro ?? null, retroAr ?? null]);
  logAudit(req, "campaigns.retroSave", "campaigns", req.params.id, {});
  res.json({ ok: true });
});

/** Lightweight picker for attach menus across the product. */
r.get("/picker", readOnly, async (req, res) => {
  const rows = await all(
    `SELECT id, name, "nameAr", status, "startDate", "endDate", "departmentId" FROM campaigns
      WHERE status IN ('PLANNING','ACTIVE','PAUSED') ORDER BY "createdAt" DESC LIMIT 100`);
  res.json(rows.filter((row) => visible(req, row)));
});

export default r;
