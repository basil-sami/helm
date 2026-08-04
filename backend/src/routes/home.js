import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm, hasPerm } from "../auth.js";
import { logAudit } from "../audit.js";

// ═══ W4·E · THE 9AM LOOP ══════════════════════════════════════════════
// The martech graveyard is full of products nobody opened on a Tuesday.
// A role home answers one question per role — "what does Pulse want from
// me today?" — and the setup checklist answers it for a brand-new
// instance. Both are computed from live data; neither stores state that
// could drift from the truth.

export const homeRouter = Router();
homeRouter.use(requireAuth);

const n = async (sql, params = []) => Number((await get(sql, params).catch(() => null))?.c || 0);

/** GET /api/home — only what this user can act on, scoped to their role. */
homeRouter.get("/", async (req, res, next) => {
  try {
    const p = req.user.permissions || {};
    const me = req.user.id;
    const can = (mod, lvl = "read") => hasPerm(p, mod, lvl);
    const out = { role: req.user.role, cards: [] };

    // ── Things waiting on me ──
    if (can("leads")) {
      const due = await all(
        `SELECT l.id, l.company, l."followUpDueAt", (l."followUpDueAt" < now()) AS overdue
           FROM leads l WHERE l."ownerId" = $1 AND l."followUpDueAt" IS NOT NULL
             AND l.stage NOT IN ('WON','LOST') ORDER BY l."followUpDueAt" ASC LIMIT 10`, [me]);
      out.cards.push({ key: "leadsDue", count: due.length,
        overdue: due.filter((d) => d.overdue).length, items: due, link: "/leads" });
    }

    if (can("campaigns") || p.admin) {
      const pending = await all(
        `SELECT a.id, a.entity, a."createdAt", (a."escalatedAt" IS NOT NULL) AS stale
           FROM approvals a WHERE a.status = 'PENDING' ORDER BY a."createdAt" ASC LIMIT 10`).catch(() => []);
      out.cards.push({ key: "approvals", count: pending.length,
        stale: pending.filter((a) => a.stale).length, items: pending, link: "/approvals" });
    }

    if (can("tasks")) {
      const tasks = await all(
        `SELECT id, title, priority, "dueDate" FROM tasks
          WHERE "assigneeId" = $1 AND status <> 'DONE' AND "dueDate"::date <= CURRENT_DATE
          ORDER BY priority = 'HIGH' DESC, "dueDate" ASC LIMIT 10`, [me]).catch(() => []);
      out.cards.push({ key: "tasks", count: tasks.length, items: tasks, link: "/tasks" });
    }

    // The publish queue is a queue to ACT on, so it needs publish rights —
    // read access to content is not the same as being able to ship it.
    if (can("publish")) {
      const queue = await all(
        `SELECT sp.id, sp.status, sp."scheduledAt", ci.title FROM scheduled_posts sp
           LEFT JOIN content_variants cv ON cv.id = sp."variantId"
           LEFT JOIN content_items ci ON ci.id = cv."contentId"
          WHERE sp.status IN ('QUEUED','READY','AWAITING_APPROVAL','NOTIFIED')
            AND sp."scheduledAt"::date <= CURRENT_DATE + 1
          ORDER BY sp."scheduledAt" ASC LIMIT 10`).catch(() => []);
      out.cards.push({ key: "publishQueue", count: queue.length, items: queue, link: "/publish" });
    }

    // ── The analyst's queue ──
    if (can("intel")) {
      const reviewCount = await n(`SELECT COUNT(*)::int c FROM osint_signals WHERE "reviewStatus" = 'PENDING'`);
      const oldest = await get(
        `SELECT MIN("createdAt") AS d FROM osint_signals WHERE "reviewStatus" = 'PENDING'`).catch(() => null);
      const ageHours = oldest?.d ? Math.round((Date.now() - new Date(oldest.d)) / 3600000) : 0;
      out.cards.push({ key: "reviewQueue", count: reviewCount, oldestHours: ageHours, link: "/listening" });
    }

    // ── The number the GM opens with ──
    if (can("analytics")) {
      const idx = await all(
        `SELECT value FROM metric_snapshots WHERE "metricKey" = 'pulse_index' AND dims = '{}'::jsonb
          ORDER BY date DESC LIMIT 2`).catch(() => []);
      const anomalies = await n(
        `SELECT COUNT(*)::int c FROM metric_alerts WHERE "lastFiredAt" >= now() - interval '24 hours'`);
      out.cards.push({ key: "pulse",
        value: idx.length ? Math.round(Number(idx[0].value)) : null,
        delta: idx.length > 1 ? Math.round(Number(idx[0].value) - Number(idx[1].value)) : 0,
        anomalies, link: "/analytics" });
    }

    if (can("campaigns")) {
      const ending = await all(
        `SELECT id, name, "endDate" FROM campaigns WHERE status = 'ACTIVE'
           AND "endDate" IS NOT NULL AND "endDate"::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
          ORDER BY "endDate" ASC LIMIT 5`).catch(() => []);
      out.cards.push({ key: "campaignsEnding", count: ending.length, items: ending, link: "/campaigns" });
    }

    out.total = out.cards.reduce((sum, c) => sum + (c.count || 0), 0);
    res.json(out);
  } catch (e) { next(e); }
});

/**
 * GET /api/home/checklist — the guided first campaign.
 * Computed from live data, never stored: a checklist that can disagree
 * with reality is worse than none. Same ethos as the self-filling OKRs.
 */
export async function setupChecklist() {
  const s = await get(`SELECT * FROM settings WHERE id = 1`).catch(() => null);
  const steps = [
    { key: "brand", labelAr: "اضبط هوية المؤسسة", label: "Set your brand",
      done: !!(s?.orgName && s.orgName.trim() && s.accentColor), link: "/settings" },
    { key: "team", labelAr: "أضِف زملاءك", label: "Invite your team",
      done: (await n(`SELECT COUNT(*)::int c FROM users WHERE active = true`)) > 1, link: "/users" },
    { key: "campaign", labelAr: "أنشئ حملتك الأولى", label: "Create your first campaign",
      done: (await n(`SELECT COUNT(*)::int c FROM campaigns`)) > 0, link: "/campaigns" },
    { key: "brief", labelAr: "اكتب موجز الحملة", label: "Write the campaign brief",
      done: (await n(`SELECT COUNT(*)::int c FROM campaign_briefs`)) > 0, link: "/campaigns" },
    { key: "audience", labelAr: "استورد جمهورك", label: "Bring in your audience",
      done: (await n(`SELECT COUNT(*)::int c FROM leads`)) > 0, link: "/imports" },
    { key: "content", labelAr: "جدوِل أول منشور", label: "Schedule your first post",
      done: (await n(`SELECT COUNT(*)::int c FROM content_items`)) > 0, link: "/calendar" },
    { key: "target", labelAr: "حدِّد هدفًا قابلًا للقياس", label: "Set a measurable target",
      done: (await n(`SELECT COUNT(*)::int c FROM metric_targets`)) > 0, link: "/analytics" },
    { key: "activate", labelAr: "شغِّل الحملة", label: "Activate the campaign",
      done: (await n(`SELECT COUNT(*)::int c FROM campaigns WHERE status = 'ACTIVE'`)) > 0, link: "/campaigns" },
  ];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length,
           complete: done === steps.length, next: steps.find((x) => !x.done)?.key || null };
}

homeRouter.get("/checklist", async (_req, res, next) => {
  try { res.json(await setupChecklist()); } catch (e) { next(e); }
});

// ── Templates: one library, promoted from process_templates ──────────
export const templateLibraryRouter = Router();
templateLibraryRouter.use(requireAuth);

templateLibraryRouter.get("/library", async (req, res, next) => {
  try {
    const kind = typeof req.query.kind === "string" ? req.query.kind.toUpperCase() : null;
    const rows = await all(
      `SELECT id, key, kind, name, "nameAr", description, "descriptionAr", builtin, tasks, definition
         FROM process_templates ${kind ? "WHERE kind = $1" : ""}
        ORDER BY builtin DESC, "createdAt" ASC`, kind ? [kind] : []).catch(() => []);
    res.json(rows);
  } catch (e) { next(e); }
});

/**
 * Create a real object from a template. Instantiation goes through the
 * same validation the manual path uses — a template is a starting point,
 * not a way around the rules.
 */
templateLibraryRouter.post("/library/:id/use", requirePerm("campaigns", "write"), async (req, res, next) => {
  try {
    const t = await get(`SELECT * FROM process_templates WHERE id = $1`, [req.params.id]);
    if (!t) return res.status(404).json({ error: "Template not found" });
    const def = typeof t.definition === "string" ? JSON.parse(t.definition) : (t.definition || {});

    if (t.kind === "CAMPAIGN") {
      const name = req.body?.name || def.name || t.name;
      const camp = await get(
        `INSERT INTO campaigns (name, "nameAr", objective, channel, status, "budgetUsd")
         VALUES ($1,$2,$3,COALESCE($4,'SOCIAL'),'PLANNING',COALESCE($5,0)) RETURNING *`,
        [name, req.body?.nameAr || def.nameAr || null, def.objective || null, def.channel || null, def.budgetUsd || 0]);
      // The brief travels with the template, so the activation gate is
      // satisfiable rather than an immediate dead end for a new user.
      if (def.brief) {
        await run(
          `INSERT INTO campaign_briefs ("campaignId", objective, "keyMessage", "kpiMetric", "kpiTarget")
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("campaignId") DO NOTHING`,
          [camp.id, def.brief.objective || null, def.brief.keyMessage || null,
           def.brief.kpiMetric || null, def.brief.kpiTarget || null]).catch(() => {});
      }
      logAudit(req, "templates.use", "campaigns", camp.id, { template: t.key });
      return res.status(201).json({ kind: t.kind, created: camp });
    }

    if (t.kind === "WORKFLOW") {
      // `workflows` carries trigger + actions only; conditions live inside
      // the actions array as IF nodes, which is the engine's own shape.
      // `trigger` is jsonb — { event, filters } — not a bare string.
      const trig = typeof def.trigger === "string" ? { event: def.trigger, filters: {} } : (def.trigger || { event: "LEAD_CREATED", filters: {} });
      const wf = await get(
        `INSERT INTO workflows (name, "nameAr", trigger, actions, active)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,false) RETURNING *`,
        [req.body?.name || t.name, t.nameAr || null, JSON.stringify(trig),
         JSON.stringify(def.actions || [])]).catch(() => null);
      if (!wf) return res.status(400).json({ error: "This workflow template is not valid on this instance" });
      logAudit(req, "templates.use", "workflows", wf.id, { template: t.key });
      return res.status(201).json({ kind: t.kind, created: wf });
    }

    return res.status(400).json({ error: `Templates of kind ${t.kind} are applied from their own module` });
  } catch (e) { next(e); }
});
