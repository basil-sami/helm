import { Router } from "express";
import { all, get, run } from "./db.js";
import { requireAuth } from "./auth.js";

// ═══ THE MORNING PULSE (Wave 1·G) — إيقاع الصباح ═════════════════════
// One compiled briefing: where the pulse sits, what's due, what's hot,
// what fired overnight. Written by the Daily Pulse, read on arrival.

export async function compileMorning() {
  const idx = await all(
    `SELECT date, value FROM metric_snapshots
     WHERE "metricKey" = 'pulse_index' AND dims = '{}'::jsonb
     ORDER BY date DESC LIMIT 2`);
  const pulse = idx.length
    ? { value: Math.round(Number(idx[0].value)), delta: idx.length > 1 ? Math.round(Number(idx[0].value) - Number(idx[1].value)) : 0 }
    : { value: null, delta: 0 };

  const tasksDue = await all(
    `SELECT t.id, t.title, t.priority, u.name AS assignee FROM tasks t
     LEFT JOIN users u ON u.id = t."assigneeId"
     WHERE t.status <> 'DONE' AND t."dueDate"::date <= CURRENT_DATE
     ORDER BY t.priority = 'HIGH' DESC, t."dueDate" ASC LIMIT 8`);

  const publishDue = await all(
    `SELECT sp.id, sp."scheduledAt", sp.status, ci.title FROM scheduled_posts sp
     JOIN content_variants cv ON cv.id = sp."variantId"
     JOIN content_items ci ON ci.id = cv."contentId"
     WHERE sp.status IN ('QUEUED','READY','AWAITING_APPROVAL') AND sp."scheduledAt"::date = CURRENT_DATE
     ORDER BY sp."scheduledAt" ASC LIMIT 6`);

  const outreachDue = await all(
    `SELECT t.id, t."targetName", t.channel, o.name AS campaign FROM outreach_touches t
     JOIN outreach_campaigns o ON o.id = t."campaignId"
     WHERE t.status = 'PLANNED' AND t."dueAt"::date <= CURRENT_DATE AND o.status = 'ACTIVE'
     ORDER BY t."dueAt" ASC LIMIT 6`);

  const hotLeads = await all(
    `SELECT id, company, score, stage FROM leads
     WHERE score >= 70 AND stage NOT IN ('WON','LOST')
     ORDER BY score DESC LIMIT 5`);

  const wonYesterday = await all(
    `SELECT DISTINCT l.id, l.company, l."valueUsd" FROM lead_activities a
     JOIN leads l ON l.id = a."leadId"
     WHERE a.kind = 'STAGE' AND a.meta->>'to' = 'WON'
       AND a."createdAt" >= CURRENT_DATE - 1 AND a."createdAt" < CURRENT_DATE
     LIMIT 5`);

  const alerts = await all(
    `SELECT "metricKey", condition, threshold FROM metric_alerts
     WHERE "lastFiredAt" >= now() - interval '24 hours' LIMIT 6`);

  const inboxOpen = Number((await get(
    `SELECT COUNT(*)::int c FROM inbox_items WHERE status = 'OPEN'`))?.c || 0);
  const coldMedia = Number((await get(
    `SELECT COUNT(*)::int c FROM media_contacts
     WHERE "lastContactAt" IS NULL OR "lastContactAt" < now() - interval '90 days'`))?.c || 0);

  return {
    date: new Date().toISOString().slice(0, 10),
    pulse, tasksDue, publishDue, outreachDue, hotLeads, wonYesterday, alerts,
    counts: { inboxOpen, coldMedia },
  };
}

/** Daily Pulse step: write today's digest once (idempotent per date). */
export async function writeMorningDigest() {
  const dup = await get(
    `SELECT 1 FROM digest_log WHERE kind = 'MORNING_PULSE' AND "sentAt"::date = CURRENT_DATE LIMIT 1`);
  if (dup) return 0;
  const payload = await compileMorning();
  await run(`INSERT INTO digest_log (kind, channel, payload) VALUES ('MORNING_PULSE','INAPP',$1)`,
    [JSON.stringify(payload)]);
  return 1;
}

export const digestRouter = Router();
digestRouter.use(requireAuth);

// Today's briefing: the logged one if the night ran, else compiled live.
digestRouter.get("/morning", async (_req, res, next) => {
  try {
    const row = await get(
      `SELECT payload FROM digest_log WHERE kind = 'MORNING_PULSE' AND "sentAt"::date = CURRENT_DATE
       ORDER BY "sentAt" DESC LIMIT 1`);
    if (row) {
      const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      return res.json({ ...p, logged: true });
    }
    res.json({ ...(await compileMorning()), logged: false });
  } catch (e) { next(e); }
});

digestRouter.get("/history", async (_req, res, next) => {
  try {
    res.json(await all(
      `SELECT id, kind, channel, "sentAt" FROM digest_log ORDER BY "sentAt" DESC LIMIT 14`));
  } catch (e) { next(e); }
});
