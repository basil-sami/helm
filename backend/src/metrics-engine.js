import { all, get, run } from "./db.js";
import { notify } from "./notify.js";

// ═══ THE MEASUREMENT BRAIN (Wave 1·C) ═════════════════════════════════
// Every KPI in Pulse is defined exactly once. The CATALOG below is the
// source of truth for metadata; ensureCatalog() mirrors it into the
// `metrics` table (insert-only — admin edits like `active` survive).
// Formulas live in COMPUTE, versioned and testable. Composites (the
// Pulse Index and its area pulses) are declarative: weighted
// normalization of other catalog metrics, target-aware.

const clamp = (x) => Math.max(0, Math.min(100, x));
const num = async (sql, params = []) => { const r = await get(sql, params); return Number(r?.v ?? 0); };
const dim = async (sql, name, params = []) =>
  (await all(sql, params)).filter((r) => r.d !== null && r.d !== undefined)
    .map((r) => ({ dims: { [name]: String(r.d) }, value: Number(r.v) }));
const round1 = (x) => Math.round(x * 10) / 10;

// ── Compute registry: metricKey → async () => { value, slices? } ─────
const wonExists = (days) => `EXISTS (SELECT 1 FROM lead_activities a WHERE a."leadId" = l.id AND a.kind = 'STAGE'
  AND a.meta->>'to' = 'WON' AND a."createdAt" >= now() - interval '${days} days')`;

export const COMPUTE = {
  // ── DEMAND ──
  leads_new_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM leads WHERE "createdAt" >= now() - interval '30 days'`),
    // W4·A: campaign joins source as a slice dimension. Per-campaign series
    // therefore ride the existing snapshot engine — no parallel rollup.
    slices: [
      ...await dim(`SELECT source d, COUNT(*)::float8 v FROM leads WHERE "createdAt" >= now() - interval '30 days' GROUP BY source`, "source"),
      ...await dim(`SELECT c.name d, COUNT(*)::float8 v FROM leads l JOIN campaigns c ON c.id = l."campaignId"
                    WHERE l."createdAt" >= now() - interval '30 days' GROUP BY c.name`, "campaign"),
    ],
  }),
  pipeline_value: async () => ({
    value: await num(`SELECT COALESCE(SUM("valueUsd"),0)::float8 v FROM leads WHERE stage NOT IN ('WON','LOST')`),
  }),
  won_value_30d: async () => ({
    value: await num(`SELECT COALESCE(SUM(l."valueUsd"),0)::float8 v FROM leads l WHERE l.stage = 'WON' AND ${wonExists(30)}`),
  }),
  won_count_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM leads l WHERE l.stage = 'WON' AND ${wonExists(30)}`),
  }),
  win_rate_90d: async () => ({
    value: round1(await num(`SELECT CASE WHEN (w+lo)=0 THEN 0 ELSE w*100.0/(w+lo) END v FROM (
      SELECT COUNT(*) FILTER (WHERE meta->>'to'='WON') w, COUNT(*) FILTER (WHERE meta->>'to'='LOST') lo
      FROM lead_activities WHERE kind='STAGE' AND "createdAt" >= now() - interval '90 days') t`)),
  }),
  avg_deal_usd_90d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG(l."valueUsd"),0)::float8 v FROM leads l WHERE l.stage='WON' AND ${wonExists(90)}`)),
  }),
  sales_velocity_days_90d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM a."createdAt" - l."createdAt")/86400),0)::float8 v
      FROM lead_activities a JOIN leads l ON l.id = a."leadId"
      WHERE a.kind='STAGE' AND a.meta->>'to'='WON' AND a."createdAt" >= now() - interval '90 days'`)),
  }),
  leads_stale_pct: async () => ({
    value: round1(await num(`SELECT CASE WHEN tot=0 THEN 0 ELSE stale*100.0/tot END v FROM (
      SELECT COUNT(*) FILTER (WHERE "updatedAt" < now() - interval '14 days') stale, COUNT(*) tot
      FROM leads WHERE stage NOT IN ('WON','LOST')) t`)),
  }),
  cpl_usd_30d: async () => ({
    value: round1(await num(`SELECT CASE WHEN n=0 THEN 0 ELSE s/n END v FROM (
      SELECT (SELECT COALESCE(SUM("amountUsd"),0) FROM budget_entries WHERE kind='SPENT' AND "createdAt" >= now() - interval '30 days') s,
             (SELECT COUNT(*)::float8 FROM leads WHERE "createdAt" >= now() - interval '30 days') n) t`)),
  }),
  // ── W4·C · value & the lead loop ──
  conversions_value_30d: async () => ({
    value: await num(`SELECT COALESCE(SUM("valueUsd"),0)::float8 v FROM conversions WHERE "occurredOn" >= CURRENT_DATE - 30`),
    slices: await dim(`SELECT c.name d, COALESCE(SUM(cv."valueUsd"),0)::float8 v FROM conversions cv
                       JOIN campaigns c ON c.id = cv."campaignId"
                       WHERE cv."occurredOn" >= CURRENT_DATE - 30 GROUP BY c.name`, "campaign"),
  }),
  marketing_roi_90d: async () => ({
    // Realised value against spend. Returns 0 rather than infinity when
    // nothing was spent — a ratio with a zero denominator is not a result.
    value: round1(await num(`SELECT CASE WHEN s = 0 THEN 0 ELSE ((v - s) / s) * 100 END x FROM (
      SELECT (SELECT COALESCE(SUM("amountUsd"),0)::float8 FROM budget_entries
                WHERE kind='SPENT' AND "createdAt" >= now() - interval '90 days') s,
             (SELECT COALESCE(SUM("valueUsd"),0)::float8 FROM conversions
                WHERE "occurredOn" >= CURRENT_DATE - 90) v) t`)),
  }),
  lead_followup_sla_pct_30d: async () => ({
    // Of leads assigned a follow-up deadline in the window, how many were
    // contacted before it passed.
    value: round1(await num(`SELECT CASE WHEN n = 0 THEN 100 ELSE met * 100.0 / n END x FROM (
      SELECT COUNT(*)::float8 n,
             COUNT(*) FILTER (WHERE "slaBreached" = false)::float8 met
        FROM leads WHERE "createdAt" >= now() - interval '30 days'
          AND ("followUpDueAt" IS NOT NULL OR "firstContactedAt" IS NOT NULL)) t`)),
  }),
  campaigns_active: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM campaigns WHERE status = 'ACTIVE'`),
  }),
  leads_lost_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM leads l WHERE l.stage='LOST' AND EXISTS (
      SELECT 1 FROM lead_activities a WHERE a."leadId"=l.id AND a.kind='STAGE' AND a.meta->>'to'='LOST'
      AND a."createdAt" >= now() - interval '30 days')`),
    slices: await dim(`SELECT COALESCE(l."lostReason",'UNSPECIFIED') d, COUNT(*)::float8 v FROM leads l
      WHERE l.stage='LOST' AND EXISTS (SELECT 1 FROM lead_activities a WHERE a."leadId"=l.id AND a.kind='STAGE'
      AND a.meta->>'to'='LOST' AND a."createdAt" >= now() - interval '30 days') GROUP BY 1`, "lostReason"),
  }),
  romi_pct_90d: async () => ({
    value: round1(await num(`SELECT CASE WHEN s=0 THEN 0 ELSE (w-s)*100.0/s END v FROM (
      SELECT (SELECT COALESCE(SUM("amountUsd"),0) FROM budget_entries WHERE kind='SPENT' AND "createdAt" >= now() - interval '90 days') s,
             (SELECT COALESCE(SUM(l."valueUsd"),0) FROM leads l WHERE l.stage='WON' AND ${wonExists(90)}) w) t`)),
  }),

  // ── ACQUISITION ──
  link_clicks_total: async () => ({
    value: await num(`SELECT COALESCE(SUM(clicks),0)::float8 v FROM tracked_links`),
    slices: await dim(`SELECT channel d, COALESCE(SUM(clicks),0)::float8 v FROM tracked_links GROUP BY channel`, "channel"),
  }),
  form_submissions_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM form_submissions WHERE "createdAt" >= now() - interval '30 days'`),
    slices: await dim(`SELECT f.slug d, COUNT(*)::float8 v FROM form_submissions s JOIN forms f ON f.id = s."formId"
      WHERE s."createdAt" >= now() - interval '30 days' GROUP BY f.slug`, "form"),
  }),
  form_leads_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM form_submissions WHERE "leadId" IS NOT NULL AND "createdAt" >= now() - interval '30 days'`),
  }),
  form_cvr_pct_30d: async () => ({
    value: round1(await num(`SELECT CASE WHEN t=0 THEN 0 ELSE le*100.0/t END v FROM (
      SELECT COUNT(*) t, COUNT(*) FILTER (WHERE "leadId" IS NOT NULL) le
      FROM form_submissions WHERE "createdAt" >= now() - interval '30 days') x`)),
  }),
  landing_views_total: async () => ({
    value: await num(`SELECT COALESCE(SUM(views),0)::float8 v FROM landing_pages`),
  }),

  // ── CONTENT ──
  posts_published_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM posts WHERE "publishedAt" >= now() - interval '30 days'`),
    slices: await dim(`SELECT platform d, COUNT(*)::float8 v FROM posts WHERE "publishedAt" >= now() - interval '30 days' GROUP BY platform`, "platform"),
  }),
  reach_30d: async () => ({
    value: await num(`SELECT COALESCE(SUM(reach),0)::float8 v FROM posts WHERE "publishedAt" >= now() - interval '30 days'`),
  }),
  er_pct_30d: async () => ({
    value: round1(await num(`SELECT CASE WHEN SUM(reach)=0 THEN 0 ELSE SUM(engagement)*100.0/SUM(reach) END v
      FROM posts WHERE "publishedAt" >= now() - interval '30 days'`)),
    slices: (await all(`SELECT platform d, CASE WHEN SUM(reach)=0 THEN 0 ELSE SUM(engagement)*100.0/SUM(reach) END v
      FROM posts WHERE "publishedAt" >= now() - interval '30 days' GROUP BY platform`))
      .filter((r) => r.d).map((r) => ({ dims: { platform: String(r.d) }, value: round1(Number(r.v)) })),
  }),
  content_backlog: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM content_items WHERE status <> 'PUBLISHED'`),
  }),
  approval_turnaround_h_30d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM "decidedAt" - "createdAt")/3600),0)::float8 v
      FROM approvals WHERE "decidedAt" IS NOT NULL AND "decidedAt" >= now() - interval '30 days'`)),
  }),

  // ── BRAND ──
  mentions_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM osint_signals WHERE canonical = true AND "reviewStatus" <> 'REJECTED' AND "fetchedAt" >= now() - interval '30 days'`),
    slices: await dim(`SELECT "sentimentLabel" d, COUNT(*)::float8 v FROM osint_signals
      WHERE canonical = true AND "reviewStatus" <> 'REJECTED' AND "fetchedAt" >= now() - interval '30 days' GROUP BY 1`, "sentiment"),
  }),
  sentiment_avg_30d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG(sentiment),0)::float8 v FROM osint_signals WHERE canonical = true AND "reviewStatus" <> 'REJECTED' AND "fetchedAt" >= now() - interval '30 days'`) * 100) / 100,
  }),
  negative_share_pct_30d: async () => ({
    value: round1(await num(`SELECT CASE WHEN t=0 THEN 0 ELSE neg*100.0/t END v FROM (
      SELECT COUNT(*) t, COUNT(*) FILTER (WHERE "sentimentLabel"='NEG') neg
      FROM osint_signals WHERE canonical = true AND "reviewStatus" <> 'REJECTED' AND "fetchedAt" >= now() - interval '30 days') x`)),
  }),
  press_published_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM press_items WHERE status='PUBLISHED'
      AND COALESCE("publishedAt","createdAt") >= now() - interval '30 days'`),
  }),

  // ── EVENTS ──
  event_regs_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM event_registrations WHERE "createdAt" >= now() - interval '30 days'`),
  }),
  attend_rate_pct_90d: async () => ({
    value: round1(await num(`SELECT CASE WHEN t=0 THEN 0 ELSE att*100.0/t END v FROM (
      SELECT COUNT(*) FILTER (WHERE status='ATTENDED') att, COUNT(*) FILTER (WHERE status IN ('ATTENDED','NO_SHOW')) t
      FROM event_registrations WHERE "createdAt" >= now() - interval '90 days') x`)),
  }),

  // ── CUSTOMER ──
  customers_active: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM customers WHERE status='ACTIVE'`),
    slices: await dim(`SELECT status d, COUNT(*)::float8 v FROM customers GROUP BY status`, "status"),
  }),
  nps_90d: async () => ({
    value: await num(`SELECT CASE WHEN t=0 THEN 0 ELSE ROUND((p-d2)*100.0/t) END v FROM (
      SELECT COUNT(*) FILTER (WHERE r.score >= 9) p, COUNT(*) FILTER (WHERE r.score <= 6 AND r.score IS NOT NULL) d2, COUNT(*) t
      FROM survey_responses r JOIN surveys s ON s.id = r."surveyId"
      WHERE s.kind='NPS' AND r."createdAt" >= now() - interval '90 days') x`),
  }),
  csat_avg_90d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG(score),0)::float8 v FROM feedback WHERE "createdAt" >= now() - interval '90 days'`)),
  }),

  // ── RESEARCH ──
  survey_responses_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM survey_responses WHERE "createdAt" >= now() - interval '30 days'`),
  }),
  insights_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM insights WHERE "createdAt" >= now() - interval '30 days'`),
    slices: await dim(`SELECT impact d, COUNT(*)::float8 v FROM insights WHERE "createdAt" >= now() - interval '30 days' GROUP BY impact`, "impact"),
  }),

  // ── OPS (studio · agency · money) ──
  creative_cycle_days_90d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM "updatedAt" - "createdAt")/86400),0)::float8 v
      FROM creative_requests WHERE status='DONE' AND "updatedAt" >= now() - interval '90 days'`)),
  }),
  studio_sla_hit_pct_90d: async () => ({
    value: round1(await num(`SELECT CASE WHEN t=0 THEN 0 ELSE hit*100.0/t END v FROM (
      SELECT COUNT(*) t, COUNT(*) FILTER (WHERE "updatedAt" <= "slaDueAt") hit
      FROM creative_requests WHERE status='DONE' AND "slaDueAt" IS NOT NULL AND "updatedAt" >= now() - interval '90 days') x`)),
  }),
  vendor_ontime_pct_90d: async () => ({
    value: round1(await num(`SELECT CASE WHEN t=0 THEN 0 ELSE ontime*100.0/t END v FROM (
      SELECT COUNT(*) t, COUNT(*) FILTER (WHERE "approvedAt" <= "dueDate") ontime
      FROM deliverables WHERE status='APPROVED' AND "approvedAt" IS NOT NULL AND "dueDate" IS NOT NULL
      AND "approvedAt" >= now() - interval '90 days') x`)),
  }),
  revision_rounds_avg_90d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG("revisionCount"),0)::float8 v FROM deliverables
      WHERE status='APPROVED' AND "approvedAt" >= now() - interval '90 days'`)),
  }),
  invoice_cycle_days_90d: async () => ({
    value: round1(await num(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM "paidAt" - "createdAt")/86400),0)::float8 v
      FROM invoices WHERE "paidAt" IS NOT NULL AND "paidAt" >= now() - interval '90 days'`)),
  }),
  budget_utilization_pct: async () => ({
    value: round1(await num(`SELECT CASE WHEN p=0 THEN 0 ELSE s*100.0/p END v FROM (
      SELECT COALESCE(SUM("amountUsd") FILTER (WHERE kind='PLANNED'),0) p,
             COALESCE(SUM("amountUsd") FILTER (WHERE kind='SPENT'),0) s
      FROM budget_entries WHERE "createdAt" >= date_trunc('year', now())) t`)),
  }),

  // ── PUBLISH ──
  posts_scheduled_7d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM scheduled_posts
      WHERE status IN ('QUEUED','AWAITING_APPROVAL','READY','NOTIFIED')
      AND "scheduledAt" BETWEEN now() AND now() + interval '7 days'`),
  }),
  publish_ontime_pct_30d: async () => ({
    value: round1(await num(`SELECT CASE WHEN t=0 THEN 0 ELSE hit*100.0/t END v FROM (
      SELECT COUNT(*) t, COUNT(*) FILTER (WHERE p."publishedAt" <= sp."scheduledAt" + interval '24 hours') hit
      FROM scheduled_posts sp JOIN posts p ON p.id = sp."publishedPostId"
      WHERE sp.status = 'PUBLISHED' AND p."publishedAt" >= now() - interval '30 days') x`)),
  }),
  bio_taps_total: async () => ({
    value: await num(`SELECT COALESCE(SUM(tl.clicks),0)::float8 v FROM bio_links bl
      JOIN tracked_links tl ON tl.code = bl."linkCode" WHERE bl.active = true`),
    slices: await dim(`SELECT p.slug d, COALESCE(SUM(tl.clicks),0)::float8 v FROM bio_links bl
      JOIN tracked_links tl ON tl.code = bl."linkCode"
      JOIN bio_pages p ON p.id = bl."pageId"
      WHERE bl.active = true GROUP BY p.slug`, "page"),
  }),

  // ── AUTOMATE ──
  workflow_runs_7d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM workflow_runs WHERE "createdAt" >= now() - interval '7 days'`),
  }),
  hot_leads_open: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM leads WHERE score >= 70 AND stage NOT IN ('WON','LOST')`),
  }),
  wa_sends_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM lead_activities WHERE kind = 'WA' AND "createdAt" >= now() - interval '30 days'`),
  }),

  // ── REACH ──
  outreach_sent_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM outreach_touches WHERE "sentAt" >= now() - interval '30 days'`),
  }),
  outreach_reply_rate_30d: async () => {
    const r = await get(`SELECT COUNT(*) FILTER (WHERE status IN ('REPLIED','PLACED'))::float8 w,
                                COUNT(*)::float8 s
                         FROM outreach_touches WHERE "sentAt" >= now() - interval '30 days'`);
    return { value: r?.s > 0 ? (r.w / r.s) * 100 : 0 };
  },
  media_cold_count: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM media_contacts
                      WHERE "lastContactAt" IS NULL OR "lastContactAt" < now() - interval '90 days'`),
  }),

  // ── CONNECT ──
  web_pageviews_7d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM web_events WHERE kind = 'PAGEVIEW' AND at >= now() - interval '7 days'`),
  }),
  ad_spend_30d: async () => ({
    value: await num(`SELECT COALESCE(SUM("amountUsd"),0)::float8 v FROM ad_spend WHERE date >= CURRENT_DATE - 30`),
  }),
  promo_redemptions_total: async () => ({
    value: await num(`SELECT COALESCE(SUM(redemptions),0)::float8 v FROM promotions`),
  }),
  inbox_open: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM inbox_items WHERE status = 'OPEN'`),
  }),
  emails_sent_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM mail_log WHERE status IN ('SENT','LOGGED') AND "sentAt" >= now() - interval '30 days'`),
  }),
  wa_sent_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM integration_runs WHERE platform = 'WA' AND kind = 'SEND' AND status = 'OK' AND at >= now() - interval '30 days'`),
  }),
  inbox_api_7d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM inbox_items WHERE via = 'API' AND "receivedAt" >= now() - interval '7 days'`),
  }),
  autopublished_30d: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM scheduled_posts WHERE status = 'PUBLISHED' AND "externalUrl" IS NOT NULL AND "updatedAt" >= now() - interval '30 days'`),
  }),
  synced_spend_30d: async () => ({
    value: await num(`SELECT COALESCE(SUM("amountUsd"),0)::float8 v FROM ad_spend WHERE source = 'SYNC' AND date >= CURRENT_DATE - 30`),
  }),
  signal_precision_30d: async () => ({
    value: await num(`SELECT CASE WHEN COUNT(*) FILTER (WHERE "reviewStatus" IN ('CONFIRMED','REJECTED')) = 0 THEN 100
                      ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE "reviewStatus" = 'CONFIRMED')
                           / NULLIF(COUNT(*) FILTER (WHERE "reviewStatus" IN ('CONFIRMED','REJECTED')),0), 1) END::float8 v
                      FROM osint_signals WHERE "fetchedAt" >= now() - interval '30 days'`),
  }),
  corroborated_share_30d: async () => ({
    value: await num(`SELECT CASE WHEN COUNT(*) = 0 THEN 0
                      ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE "syndicationCount" > 1) / COUNT(*), 1) END::float8 v
                      FROM osint_signals WHERE canonical = true AND "reviewStatus" <> 'REJECTED'
                        AND "fetchedAt" >= now() - interval '30 days'`),
  }),
  storage_used_mb: async () => ({
    value: Math.round(await num(`SELECT COALESCE(SUM(size),0)::float8 / 1048576 v FROM files`) * 10) / 10,
  }),
  entity_resolution_rate_30d: async () => ({
    value: Math.round(await num(
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE "entityCount" > 0)::float8 / COUNT(*) * 100 END v
       FROM osint_signals WHERE canonical = true AND "reviewStatus" <> 'REJECTED'
         AND "fetchedAt" >= now() - interval '30 days'`) * 10) / 10,
  }),
  sentiment_abstention_30d: async () => ({
    value: Math.round(await num(
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE "sentimentConfidence" < 0.4)::float8 / COUNT(*) * 100 END v
       FROM osint_signal_entities se JOIN osint_signals s ON s.id = se."signalId"
       WHERE s."fetchedAt" >= now() - interval '30 days'`) * 10) / 10,
  }),
  evidence_preserved_30d: async () => ({
    value: Math.round(await num(
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE "snapshotFileId" IS NOT NULL)::float8 / COUNT(*) * 100 END v
       FROM osint_signals WHERE canonical = true AND "reviewStatus" = 'CONFIRMED'
         AND "fetchedAt" >= now() - interval '30 days'`) * 10) / 10,
  }),
  uncorroborated_share_30d: async () => ({
    value: Math.round(await num(
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE corroborated = false)::float8 / COUNT(*) * 100 END v
       FROM osint_signals WHERE canonical = true AND "reviewStatus" <> 'REJECTED'
         AND "fetchedAt" >= now() - interval '30 days'`) * 10) / 10,
  }),
  error_rate_24h: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM error_log WHERE level <> 'CLIENT' AND at >= now() - interval '24 hours'`),
  }),
  search_spend_30d: async () => ({
    value: Math.round(await num(
      `SELECT COALESCE(SUM("costUsd"),0)::float8 v FROM search_runs WHERE at >= now() - interval '30 days'`) * 100) / 100,
  }),
  live_signal_share_30d: async () => ({
    value: Math.round(await num(
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE "sourceType" IN ('SEARCH','REDDIT','YOUTUBE','X'))::float8 / COUNT(*) * 100 END v
       FROM osint_signals WHERE "fetchedAt" >= now() - interval '30 days'`) * 10) / 10,
  }),
  themes_active: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM osint_themes WHERE status <> 'DISMISSED' AND "createdAt" >= now() - interval '30 days'`),
  }),
  ai_relevance_agreement_pct: async () => ({
    value: await num(
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE
         COUNT(*) FILTER (WHERE ("reviewStatus" = 'CONFIRMED' AND "aiVerdict" = 'RELEVANT')
                             OR ("reviewStatus" = 'REJECTED' AND "aiVerdict" = 'NOT_RELEVANT'))::float8
         / COUNT(*) * 100 END v
       FROM osint_signals
       WHERE "aiVerdict" IN ('RELEVANT','NOT_RELEVANT') AND "reviewStatus" IN ('CONFIRMED','REJECTED')
         AND "fetchedAt" >= now() - interval '30 days'`),
  }),
  forecast_accuracy_30d: async () => {
    // Measured by back-test, not asserted: forecast from a week ago,
    // compare against what actually happened.
    const { backtestAccuracy } = await import("./forecast.js");
    const row = await get(
      `SELECT "metricKey" FROM metric_snapshots WHERE dims = '{}'::jsonb
       GROUP BY "metricKey" ORDER BY COUNT(*) DESC LIMIT 1`);
    if (!row) return { value: 0 };
    const r = await backtestAccuracy(row.metricKey);
    return { value: r.ok ? Math.max(0, 100 - r.mape) : 0 };
  },
  mmm_readiness_pct: async () => ({
    value: Math.min(100, Math.round(await num(
      `SELECT COUNT(*)::float8 / 80 * 100 v FROM mmm_weeks WHERE completeness >= 0.5`))),
  }),
  mmm_holdout_error: async () => ({
    value: await num(
      `SELECT COALESCE((diagnostics->>'holdoutMape')::float8, 0) v FROM mmm_runs
       ORDER BY "createdAt" DESC LIMIT 1`),
  }),
  referral_leads_total: async () => ({
    value: await num(`SELECT COUNT(*)::float8 v FROM referrals WHERE "referredLeadId" IS NOT NULL`),
  }),
};

// ── The catalog: metadata mirrored into the `metrics` table ──────────
const M = (key, name, nameAr, category, unit, direction, description, descriptionAr, extra = {}) =>
  ({ key, name, nameAr, category, unit, direction, description, descriptionAr, source: { kind: "builtin" }, ...extra });
const C = (key, name, nameAr, components, description, descriptionAr) =>
  ({ key, name, nameAr, category: "PULSE", unit: "score", direction: "HIGHER", description, descriptionAr,
     source: { kind: "composite", components } });

export const CATALOG = [
  M("leads_new_30d", "New leads (30d)", "عملاء محتملون جدد (٣٠ يومًا)", "DEMAND", "count", "HIGHER",
    "Leads created in the last 30 days.", "العملاء المحتملون المنشأون خلال آخر ٣٠ يومًا.", { dimensions: ["source", "campaign"] }),
  M("pipeline_value", "Open pipeline (USD)", "قيمة خط المبيعات المفتوح", "DEMAND", "usd", "HIGHER",
    "Total USD value of leads not yet won or lost.", "القيمة الدولارية للعملاء المحتملين غير المحسومين."),
  M("won_value_30d", "Won value (30d)", "قيمة الصفقات المكسوبة (٣٠ يومًا)", "DEMAND", "usd", "HIGHER",
    "USD value of deals won in the last 30 days.", "قيمة الصفقات المكسوبة خلال آخر ٣٠ يومًا."),
  M("won_count_30d", "Deals won (30d)", "صفقات مكسوبة (٣٠ يومًا)", "DEMAND", "count", "HIGHER",
    "Deals moved to WON in the last 30 days.", "الصفقات المنقولة إلى مكسوبة خلال ٣٠ يومًا."),
  M("win_rate_90d", "Win rate % (90d)", "نسبة الكسب ٪ (٩٠ يومًا)", "DEMAND", "pct", "HIGHER",
    "WON / (WON + LOST) over stage changes in 90 days.", "المكسوب ÷ (المكسوب + المفقود) خلال ٩٠ يومًا."),
  M("avg_deal_usd_90d", "Avg deal size (90d)", "متوسط حجم الصفقة (٩٠ يومًا)", "DEMAND", "usd", "HIGHER",
    "Average USD value of deals won in 90 days.", "متوسط قيمة الصفقات المكسوبة خلال ٩٠ يومًا."),
  M("sales_velocity_days_90d", "Sales velocity (days)", "سرعة البيع (أيام)", "DEMAND", "days", "LOWER",
    "Average days from lead creation to WON (90d).", "متوسط الأيام من إنشاء العميل حتى الكسب (٩٠ يومًا)."),
  M("leads_stale_pct", "Stale open leads %", "نسبة العملاء الراكدين ٪", "DEMAND", "pct", "LOWER",
    "Open leads untouched for 14+ days.", "عملاء مفتوحون بلا تحديث منذ ١٤ يومًا أو أكثر."),
  M("cpl_usd_30d", "Cost per lead (30d)", "تكلفة العميل المحتمل (٣٠ يومًا)", "DEMAND", "usd", "LOWER",
    "Spend ÷ new leads over 30 days.", "الإنفاق ÷ العملاء الجدد خلال ٣٠ يومًا."),
  M("conversions_value_30d", "Realised value (30d)", "القيمة المحققة (٣٠ يومًا)", "DEMAND", "usd", "HIGHER",
    "Money actually recorded as converted in the last 30 days.", "الأموال المسجلة فعليًا كتحويلات خلال آخر ٣٠ يومًا.", { dimensions: ["campaign"] }),
  M("marketing_roi_90d", "Marketing ROI % (90d)", "عائد التسويق ٪ (٩٠ يومًا)", "DEMAND", "pct", "HIGHER",
    "Realised value minus spend, over spend, across 90 days.", "القيمة المحققة ناقص الإنفاق، مقسومة على الإنفاق، خلال ٩٠ يومًا."),
  M("lead_followup_sla_pct_30d", "Follow-up on time % (30d)", "الالتزام بموعد المتابعة ٪ (٣٠ يومًا)", "DEMAND", "pct", "HIGHER",
    "Assigned leads contacted before their follow-up deadline.", "العملاء المسندون الذين جرى التواصل معهم قبل الموعد المحدد."),
  M("campaigns_active", "Active campaigns", "حملات نشطة", "DEMAND", "count", "HIGHER",
    "Campaigns currently in the ACTIVE state.", "الحملات في حالة نشطة حاليًا."),
  M("leads_lost_30d", "Leads lost (30d)", "عملاء مفقودون (٣٠ يومًا)", "DEMAND", "count", "LOWER",
    "Deals moved to LOST in 30 days, sliced by reason.", "الصفقات المفقودة خلال ٣٠ يومًا حسب السبب.", { dimensions: ["lostReason"] }),
  M("romi_pct_90d", "ROMI % (90d)", "عائد الاستثمار التسويقي ٪ (٩٠ يومًا)", "DEMAND", "pct", "HIGHER",
    "(Won value − spend) ÷ spend over 90 days.", "(قيمة المكسوب − الإنفاق) ÷ الإنفاق خلال ٩٠ يومًا."),

  M("link_clicks_total", "Link clicks (all-time)", "نقرات الروابط (تراكمي)", "ACQUISITION", "cumulative", "HIGHER",
    "Cumulative tracked-link clicks; snapshots reveal the trend.", "نقرات الروابط المتتبعة تراكميًا؛ اللقطات تكشف الاتجاه.", { dimensions: ["channel"] }),
  M("form_submissions_30d", "Form submissions (30d)", "إرسالات النماذج (٣٠ يومًا)", "ACQUISITION", "count", "HIGHER",
    "Public form submissions in 30 days.", "إرسالات النماذج العامة خلال ٣٠ يومًا.", { dimensions: ["form"] }),
  M("form_leads_30d", "Leads from forms (30d)", "عملاء من النماذج (٣٠ يومًا)", "ACQUISITION", "count", "HIGHER",
    "Submissions that created a lead.", "الإرسالات التي أنشأت عميلًا محتملًا."),
  M("form_cvr_pct_30d", "Form→lead CVR % (30d)", "تحويل النموذج إلى عميل ٪", "ACQUISITION", "pct", "HIGHER",
    "Share of submissions that became leads.", "نسبة الإرسالات التي تحوّلت إلى عملاء."),
  M("landing_views_total", "Landing views (all-time)", "مشاهدات صفحات الهبوط (تراكمي)", "ACQUISITION", "cumulative", "HIGHER",
    "Cumulative landing-page views.", "مشاهدات صفحات الهبوط تراكميًا."),

  M("posts_published_30d", "Posts published (30d)", "منشورات (٣٠ يومًا)", "CONTENT", "count", "HIGHER",
    "Posts logged in 30 days.", "المنشورات المسجلة خلال ٣٠ يومًا.", { dimensions: ["platform"] }),
  M("reach_30d", "Reach (30d)", "الوصول (٣٠ يومًا)", "CONTENT", "count", "HIGHER",
    "Total reach across posts in 30 days.", "إجمالي الوصول عبر المنشورات خلال ٣٠ يومًا."),
  M("er_pct_30d", "Engagement rate % (30d)", "معدل التفاعل ٪ (٣٠ يومًا)", "CONTENT", "pct", "HIGHER",
    "Engagement ÷ reach across posts.", "التفاعل ÷ الوصول عبر المنشورات.", { dimensions: ["platform"] }),
  M("content_backlog", "Content backlog", "المحتوى قيد العمل", "CONTENT", "count", "LOWER",
    "Content items not yet published.", "عناصر المحتوى غير المنشورة بعد."),
  M("approval_turnaround_h_30d", "Approval turnaround (h)", "زمن الاعتماد (ساعات)", "CONTENT", "hours", "LOWER",
    "Average hours from request to decision (30d).", "متوسط الساعات من الطلب حتى القرار (٣٠ يومًا)."),

  M("mentions_30d", "Mentions (30d)", "الإشارات (٣٠ يومًا)", "BRAND", "count", "HIGHER",
    "Listening signals captured in 30 days.", "إشارات الرصد الملتقطة خلال ٣٠ يومًا.", { dimensions: ["sentiment"] }),
  M("sentiment_avg_30d", "Avg sentiment (−1..1)", "متوسط الانطباع (−١..١)", "BRAND", "score", "HIGHER",
    "Average sentiment of mentions.", "متوسط انطباع الإشارات."),
  M("negative_share_pct_30d", "Negative share % (30d)", "نسبة السلبي ٪ (٣٠ يومًا)", "BRAND", "pct", "LOWER",
    "Share of mentions labeled negative.", "نسبة الإشارات السلبية."),
  M("press_published_30d", "Press placements (30d)", "تغطيات صحفية (٣٠ يومًا)", "BRAND", "count", "HIGHER",
    "Press items published in 30 days.", "التغطيات المنشورة خلال ٣٠ يومًا."),

  M("event_regs_30d", "Event registrations (30d)", "تسجيلات الفعاليات (٣٠ يومًا)", "EVENTS", "count", "HIGHER",
    "Registrations captured in 30 days.", "التسجيلات الملتقطة خلال ٣٠ يومًا."),
  M("attend_rate_pct_90d", "Attend rate % (90d)", "نسبة الحضور ٪ (٩٠ يومًا)", "EVENTS", "pct", "HIGHER",
    "ATTENDED ÷ decided registrations (90d).", "الحضور ÷ التسجيلات المحسومة (٩٠ يومًا)."),

  M("customers_active", "Active customers", "عملاء نشطون", "CUSTOMER", "count", "HIGHER",
    "Customers with ACTIVE status.", "العملاء بحالة نشط.", { dimensions: ["status"] }),
  M("nps_90d", "NPS (90d)", "مؤشر الترويج الصافي (٩٠ يومًا)", "CUSTOMER", "score", "HIGHER",
    "Promoters − detractors across NPS surveys (90d).", "المروّجون − المنتقدون عبر استبيانات NPS (٩٠ يومًا)."),
  M("csat_avg_90d", "CSAT avg (90d)", "متوسط رضا العملاء (٩٠ يومًا)", "CUSTOMER", "score", "HIGHER",
    "Average feedback score 1–5 (90d).", "متوسط تقييم الرضا ١–٥ (٩٠ يومًا)."),

  M("survey_responses_30d", "Survey responses (30d)", "استجابات الاستبيانات (٣٠ يومًا)", "RESEARCH", "count", "HIGHER",
    "Responses received in 30 days.", "الاستجابات المستلمة خلال ٣٠ يومًا."),
  M("insights_30d", "Insights created (30d)", "رؤى جديدة (٣٠ يومًا)", "RESEARCH", "count", "HIGHER",
    "Insights registered in 30 days.", "الرؤى المسجلة خلال ٣٠ يومًا.", { dimensions: ["impact"] }),

  M("creative_cycle_days_90d", "Creative cycle (days)", "دورة الإبداع (أيام)", "OPS", "days", "LOWER",
    "Average days request→done (90d).", "متوسط الأيام من الطلب حتى الإنجاز (٩٠ يومًا)."),
  M("studio_sla_hit_pct_90d", "Studio SLA hit % (90d)", "التزام SLA الاستوديو ٪", "OPS", "pct", "HIGHER",
    "Requests done within their SLA.", "الطلبات المنجزة ضمن مهلتها."),
  M("vendor_ontime_pct_90d", "Vendor on-time % (90d)", "التزام المورّدين بالمواعيد ٪", "OPS", "pct", "HIGHER",
    "Deliverables approved by their due date.", "التسليمات المعتمدة في موعدها."),
  M("revision_rounds_avg_90d", "Avg revision rounds (90d)", "متوسط جولات التعديل", "OPS", "count", "LOWER",
    "Average revisions per approved deliverable.", "متوسط التعديلات لكل تسليم معتمد."),
  M("invoice_cycle_days_90d", "Invoice cycle (days)", "دورة الفواتير (أيام)", "OPS", "days", "LOWER",
    "Average days invoice→paid (90d).", "متوسط الأيام من الفاتورة حتى السداد (٩٠ يومًا)."),
  M("budget_utilization_pct", "Budget utilization % (YTD)", "استغلال الميزانية ٪ (السنة)", "OPS", "pct", "HIGHER",
    "Spent ÷ planned this year.", "المصروف ÷ المخطط هذه السنة."),

  M("posts_scheduled_7d", "Queue runway (7d)", "مدرج النشر (٧ أيام)", "PUBLISH", "count", "HIGHER",
    "Slots queued for the coming week.", "الفتحات المجدولة للأسبوع القادم."),
  M("publish_ontime_pct_30d", "Publish on-time % (30d)", "الالتزام بمواعيد النشر ٪", "PUBLISH", "pct", "HIGHER",
    "Published within 24h of the slot.", "نُشر خلال ٢٤ ساعة من الموعد."),
  M("bio_taps_total", "Bio-page taps (all-time)", "نقرات صفحة البايو (تراكمي)", "PUBLISH", "cumulative", "HIGHER",
    "Attributed taps across bio links.", "نقرات موثّقة عبر روابط البايو.", { dimensions: ["page"] }),

  M("workflow_runs_7d", "Automation runs (7d)", "تشغيلات الأتمتة (٧ أيام)", "AUTOMATE", "count", "HIGHER",
    "Workflow executions in the last week.", "تنفيذات مسارات الأتمتة خلال أسبوع."),
  M("hot_leads_open", "Hot open leads", "عملاء ساخنون مفتوحون", "AUTOMATE", "count", "HIGHER",
    "Open leads scoring 70+.", "عملاء مفتوحون بنقاط ٧٠ فأكثر."),
  M("wa_sends_30d", "WhatsApp sends (30d)", "إرسالات واتساب (٣٠ يومًا)", "AUTOMATE", "count", "HIGHER",
    "Template sends logged on leads.", "إرسالات القوالب المسجلة على العملاء."),

  M("outreach_sent_30d", "Outreach touches sent (30d)", "لمسات تواصل مُرسلة (٣٠ يومًا)", "REACH", "count", "HIGHER",
    "Sequence touches marked sent.", "لمسات المتابعة المُرسلة."),
  M("outreach_reply_rate_30d", "Outreach reply rate (30d)", "معدل الرد على التواصل (٣٠ يومًا)", "REACH", "pct", "HIGHER",
    "Replies + placements over sent touches.", "الردود والتغطيات نسبةً إلى المُرسل."),
  M("media_cold_count", "Cold media relationships", "علاقات إعلامية باردة", "REACH", "count", "LOWER",
    "Journalists untouched for 90+ days.", "صحفيون بلا تواصل منذ ٩٠+ يومًا."),

  M("web_pageviews_7d", "Site pageviews (7d)", "مشاهدات الموقع (٧ أيام)", "CONNECT", "count", "HIGHER",
    "pulse.js pageviews across registered sites.", "مشاهدات pulse.js عبر المواقع المسجلة."),
  M("ad_spend_30d", "Paid ad spend (30d)", "إنفاق إعلاني مدفوع (٣٠ يومًا)", "CONNECT", "usd", "LOWER",
    "Manual paid spend entries in the window.", "الإنفاق المدفوع المسجل في الفترة."),
  M("promo_redemptions_total", "Promo redemptions", "استخدامات العروض", "CONNECT", "count", "HIGHER",
    "Total redemptions across promotions.", "إجمالي استخدام أكواد العروض."),
  M("inbox_open", "Open inbox items", "وارد اجتماعي مفتوح", "CONNECT", "count", "LOWER",
    "Social interactions awaiting a reply.", "تفاعلات اجتماعية بانتظار الرد."),
  M("emails_sent_30d", "Digest emails (30d)", "رسائل الموجز (٣٠ يومًا)", "CONNECT", "count", "HIGHER",
    "Morning Pulse and test emails dispatched.", "رسائل صباح النبض والرسائل التجريبية المُرسلة."),
  M("wa_sent_30d", "WhatsApp messages sent (30d)", "رسائل واتساب مُرسلة (٣٠ يومًا)", "CONNECT", "count", "HIGHER",
    "Messages dispatched through the WhatsApp Business API.", "الرسائل المُرسلة عبر واجهة واتساب للأعمال."),
  M("inbox_api_7d", "Auto-captured interactions (7d)", "تفاعلات ملتقطة تلقائيًا (٧ أيام)", "CONNECT", "count", "HIGHER",
    "Inbox items ingested by connectors rather than typed in.", "عناصر وارد وصلت عبر التكاملات بدل الإدخال اليدوي."),
  M("autopublished_30d", "Auto-published posts (30d)", "منشورات نُشرت تلقائيًا (٣٠ يومًا)", "CONNECT", "count", "HIGHER",
    "Scheduled posts published straight to the platform.", "منشورات مجدولة نُشرت مباشرة عبر المنصة."),
  M("synced_spend_30d", "API-synced ad spend (30d)", "إنفاق مُزامن آليًا (٣٠ يومًا)", "CONNECT", "usd", "LOWER",
    "Paid spend pulled from platform APIs rather than typed in.", "إنفاق مسحوب من واجهات المنصات بدل الإدخال اليدوي."),
  M("signal_precision_30d", "Listening precision (30d)", "دقة الرصد (٣٠ يومًا)", "INTEL", "pct", "HIGHER",
    "Share of reviewed signals an analyst confirmed as relevant.", "نسبة الإشارات التي أكّد المحلل صلتها بعد المراجعة."),
  M("corroborated_share_30d", "Corroborated stories (30d)", "أخبار مؤكدة بمصادر متعددة (٣٠ يومًا)", "INTEL", "pct", "HIGHER",
    "Share of stories carried by more than one source.", "نسبة الأخبار التي نقلها أكثر من مصدر واحد."),
  M("storage_used_mb", "Stored files (MB)", "المساحة المستخدمة (ميغابايت)", "CONNECT", "count", "LOWER",
    "Total size of uploaded assets and evidence.", "الحجم الكلي للملفات المرفوعة والأدلة المحفوظة."),
  M("entity_resolution_rate_30d", "Mentions resolved to entities (30d)", "إشارات مرتبطة بكيانات (٣٠ يومًا)", "INTEL", "pct", "HIGHER",
    "Share of kept signals matched to a known organisation or brand.", "نسبة الإشارات المرتبطة بمؤسسة أو علامة معروفة."),
  M("sentiment_abstention_30d", "Sentiment marked unclear (30d)", "مشاعر غير محسومة (٣٠ يومًا)", "INTEL", "pct", "LOWER",
    "Where the reading abstained rather than guessing.", "الحالات التي امتنع فيها التحليل عن الحكم بدل التخمين."),
  M("evidence_preserved_30d", "Confirmed stories archived (30d)", "أدلة محفوظة للأخبار المؤكدة (٣٠ يومًا)", "INTEL", "pct", "HIGHER",
    "Confirmed signals with an immutable snapshot kept.", "الإشارات المؤكدة المحفوظة بنسخة موثّقة."),
  M("uncorroborated_share_30d", "Single-source stories (30d)", "أخبار بمصدر واحد (٣٠ يومًا)", "INTEL", "pct", "LOWER",
    "Share of kept stories no second independent source carried.", "نسبة الأخبار التي لم يحملها مصدر مستقل ثانٍ."),
  M("error_rate_24h", "Server faults (24h)", "أعطال الخادم (٢٤ ساعة)", "CONNECT", "count", "LOWER",
    "Errors recorded in the last day.", "الأخطاء المسجلة خلال اليوم الماضي."),
  M("search_spend_30d", "Live search spend (30d)", "تكلفة البحث المباشر (٣٠ يومًا)", "INTEL", "usd", "LOWER",
    "What metered searches cost this period.", "تكلفة عمليات البحث المدفوعة خلال الفترة."),
  M("live_signal_share_30d", "Signals from live search (30d)", "إشارات من البحث المباشر (٣٠ يومًا)", "INTEL", "pct", "HIGHER",
    "Share of signals gathered live rather than from feeds.", "نسبة الإشارات المجمّعة مباشرة بدل التغذيات."),
  M("themes_active", "Active themes (30d)", "المواضيع المتكررة (٣٠ يومًا)", "INTEL", "count", "HIGHER",
    "Recurring themes found in coverage.", "المواضيع المتكررة المرصودة في التغطية."),
  M("ai_relevance_agreement_pct", "AI agrees with analysts (30d)", "توافق المساعد مع المحللين (٣٠ يومًا)", "INTEL", "pct", "HIGHER",
    "How often the model's verdict matched the analyst's ruling.", "نسبة توافق حكم المساعد مع حكم المحلل."),
  M("forecast_accuracy_30d", "Forecast accuracy (back-tested)", "دقة التوقّع (مُختبرة رجعيًا)", "ANALYTICS", "pct", "HIGHER",
    "How close last week's forecast was to what happened.", "مدى قرب توقّع الأسبوع الماضي مما حدث فعلًا."),
  M("mmm_readiness_pct", "Media-mix readiness", "جاهزية نموذج مزيج الوسائط", "ANALYTICS", "pct", "HIGHER",
    "How close the data is to supporting a trustworthy media-mix model.", "مدى اقتراب البيانات من دعم نموذج مزيج وسائط موثوق."),
  M("mmm_holdout_error", "Media-mix holdout error", "خطأ النموذج على بيانات محجوزة", "ANALYTICS", "pct", "LOWER",
    "How wrong the last fit was on data it never saw.", "مدى خطأ آخر نموذج على بيانات لم يرها."),
  M("referral_leads_total", "Referral-sourced leads", "عملاء عبر الإحالات", "CONNECT", "count", "HIGHER",
    "Leads attached to customer referrals.", "عملاء محتملون مرتبطون بإحالات العملاء."),

  // ── The Pulse Index and its area pulses ──
  C("pulse_demand", "Demand pulse", "نبض الطلب", [
    { key: "leads_new_30d", weight: 0.3, min: 0, max: 40 },
    { key: "win_rate_90d", weight: 0.3, min: 0, max: 60 },
    { key: "pipeline_value", weight: 0.25, min: 0, max: 100000 },
    { key: "cpl_usd_30d", weight: 0.15, min: 0, max: 500 },
  ], "Demand & pipeline health, 0–100.", "صحة الطلب وخط المبيعات، ٠–١٠٠."),
  C("pulse_engagement", "Engagement pulse", "نبض التفاعل", [
    { key: "er_pct_30d", weight: 0.3, min: 0, max: 8 },
    { key: "posts_published_30d", weight: 0.25, min: 0, max: 30 },
    { key: "reach_30d", weight: 0.25, min: 0, max: 200000 },
    { key: "form_cvr_pct_30d", weight: 0.2, min: 0, max: 60 },
  ], "Content & acquisition engagement, 0–100.", "تفاعل المحتوى والاستقطاب، ٠–١٠٠."),
  C("pulse_brand", "Brand pulse", "نبض العلامة", [
    { key: "sentiment_avg_30d", weight: 0.35, min: -1, max: 1 },
    { key: "mentions_30d", weight: 0.25, min: 0, max: 80 },
    { key: "negative_share_pct_30d", weight: 0.25, min: 0, max: 50 },
    { key: "press_published_30d", weight: 0.15, min: 0, max: 10 },
  ], "Share of voice & sentiment, 0–100.", "حضور العلامة والانطباع، ٠–١٠٠."),
  C("pulse_customer", "Customer pulse", "نبض العملاء", [
    { key: "nps_90d", weight: 0.35, min: -100, max: 100 },
    { key: "csat_avg_90d", weight: 0.3, min: 1, max: 5 },
    { key: "attend_rate_pct_90d", weight: 0.2, min: 0, max: 100 },
    { key: "customers_active", weight: 0.15, min: 0, max: 50 },
  ], "Loyalty & satisfaction, 0–100.", "الولاء والرضا، ٠–١٠٠."),
  C("pulse_ops", "Ops pulse", "نبض العمليات", [
    { key: "studio_sla_hit_pct_90d", weight: 0.3, min: 0, max: 100 },
    { key: "vendor_ontime_pct_90d", weight: 0.25, min: 0, max: 100 },
    { key: "budget_utilization_pct", weight: 0.25, min: 0, max: 100 },
    { key: "invoice_cycle_days_90d", weight: 0.2, min: 0, max: 30 },
  ], "Delivery discipline & money hygiene, 0–100.", "انضباط التنفيذ وصحة الميزانية، ٠–١٠٠."),
  C("pulse_index", "Pulse Index", "مؤشر النبض", [
    { key: "pulse_demand", weight: 0.25, min: 0, max: 100 },
    { key: "pulse_engagement", weight: 0.2, min: 0, max: 100 },
    { key: "pulse_brand", weight: 0.2, min: 0, max: 100 },
    { key: "pulse_customer", weight: 0.2, min: 0, max: 100 },
    { key: "pulse_ops", weight: 0.15, min: 0, max: 100 },
  ], "One number for how marketing is doing, really — weighted composite of the five area pulses; every component drills down.",
     "رقم واحد يجيب: كيف حال التسويق فعلًا؟ — مركّب موزون من نبضات المجالات الخمسة، وكل مكوّن قابل للتفصيل."),
];

/** Mirror the catalog into the DB (insert-only; admin edits survive). */
export async function ensureCatalog() {
  for (const m of CATALOG) {
    await run(
      `INSERT INTO metrics (key, name, "nameAr", category, source, unit, direction, dimensions, description, "descriptionAr")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (key) DO NOTHING`,
      [m.key, m.name, m.nameAr, m.category, JSON.stringify(m.source), m.unit, m.direction,
       JSON.stringify(m.dimensions || []), m.description, m.descriptionAr]
    );
  }
}

const parseJ = (v, fb) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? fb); } catch { return fb; } };

async function currentTarget(metricKey) {
  const t = await get(
    `SELECT target FROM metric_targets WHERE "metricKey" = $1 AND dims = '{}'::jsonb
     AND "periodStart" <= CURRENT_DATE AND "periodEnd" >= CURRENT_DATE ORDER BY "createdAt" DESC LIMIT 1`, [metricKey]);
  return t ? Number(t.target) : null;
}

/** Normalize one composite component to 0–100 (target-aware, direction-aware). */
export async function scoreComponent(comp, direction, value) {
  const target = await currentTarget(comp.key);
  if (target !== null && target !== 0) {
    return direction === "LOWER"
      ? (value <= target ? 100 : clamp((target / value) * 100))
      : clamp((value / target) * 100);
  }
  const min = comp.min ?? 0, max = comp.max ?? 100, span = max - min || 1;
  return direction === "LOWER" ? clamp(((max - value) / span) * 100) : clamp(((value - min) / span) * 100);
}

async function latestValue(key, depth) {
  const snap = await get(
    `SELECT value FROM metric_snapshots WHERE "metricKey" = $1 AND dims = '{}'::jsonb AND date = CURRENT_DATE`, [key]);
  if (snap) return Number(snap.value);
  return (await computeMetric(key, depth)).value;
}

/** Compute a metric's live value (builtin via registry, composite via components). */
export async function computeMetric(key, depth = 0) {
  if (depth > 3) return { value: 0 };
  const row = await get(`SELECT * FROM metrics WHERE key = $1`, [key]);
  const source = parseJ(row?.source, { kind: "builtin" });
  if (source.kind === "composite") {
    const comps = [];
    let acc = 0, wsum = 0;
    for (const comp of source.components || []) {
      const cRow = await get(`SELECT direction FROM metrics WHERE key = $1`, [comp.key]);
      const value = await latestValue(comp.key, depth + 1);
      const score = await scoreComponent(comp, cRow?.direction || "HIGHER", value);
      comps.push({ key: comp.key, value, score: Math.round(score), weight: comp.weight });
      acc += score * (comp.weight ?? 1); wsum += comp.weight ?? 1;
    }
    return { value: wsum ? Math.round(acc / wsum) : 0, components: comps };
  }
  const fn = COMPUTE[key];
  if (!fn) return { value: 0 };
  return await fn();
}

/** Nightly materialization: one row per metric × slice × day. */
export async function snapshotAll() {
  await ensureCatalog();
  const rows = await all(`SELECT key, source FROM metrics WHERE active = true`);
  const isComposite = (m) => parseJ(m.source, {}).kind === "composite";
  let written = 0;
  const upsert = async (key, dims, value) => {
    await run(
      `INSERT INTO metric_snapshots ("metricKey", dims, date, value) VALUES ($1,$2,CURRENT_DATE,$3)
       ON CONFLICT ("metricKey", dims, date) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(dims), value]);
    written++;
  };
  for (const m of rows.filter((r) => !isComposite(r))) {
    try {
      const out = await COMPUTE[m.key]?.();
      if (!out) continue;
      await upsert(m.key, {}, out.value ?? 0);
      for (const s of out.slices || []) await upsert(m.key, s.dims, s.value);
    } catch { /* one metric must never sink the run */ }
  }
  const composites = rows.filter(isComposite)
    .sort((a, b) => (a.key === "pulse_index" ? 1 : 0) - (b.key === "pulse_index" ? 1 : 0));
  for (const m of composites) {
    try { await upsert(m.key, {}, (await computeMetric(m.key)).value); } catch { /* same */ }
  }
  return written;
}

/** Nightly anomaly checks → notifications (20h dedupe per alert). */
export async function evaluateAlerts() {
  const alerts = await all(`SELECT * FROM metric_alerts WHERE active = true`);
  if (!alerts.length) return 0;
  const admins = (await all(
    `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
     WHERE u.active = true AND (r.permissions->>'admin')::boolean IS TRUE`)).map((r) => r.id);
  let fired = 0;
  for (const a of alerts) {
    if (a.lastFiredAt && Date.now() - new Date(a.lastFiredAt).getTime() < 20 * 3600 * 1000) continue;
    const dims = JSON.stringify(parseJ(a.dims, {}));
    const cur = await get(
      `SELECT value FROM metric_snapshots WHERE "metricKey" = $1 AND dims = $2::jsonb ORDER BY date DESC LIMIT 1`,
      [a.metricKey, dims]);
    if (!cur) continue;
    const value = Number(cur.value);
    let hit = false, baseline = null;
    if (a.condition === "ABOVE") hit = value > Number(a.threshold);
    else if (a.condition === "BELOW") hit = value < Number(a.threshold);
    else {
      const prev = await get(
        `SELECT value FROM metric_snapshots WHERE "metricKey" = $1 AND dims = $2::jsonb
         AND date <= CURRENT_DATE - $3::int ORDER BY date DESC LIMIT 1`,
        [a.metricKey, dims, a.windowDays]);
      if (prev && Number(prev.value) !== 0) {
        baseline = Number(prev.value);
        hit = Math.abs(((value - baseline) / baseline) * 100) >= Number(a.threshold);
      }
    }
    if (!hit) continue;
    const aud = parseJ(a.audience, []);
    await notify(aud.length ? aud : admins, "ALERT_METRIC",
      { key: a.metricKey, value, threshold: Number(a.threshold), condition: a.condition, baseline }, "/analytics");
    await run(`UPDATE metric_alerts SET "lastFiredAt" = now() WHERE id = $1`, [a.id]);
    fired++;
  }
  return fired;
}

/** Actual vs target vs pace for one target row. */
export async function paceFor(t) {
  const dims = JSON.stringify(parseJ(t.dims, {}));
  const snap = await get(
    `SELECT value FROM metric_snapshots WHERE "metricKey" = $1 AND dims = $2::jsonb
     AND date BETWEEN $3 AND $4 ORDER BY date DESC LIMIT 1`,
    [t.metricKey, dims, t.periodStart, t.periodEnd]);
  const actual = snap ? Number(snap.value) : (await computeMetric(t.metricKey)).value;
  const start = new Date(t.periodStart), end = new Date(t.periodEnd);
  const total = Math.max(1, (end - start) / 86400000 + 1);
  const elapsed = Math.min(total, Math.max(0, (Date.now() - start) / 86400000 + 1));
  const expected = Number(t.target) * (elapsed / total);
  return {
    actual, expected: Math.round(expected * 10) / 10,
    progressPct: t.target ? Math.round((actual / Number(t.target)) * 100) : 0,
    pacePct: expected ? Math.round((actual / expected) * 100) : 0,
  };
}

/** Seed one role-aware default board if none exists (insert-only). */
export async function ensureDefaultDashboard() {
  const existing = await get(`SELECT id FROM dashboards WHERE "isDefault" = true LIMIT 1`);
  if (existing) return;
  await run(
    `INSERT INTO dashboards (name, "nameAr", widgets, shared, "isDefault") VALUES ($1,$2,$3,true,true)`,
    ["Executive board", "لوحة الإدارة", JSON.stringify([
      { metricKey: "pulse_index", viz: "KPI", size: "lg" },
      { metricKey: "leads_new_30d", viz: "LINE" },
      { metricKey: "pipeline_value", viz: "KPI" },
      { metricKey: "won_value_30d", viz: "KPI" },
      { metricKey: "er_pct_30d", viz: "LINE" },
      { metricKey: "nps_90d", viz: "KPI" },
      { metricKey: "mentions_30d", viz: "LINE" },
      { metricKey: "budget_utilization_pct", viz: "KPI" },
    ])]);
}
