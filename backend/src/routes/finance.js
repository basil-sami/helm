import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";

// ═══ W5·NERVE — one money truth, one connected spine ═════════════════
// Laws in NERVE-BRIEF.md. The triad reads LEDGERS, not documents:
//   المخطط  planned   = campaigns.budgetUsd (the envelope)
//   الملتزم committed = invoices RECEIVED (obligations on the desk)
//                       + booked placements on campaign-linked plans
//   المصروف actual    = ad_spend + budget_entries kind=SPENT
// Invoice approval already writes the SPENT entry (the existing rail),
// so approved money flows into `actual` automatically — money never
// gets a second writer, and nothing is counted twice. PAID is a cash
// status, not a spend event, and stays out of the triad by design.
// A dollar the graph cannot link to a campaign lands in the DECLARED
// unlinked pool — named, never zeroed, never guessed into a campaign.

const HEALTH = (pct) => (pct == null ? null : pct >= 100 ? "OVER" : pct >= 90 ? "WATCH" : "OK");
const r2 = (n) => Math.round(n * 100) / 100;

async function triadRows() {
  // W5·NERVE2 — the SDG mirror. A volatile currency demands per-row
  // honesty: a row that recorded its own rate (rateAtEntry) or its own
  // SDG amount converts at ITS truth; a row that recorded neither uses
  // today's settings rate — and the payload declares what share of the
  // money carries its entry-time truth, so nobody mistakes the mirror
  // for an accounting system.
  const rate = Number((await get(`SELECT "usdToSdgRate" FROM settings WHERE id = 1`))?.usdToSdgRate) || 0;
  const camps = await all(
    `SELECT c.id, c.name, c."nameAr", c.status, c."businessUnit", c."budgetUsd", c."budgetSdg",
            c."departmentId", d.name AS "departmentName"
     FROM campaigns c LEFT JOIN departments d ON d.id = c."departmentId"
     ORDER BY c."createdAt" DESC`);
  const spend = await all(
    `SELECT "campaignId", platform, SUM("amountUsd")::float AS usd,
            SUM("amountUsd" * COALESCE("rateAtEntry", $1))::float AS sdg,
            SUM(CASE WHEN "rateAtEntry" IS NOT NULL THEN "amountUsd" ELSE 0 END)::float AS "atEntryUsd"
     FROM ad_spend GROUP BY 1, 2`, [rate]);
  const ledger = await all(
    `SELECT "campaignId", channel, SUM("amountUsd")::float AS usd,
            SUM(CASE WHEN "amountSdg" > 0 THEN "amountSdg" ELSE "amountUsd" * COALESCE("rateAtEntry", $1) END)::float AS sdg,
            SUM(CASE WHEN "amountSdg" > 0 OR "rateAtEntry" IS NOT NULL THEN "amountUsd" ELSE 0 END)::float AS "atEntryUsd"
     FROM budget_entries WHERE kind = 'SPENT' GROUP BY 1, 2`, [rate]);
  const pending = await all(
    `SELECT "campaignId", SUM("amountUsd")::float AS usd,
            SUM("amountUsd" * COALESCE("rateAtEntry", $1))::float AS sdg,
            SUM(CASE WHEN "rateAtEntry" IS NOT NULL THEN "amountUsd" ELSE 0 END)::float AS "atEntryUsd"
     FROM invoices WHERE status = 'RECEIVED' GROUP BY 1`, [rate]);
  const placed = await all(
    `SELECT mp."campaignId", SUM(pl."costUsd")::float AS usd,
            SUM(pl."costUsd" * $1)::float AS sdg, 0::float AS "atEntryUsd"
     FROM media_placements pl JOIN media_plans mp ON mp.id = pl."planId"
     GROUP BY 1`, [rate]);
  // W5·NERVE2 — allocation detail: PLANNED entries are the plan's line
  // items INSIDE the envelope, never a second envelope.
  const alloc = await all(
    `SELECT "campaignId", SUM("amountUsd")::float AS usd,
            SUM(CASE WHEN "amountSdg" > 0 THEN "amountSdg" ELSE "amountUsd" * COALESCE("rateAtEntry", $1) END)::float AS sdg
     FROM budget_entries WHERE kind = 'PLANNED' GROUP BY 1`, [rate]);

  const zero = () => ({ planned: 0, committed: 0, actual: 0, plannedSdg: 0, committedSdg: 0, actualSdg: 0, allocated: 0, allocatedSdg: 0, atEntryUsd: 0 });
  const rows = new Map(camps.map((c) => [c.id, {
    id: c.id, name: c.name, nameAr: c.nameAr, status: c.status,
    businessUnit: c.businessUnit, departmentId: c.departmentId, departmentName: c.departmentName,
    ...zero(),
    planned: Number(c.budgetUsd) || 0,
    plannedSdg: Number(c.budgetSdg) > 0 ? Number(c.budgetSdg) : (Number(c.budgetUsd) || 0) * rate,
  }]));
  const unlinked = zero();
  const add = (campaignId, field, usd, sdg = 0, atEntryUsd = 0) => {
    const t = campaignId && rows.has(campaignId) ? rows.get(campaignId) : unlinked;
    t[field] += usd || 0;
    t[`${field}Sdg`] += sdg || 0;
    t.atEntryUsd += atEntryUsd || 0;
  };
  for (const s of spend) add(s.campaignId, "actual", s.usd, s.sdg, s.atEntryUsd);
  for (const l of ledger) add(l.campaignId, "actual", l.usd, l.sdg, l.atEntryUsd);
  for (const p of pending) add(p.campaignId, "committed", p.usd, p.sdg, p.atEntryUsd);
  for (const p of placed) add(p.campaignId, "committed", p.usd, p.sdg, p.atEntryUsd);
  for (const a of alloc) {
    const t = a.campaignId && rows.has(a.campaignId) ? rows.get(a.campaignId) : unlinked;
    t.allocated += a.usd || 0;
    t.allocatedSdg += a.sdg || 0;
  }

  const campaigns = [...rows.values()].map((r) => {
    const pct = r.planned > 0 ? r2(((r.actual + r.committed) / r.planned) * 100) : null;
    return { ...r,
      planned: r2(r.planned), committed: r2(r.committed), actual: r2(r.actual),
      plannedSdg: r2(r.plannedSdg), committedSdg: r2(r.committedSdg), actualSdg: r2(r.actualSdg),
      allocated: r2(r.allocated), allocatedSdg: r2(r.allocatedSdg),
      overAllocated: r.planned > 0 && r.allocated > r.planned,
      pct, health: HEALTH(pct) };
  });
  const un = Object.fromEntries(Object.entries(unlinked).map(([k, v]) => [k, r2(v)]));
  return { campaigns, unlinked: un, spend, ledger, rate };
}

export const financeRouter = Router();
financeRouter.use(requireAuth);

financeRouter.get("/overview", requirePerm("budget", "read"), async (_req, res, next) => {
  try {
    const { campaigns, unlinked, spend, ledger, rate } = await triadRows();
    const sum = (arr, f) => r2(arr.reduce((a, b) => a + (b[f] || 0), 0));
    const totals = {
      planned: sum(campaigns, "planned"),
      committed: r2(sum(campaigns, "committed") + unlinked.committed),
      actual: r2(sum(campaigns, "actual") + unlinked.actual),
    };
    const totalsSdg = {
      planned: sum(campaigns, "plannedSdg"),
      committed: r2(sum(campaigns, "committedSdg") + unlinked.committedSdg),
      actual: r2(sum(campaigns, "actualSdg") + unlinked.actualSdg),
    };
    const flowUsd = totals.committed + totals.actual;
    const atEntry = r2(sum(campaigns, "atEntryUsd") + unlinked.atEntryUsd);
    const sdgMeta = {
      currentRate: rate,
      atEntrySharePct: flowUsd > 0 ? r2((atEntry / flowUsd) * 100) : null,
    };
    // Department rollup: linked campaigns by department; the unlinked
    // pool is its own declared line, so the rollup reconciles exactly.
    const deptMap = new Map();
    for (const c of campaigns) {
      const k = c.departmentId || "__none";
      const d = deptMap.get(k) || { departmentId: c.departmentId, departmentName: c.departmentName || null,
                                    planned: 0, committed: 0, actual: 0,
                                    plannedSdg: 0, committedSdg: 0, actualSdg: 0 };
      d.planned += c.planned; d.committed += c.committed; d.actual += c.actual;
      d.plannedSdg += c.plannedSdg; d.committedSdg += c.committedSdg; d.actualSdg += c.actualSdg;
      deptMap.set(k, d);
    }
    const byDepartment = [...deptMap.values()].map((d) =>
      ({ ...d, planned: r2(d.planned), committed: r2(d.committed), actual: r2(d.actual),
         plannedSdg: r2(d.plannedSdg), committedSdg: r2(d.committedSdg), actualSdg: r2(d.actualSdg) }));
    // Channel rollup decomposes ACTUAL only, by source channel — ad
    // platforms plus ledger channels — and must sum to totals.actual.
    const chMap = new Map();
    const bump = (ch, usd, sdg) => {
      const cur = chMap.get(ch) || { actual: 0, actualSdg: 0 };
      chMap.set(ch, { actual: r2(cur.actual + (usd || 0)), actualSdg: r2(cur.actualSdg + (sdg || 0)) });
    };
    for (const s of spend) bump(`AD·${s.platform}`, s.usd, s.sdg);
    for (const l of ledger) bump(l.channel, l.usd, l.sdg);
    const byChannel = [...chMap.entries()].map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.actual - a.actual);
    res.json({ totals, totalsSdg, sdgMeta, campaigns, unlinked, byDepartment, byChannel });
  } catch (e) { next(e); }
});

// ── the nerve: everything one campaign touches, counted live ─────────
const TISSUE = [
  ["content", `SELECT COUNT(*)::int c FROM content_items WHERE "campaignId" = $1`],
  ["variants", `SELECT COUNT(*)::int c FROM content_variants v JOIN content_items ci ON ci.id = v."contentId" WHERE ci."campaignId" = $1`],
  ["scheduled", `SELECT COUNT(*)::int c FROM scheduled_posts sp JOIN content_variants v ON v.id = sp."variantId" JOIN content_items ci ON ci.id = v."contentId" WHERE ci."campaignId" = $1`],
  ["leads", `SELECT COUNT(*)::int c FROM leads WHERE "campaignId" = $1`],
  ["links", `SELECT COUNT(*)::int c FROM tracked_links WHERE "campaignId" = $1`],
  ["forms", `SELECT COUNT(*)::int c FROM forms WHERE "campaignId" = $1`],
  ["submissions", `SELECT COUNT(*)::int c FROM form_submissions fs JOIN forms f ON f.id = fs."formId" WHERE f."campaignId" = $1`],
  ["events", `SELECT COUNT(*)::int c FROM events WHERE "campaignId" = $1`],
  ["placements", `SELECT COUNT(*)::int c FROM media_placements pl JOIN media_plans mp ON mp.id = pl."planId" WHERE mp."campaignId" = $1`],
  ["spendRows", `SELECT COUNT(*)::int c FROM ad_spend WHERE "campaignId" = $1`],
  ["invoices", `SELECT COUNT(*)::int c FROM invoices WHERE "campaignId" = $1`],
  ["tasks", `SELECT COUNT(*)::int c FROM tasks WHERE "campaignId" = $1`],
];

export const nerveRouter = Router();
nerveRouter.use(requireAuth);

nerveRouter.get("/campaigns/:id", requirePerm("campaigns", "read"), async (req, res, next) => {
  try {
    const camp = await get(`SELECT id, name, "nameAr", "budgetUsd" FROM campaigns WHERE id = $1`, [req.params.id]);
    if (!camp) return res.status(404).json({ error: "Not found" });
    const { campaigns } = await triadRows();
    const money = campaigns.find((c) => c.id === camp.id) || null;
    const tissue = {};
    for (const [key, sql] of TISSUE) {
      try { tissue[key] = (await get(sql, [camp.id]))?.c ?? 0; }
      catch { tissue[key] = null; /* a module's table may not exist pre-migration — declared, not zeroed */ }
    }
    const objectives = await all(
      `SELECT id, label, "labelAr", "targetValue", metric, status
       FROM objectives WHERE "campaignIds" @> $1::jsonb ORDER BY "createdAt" DESC`,
      [JSON.stringify([camp.id])]);
    res.json({
      campaign: { id: camp.id, name: camp.name, nameAr: camp.nameAr },
      money: money && { planned: money.planned, committed: money.committed, actual: money.actual,
                        plannedSdg: money.plannedSdg, committedSdg: money.committedSdg, actualSdg: money.actualSdg,
                        allocated: money.allocated, overAllocated: money.overAllocated,
                        pct: money.pct, health: money.health },
      tissue, objectives,
    });
  } catch (e) { next(e); }
});
