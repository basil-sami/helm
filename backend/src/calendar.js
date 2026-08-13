import { all, get, run } from "./db.js";
import { notify } from "./notify.js";

// ═══ W4·D · THE CALENDAR AND THE CLOCK ════════════════════════════════

// ── Hijri resolution, on native Intl ─────────────────────────────────
// Marketing in this market plans against Ramadan and the two Eids, which
// move ~11 days earlier each Gregorian year. `Intl` ships the Umm al-Qura
// calendar, so no dependency is needed to know when they fall.
const HIJRI_FMT = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
  day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC",
});

/** Gregorian Date → { year, month, day } in the Umm al-Qura calendar. */
export function toHijri(date) {
  const parts = HIJRI_FMT.formatToParts(date);
  const pick = (t) => Number(parts.find((p) => p.type === t)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/**
 * Find the Gregorian date on which a given hijri month/day falls inside a
 * Gregorian year. Scans the year day by day — 365 cheap conversions, run
 * a handful of times per calendar render, and correct by construction
 * rather than by an arithmetic approximation that drifts.
 */
export function hijriToGregorian(gYear, hMonth, hDay) {
  const hits = [];
  const d = new Date(Date.UTC(gYear, 0, 1));
  while (d.getUTCFullYear() === gYear) {
    const h = toHijri(d);
    if (h.month === hMonth && h.day === hDay) hits.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return hits; // may be 0 (falls outside the year) or 2 (falls twice)
}

/** Resolve every active seasonal event into concrete dates for a window. */
export async function seasonalOccurrences(fromISO, toISO) {
  const from = new Date(fromISO), to = new Date(toISO);
  if (isNaN(from) || isNaN(to)) return [];
  const events = await all(
    `SELECT e.*, p.key AS "packKey", p.name AS "packName" FROM seasonal_events e
       JOIN seasonal_packs p ON p.id = e."packId"
      WHERE e.active = true AND p.active = true`).catch(() => []);
  const out = [];
  const years = [];
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) years.push(y);

  for (const e of events) {
    const starts = [];
    if (e.calendar === "EXPLICIT" && e.onDate) starts.push(new Date(e.onDate));
    else if (e.calendar === "GREGORIAN" && e.month && e.day) {
      for (const y of years) starts.push(new Date(Date.UTC(y, e.month - 1, e.day)));
    } else if (e.calendar === "HIJRI" && e.month && e.day) {
      for (const y of years) starts.push(...hijriToGregorian(y, e.month, e.day));
    }
    for (const s of starts) {
      if (isNaN(s)) continue;
      const end = new Date(s); end.setUTCDate(end.getUTCDate() + Math.max(1, e.durationDays) - 1);
      if (end < from || s > to) continue;
      const prep = new Date(s); prep.setUTCDate(prep.getUTCDate() - (e.leadTimeDays || 0));
      out.push({
        kind: "seasonal", id: `${e.id}:${s.toISOString().slice(0, 10)}`, eventId: e.id,
        key: e.key, name: e.name, nameAr: e.nameAr, eventKind: e.kind, calendar: e.calendar,
        pack: e.packKey, startDate: s.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10),
        prepFrom: prep.toISOString().slice(0, 10), leadTimeDays: e.leadTimeDays,
        hijri: toHijri(s),
      });
    }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * The unified feed. The calendar page already rendered content, events and
 * campaign spans; it was missing the publishing queue and the season, and
 * those are exactly the two layers a marketer plans against.
 */
export async function calendarFeed(fromISO, toISO) {
  const p = [fromISO, toISO];
  const safe = (sql, params = p) => all(sql, params).catch(() => []);
  const [content, events, campaigns, posts, seasonal] = await Promise.all([
    safe(`SELECT ci.id, ci.title, ci."titleAr", ci.channel, ci.status, ci."scheduledAt" AS "startDate",
                 c.name AS "campaignName", ci."campaignId"
             FROM content_items ci LEFT JOIN campaigns c ON c.id = ci."campaignId"
            WHERE ci."scheduledAt" >= $1::date AND ci."scheduledAt" < $2::date + interval '1 day'`),
    safe(`SELECT id, name, "nameAr", status, "startDate", "endDate" FROM events
            WHERE "startDate" <= $2::date AND COALESCE("endDate", "startDate") >= $1::date`),
    safe(`SELECT id, name, "nameAr", status, "startDate", "endDate" FROM campaigns
            WHERE "startDate" <= $2::date AND COALESCE("endDate", "startDate") >= $1::date`),
    safe(`SELECT sp.id, sp.status, sp."scheduledAt" AS "startDate", sp."campaignId",
                 cv.platform, ci.title, c.name AS "campaignName"
            FROM scheduled_posts sp
            LEFT JOIN content_variants cv ON cv.id = sp."variantId"
            LEFT JOIN content_items ci ON ci.id = cv."contentId"
            LEFT JOIN campaigns c ON c.id = sp."campaignId"
            WHERE sp."scheduledAt" >= $1::date AND sp."scheduledAt" < $2::date + interval '1 day'`),
    seasonalOccurrences(fromISO, toISO),
  ]);
  return {
    from: fromISO, to: toISO,
    content: content.map((r) => ({ kind: "content", ...r })),
    events: events.map((r) => ({ kind: "event", ...r })),
    campaigns: campaigns.map((r) => ({ kind: "campaign", ...r })),
    posts: posts.map((r) => ({ kind: "post", ...r })),
    seasonal,
  };
}

// ── Approval delegation and escalation ───────────────────────────────

/** Who may decide for this approver today — themselves, plus any delegate. */
export async function effectiveApprovers(approverId, onDate = new Date()) {
  if (!approverId) return [];
  const day = onDate.toISOString().slice(0, 10);
  const rows = await all(
    `SELECT "delegateId" FROM approval_delegations
      WHERE "approverId" = $1 AND active = true AND "fromDate" <= $2 AND "toDate" >= $2`,
    [approverId, day]).catch(() => []);
  return [approverId, ...rows.map((r) => r.delegateId)];
}

export async function delegationError(d) {
  if (!d.approverId || !d.delegateId) return "A delegation needs an approver and a delegate";
  if (d.approverId === d.delegateId) return "An approver cannot delegate to themselves";
  if (!d.fromDate || !d.toDate) return "A delegation needs a date window";
  if (String(d.toDate) < String(d.fromDate)) return "The delegation window ends before it starts";
  const clash = await get(
    `SELECT 1 FROM approval_delegations WHERE "approverId" = $1 AND active = true
       AND "fromDate" <= $3 AND "toDate" >= $2`,
    [d.approverId, d.fromDate, d.toDate]).catch(() => null);
  if (clash) return "This approver already has a delegation covering part of that window";
  return null;
}

/**
 * Daily Pulse step. An approval waiting longer than the instance's limit
 * is escalated once — `escalatedAt` is the latch, matching the lead-SLA
 * pattern, so a stuck approval does not renotify every night.
 */
export async function approvalEscalationSweep() {
  const hours = Number((await get(`SELECT "approvalSlaHours" v FROM settings WHERE id = 1`).catch(() => null))?.v) || 48;
  const stale = await all(
    `SELECT a.id, a.entity, a."entityId", a."approverId", u."departmentId", d."headId"
       FROM approvals a
       LEFT JOIN users u ON u.id = a."approverId"
       LEFT JOIN departments d ON d.id = u."departmentId"
      WHERE a.status = 'PENDING' AND a."escalatedAt" IS NULL
        AND a."createdAt" < now() - ($1 || ' hours')::interval`, [String(hours)]).catch(() => []);
  let nudged = 0, escalated = 0;
  for (const a of stale) {
    await run(`UPDATE approvals SET "escalatedAt" = now() WHERE id = $1`, [a.id]);
    const delegates = await effectiveApprovers(a.approverId);
    if (delegates.length) { await notify(delegates, "APPROVAL_STALE", { entity: a.entity, hours }, `/approvals`).catch(() => {}); nudged++; }
    if (a.headId && !delegates.includes(a.headId)) {
      await notify([a.headId], "APPROVAL_ESCALATION", { entity: a.entity, hours }, `/approvals`).catch(() => {});
      escalated++;
    }
  }
  return { stale: stale.length, nudged, escalated, slaHours: hours };
}
