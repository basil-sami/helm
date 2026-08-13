import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { notify } from "../notify.js";
import { logActivity } from "../leadlog.js";

// ═══ W4·C · VALUE & THE LEAD LOOP ═════════════════════════════════════
// Two halves of the same problem: the funnel had no money on the far end
// and no clock on the near one.

const usdRate = async () => Number((await get(`SELECT "usdToSdgRate" v FROM settings WHERE id = 1`).catch(() => null))?.v || 0);

/** Normalise any currency to USD so metrics never mix units. */
export async function toUsd(amount, currency) {
  const n = Number(amount) || 0;
  if (!currency || currency.toUpperCase() === "USD") return n;
  const rate = await usdRate();
  return rate > 0 ? Math.round((n / rate) * 100) / 100 : n;
}

export const conversionsRouter = Router();
conversionsRouter.use(requireAuth);
const cRead = requirePerm("leads", "read");
const cWrite = requirePerm("leads", "write");

conversionsRouter.get("/", cRead, async (req, res, next) => {
  try {
    const { campaignId, from, to } = req.query;
    const where = [], params = [];
    if (campaignId) { params.push(campaignId); where.push(`c."campaignId" = $${params.length}`); }
    if (from) { params.push(from); where.push(`c."occurredOn" >= $${params.length}`); }
    if (to) { params.push(to); where.push(`c."occurredOn" <= $${params.length}`); }
    res.json(await all(
      `SELECT c.*, l.company AS "leadCompany", cm.name AS "campaignName"
         FROM conversions c
         LEFT JOIN leads l ON l.id = c."leadId"
         LEFT JOIN campaigns cm ON cm.id = c."campaignId"
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY c."occurredOn" DESC, c."createdAt" DESC LIMIT 500`, params));
  } catch (e) { next(e); }
});

conversionsRouter.post("/", cWrite, async (req, res, next) => {
  try {
    const d = req.body || {};
    const amount = Number(d.valueAmount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "valueAmount must be a positive number" });
    if (!d.leadId && !d.customerId) return res.status(400).json({ error: "A conversion needs a leadId or a customerId" });
    // Campaign attribution is inherited from the lead when not given, so a
    // conversion lands in the right war room without extra work.
    let campaignId = d.campaignId || null;
    if (!campaignId && d.leadId) {
      campaignId = (await get(`SELECT "campaignId" v FROM leads WHERE id = $1`, [d.leadId]))?.v || null;
    }
    const valueUsd = await toUsd(amount, d.currency);
    const row = await get(
      `INSERT INTO conversions ("leadId","customerId","campaignId","valueAmount",currency,"valueUsd","occurredOn",kind,source,notes,"createdById")
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),$8,$9,$10,$11) RETURNING *`,
      [d.leadId || null, d.customerId || null, campaignId, amount, (d.currency || "USD").toUpperCase(),
       valueUsd, d.occurredOn || null, d.kind || "SALE", d.source || "MANUAL", d.notes || null, req.user.id]);
    if (d.leadId) logActivity(req, d.leadId, "NOTE", null, { via: "CONVERSION", valueUsd });
    logAudit(req, "conversions.create", "conversions", row.id, { valueUsd });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

conversionsRouter.delete("/:id", cWrite, async (req, res, next) => {
  try {
    const row = await get(`SELECT id FROM conversions WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Conversion not found" });
    await run(`DELETE FROM conversions WHERE id = $1`, [req.params.id]);
    logAudit(req, "conversions.delete", "conversions", req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Rolled-up value, the number a CMO is actually asked for. */
conversionsRouter.get("/summary", cRead, async (req, res, next) => {
  try {
    const spend = Number((await get(
      `SELECT COALESCE(SUM("amountUsd"),0)::float8 v FROM budget_entries WHERE kind='SPENT' AND "createdAt" >= now() - interval '90 days'`))?.v || 0);
    const value = Number((await get(
      `SELECT COALESCE(SUM("valueUsd"),0)::float8 v FROM conversions WHERE "occurredOn" >= CURRENT_DATE - 90`))?.v || 0);
    res.json({
      windowDays: 90, spendUsd: spend, valueUsd: value,
      roiPct: spend > 0 ? Math.round(((value - spend) / spend) * 1000) / 10 : null,
      byCampaign: await all(
        `SELECT cm.name, COALESCE(SUM(c."valueUsd"),0)::float8 AS "valueUsd", COUNT(*)::int AS n
           FROM conversions c JOIN campaigns cm ON cm.id = c."campaignId"
          WHERE c."occurredOn" >= CURRENT_DATE - 90 GROUP BY cm.name ORDER BY "valueUsd" DESC LIMIT 20`),
    });
  } catch (e) { next(e); }
});

// ── The lead loop ────────────────────────────────────────────────────
export const leadLoopRouter = Router();
leadLoopRouter.use(requireAuth);

/** Assign an owner and start the clock. */
leadLoopRouter.post("/:id/assign", requirePerm("leads", "write"), async (req, res, next) => {
  try {
    const lead = await get(`SELECT * FROM leads WHERE id = $1`, [req.params.id]);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const hasOwner = Object.prototype.hasOwnProperty.call(req.body || {}, "ownerId");
    const ownerId = hasOwner ? (req.body.ownerId || null) : req.user.id;
    if (ownerId && !(await get(`SELECT 1 FROM users WHERE id = $1 AND active = true`, [ownerId]))) {
      return res.status(400).json({ error: "Owner must be an active user" });
    }
    const hours = Number(req.body?.slaHours) || Number((await get(`SELECT "followUpSlaHours" v FROM settings WHERE id = 1`).catch(() => null))?.v) || 48;
    const row = await get(
      `UPDATE leads SET "ownerId" = $2, "followUpDueAt" = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() + ($3 || ' hours')::interval END,
          "slaBreached" = false, "updatedAt" = now() WHERE id = $1 RETURNING *`,
      [lead.id, ownerId, String(hours)]);
    logActivity(req, lead.id, "NOTE", null, { via: "ASSIGN", ownerId, slaHours: hours });
    if (ownerId && ownerId !== req.user.id) {
      notify([ownerId], "LEAD_ASSIGNED", { company: lead.company, slaHours: hours }, `/leads/${lead.id}`).catch(() => {});
    }
    res.json(row);
  } catch (e) { next(e); }
});

/** Record first contact — the event the SLA is measured against. */
leadLoopRouter.post("/:id/contacted", requirePerm("leads", "write"), async (req, res, next) => {
  try {
    const lead = await get(`SELECT * FROM leads WHERE id = $1`, [req.params.id]);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const row = await get(
      `UPDATE leads SET "firstContactedAt" = COALESCE("firstContactedAt", now()),
         "followUpDueAt" = NULL, "updatedAt" = now() WHERE id = $1 RETURNING *`, [lead.id]);
    logActivity(req, lead.id, "NOTE", null, { via: "CONTACTED" });
    res.json(row);
  } catch (e) { next(e); }
});

/** What is overdue, for the owner's home and the Morning Pulse. */
leadLoopRouter.get("/due", requirePerm("leads", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT l.id, l.company, l."ownerId", l."followUpDueAt", l."slaBreached", u.name AS "ownerName",
              (l."followUpDueAt" < now()) AS overdue
         FROM leads l LEFT JOIN users u ON u.id = l."ownerId"
        WHERE l."followUpDueAt" IS NOT NULL AND l.stage NOT IN ('WON','LOST')
        ORDER BY l."followUpDueAt" ASC LIMIT 200`));
  } catch (e) { next(e); }
});

/**
 * Daily Pulse step: breach the clock, tell the owner, escalate to the
 * department head. Runs once per lead — `slaBreached` is the latch, so a
 * lead that stays overdue does not renotify every night.
 */
export async function followUpSweep() {
  const overdue = await all(
    `SELECT l.id, l.company, l."ownerId", u."departmentId", d."headId"
       FROM leads l LEFT JOIN users u ON u.id = l."ownerId"
       LEFT JOIN departments d ON d.id = u."departmentId"
      WHERE l."followUpDueAt" IS NOT NULL AND l."followUpDueAt" < now()
        AND l."slaBreached" = false AND l.stage NOT IN ('WON','LOST')`).catch(() => []);
  let notified = 0, escalated = 0;
  for (const l of overdue) {
    await run(`UPDATE leads SET "slaBreached" = true WHERE id = $1`, [l.id]);
    if (l.ownerId) { await notify([l.ownerId], "LEAD_SLA_BREACH", { company: l.company }, `/leads/${l.id}`).catch(() => {}); notified++; }
    if (l.headId && l.headId !== l.ownerId) {
      await notify([l.headId], "LEAD_SLA_ESCALATION", { company: l.company, ownerId: l.ownerId }, `/leads/${l.id}`).catch(() => {});
      escalated++;
    }
  }
  return { breached: overdue.length, notified, escalated };
}
