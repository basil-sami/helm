# PULSE — نبض
## The Marketing Operating Platform · Masterplan v2.0

> **Status:** Canonical product plan. Frozen 2026-07. Supersedes HELM-HUB-MASTERPLAN.
> **Rule:** Every build session references this document. Changes to scope amend this file first.

---

## 0 · Identity

**Pulse (نبض)** — formerly HELM — is a complete marketing operating platform: every marketing
process, model, and rhythm of a modern marketing department in one bilingual, data-sovereign
system. The name is the product: a daily heartbeat (the 05:00 cron becomes **النبضة اليومية / the
Daily Pulse**), listening (the market's pulse), the hygiene sweep (the team's pulse), vitals on
every dashboard, and a **Morning Pulse** digest. Brand mark: the ح evolves into an amber ECG
waveform on ink. The tagline writes itself: *"إحساسك بالسوق — your finger on the market's pulse."*

**Positioning.** Hootsuite, HubSpot, SurveyMonkey, and BuzzStream are four silos. Pulse's thesis
is **one graph**: a survey insight updates a persona → which shapes the next brief → which the
composer enforces → which the tracked link measures → which the customer record remembers.
We take each competitor's center of gravity and wire it into that graph; we never copy their bloat.

**Non-goals (discipline is part of the brand):** mass email blasting (v1), ad-auction management,
generic team chat, imitating Silicon Valley assumptions that don't fit our markets. Tracked links +
WhatsApp are the region's pixel; pulse.js extends that to "own your pixel."

---

## 1 · Business Model & Architecture Decision

**Pulse is a product sold to many client companies. Each client gets their own implementation.**

- **Deployment model: instance-per-client.** Every customer runs their own Pulse — own Supabase,
  own Vercel deployment, own domain, own branding, own data. Data sovereignty is the sales pitch,
  not a compromise. Saria Industrial Complex is **Client #1**, the flagship implementation and demo.
- **Why not shared multi-tenant now:** zero refactor cost (the CRUD factory stays untouched — no
  `workspaceId` on 76 tables), stronger sovereignty story, simpler security surface, and our
  idempotent `APPLY-LATEST.sql` already gives us **fleet upgrades** (run one file per instance).
  Instance-per-client is the standing model; the shared-SaaS fork was considered and removed from
  the roadmap (2026-08-01). Provisioning is solved by the Pulse Installer, not by multi-tenancy.
- **Versioning:** Pulse ships as versions (v1.0 = Wave 1 complete). Instances upgrade by pulling
  the release + running the cumulative migration. Never break idempotency.

### Productization requirements (Wave 0 — mandatory before new territories)
1. **De-hardcode Saria.** No Saria strings in code or UI. Saria survives only as `seed-demo.sql`.
2. **Generic starter seed** (`seed.sql`): industry-neutral roles, one sample of each core object,
   the four builtin process templates, empty catalogs.
3. **Onboarding wizard** (first-run): org name AR/EN, logo URL, accent color, currency & rate,
   business units, enabled modules, admin account creation → writes `settings` + `branding`.
4. **Theming tokens.** Per-client `branding` (logo, accent, name) flows through Nabd design
   tokens (§7). Pulse identity is the default theme, never the only theme.
5. **Module feature flags.** `settings.modules` jsonb — a client who didn't buy the agency portal
   simply never sees it. Server hides routes; UI hides nav. Flags are per-territory (§4).
6. **Pulse Installer.** A provisioning runbook + script: create Supabase project → run
   `APPLY-LATEST.sql` → run seed → set Vercel env → set CRON_SECRET → brand it → smoke test.
   Target: **new client live in under one hour.**
7. **Docs as product:** ADMIN-GUIDE.md (per-instance ops) + this masterplan ship in the repo.

---

## 2 · The Completeness Principle

**The test:** *a marketing director in any industry opens Pulse and finds nothing missing from
their job.* Every territory below exists to pass that test. The full anatomy of the marketing
function and where it lives:

| Marketing process | Pulse territory / models |
|---|---|
| Strategy & OKRs | objectives + **key_results (self-filling)**, planning pace, AI brain |
| Budgeting & spend | budget_entries, **invoices**, **ad_spend**, rate capture, ROMI |
| Brand management | **brand_assets (public Brand Center)**, **playbooks**, brand-health (surveys × listening) |
| Market research & insight | **surveys/NPS/CSAT**, **survey_responses**, **insights** bound to personas/products/briefs |
| Audience & data | segments, personas, **contacts + consent**, lead_scores |
| Offer & pricing | products, **promotions** (offer codes = tracked links) |
| Content & creative | content_items, **content_variants**, **creative_requests/briefs**, **asset_versions**, **copy_bank** |
| Owned channels | **scheduled_posts (composer)**, **bio_pages**, **landing_pages**, **forms**, capture |
| Earned media & PR | media_contacts, press_items (auto-matched), **outreach campaigns/touches**, **coverage_reports** |
| Influencers | influencers, collabs (link ROI) |
| Paid media | **ad_spend** (manual-first → API Wave 2), **media_plans/placements** (offline + QR) |
| Events | events, registrations, check-in, scorecards |
| Demand & pipeline | leads, lead_activities, kanban, SLA sweep, CSV import |
| Retention & loyalty | customers, feedback/CSAT, **referrals**, review cadences |
| Partner / channel mktg | **partners**, **partner_campaigns** (co-op budgets) |
| Agency & vendor ops | **vendors, engagements, deliverables, comments, invoices, portal_tokens** |
| Social listening & intel | osint, listening, SOV, **competitors**, alerts→tasks |
| Web analytics | **sites + web_events (pulse.js first-party snippet)** |
| Automation | **workflows + workflow_runs**, **wa_templates**, hygiene sweep |
| Governance | roles, audit, 2FA/sessions, **approvals engine**, backup/restore |
| Analytics & BI | **metrics catalog (semantic layer)**, **metric_snapshots**, **targets & pacing**, **anomaly alerts**, **dashboards**, **Pulse Index** |
| Reporting | exec report, **report_runs** (periodic packs), coverage_reports, **Morning Pulse digest** |

---

## 3 · Current Foundation (32 tables — shipped & 118-check tested)

**Governance:** users, roles, settings, audit_log, notifications, objectives, budget_entries
**Execution:** campaigns, campaign_briefs, content_items, posts, events, tasks, process_templates, assets
**Offer/Audience:** products, segments, personas
**Attribution:** tracked_links, event_registrations
**Pipeline:** leads, lead_activities, customers, feedback
**Reach:** media_contacts, press_items, influencers, influencer_collabs
**Senses:** osint_topics, osint_signals, social_accounts, social_metrics

Standing capabilities: per-module RBAC · content transition matrix · campaign ACTIVE gate ·
rate capture · /r redirects · capture forms (?src, ?event) · convert-to-customer · CSAT ·
press↔OSINT matching · effectiveness analytics · per-campaign ROI · event scorecards ·
hygiene sweep · TOTP/session lifecycle · sovereign backup/restore · PWA · bilingual RTL.

---

## 4 · New Model Census (~50 models → ≈82 tables total)

Conventions: uuid PKs, `createdAt/updatedAt`, camelCase quoted columns, jsonb for flexible
shapes, every table joins the backup/restore lists, every write audited, every rule tested.
Module flags in brackets **[flag]** gate each territory.

### A · PUBLISH — the composer & owned surfaces [publish]
- **content_variants** (contentId→content_items, platform, caption, captionAr, hashtags jsonb,
  assetId?, format) — per-platform adaptation of one content item.
- **scheduled_posts** (variantId, scheduledAt, assigneeId, status DRAFT→QUEUED→AWAITING_APPROVAL→
  READY→NOTIFIED→PUBLISHED/SKIPPED, publishedPostId?→posts, notifiedAt) — **assisted publishing**:
  at slot time the Daily Pulse notifies the owner with copy + asset + tracked link; one tap opens
  the platform share sheet; "mark published" auto-creates the measurement row in `posts`. The same
  model drives true auto-publish when platform APIs land (Wave 2).
- **bio_pages** (slug, title/Ar, theme jsonb, active) + **bio_links** (pageId, label/Ar,
  linkCode→tracked_links, sort, active) — Pulse-hosted link-in-bio at `/b/:slug`; every tap
  is attributed.
- **inbox_items** (platform, kind COMMENT/DM/MENTION, author, text, url, status OPEN/REPLIED/
  CONVERTED/ARCHIVED, leadId?, capturedById) — social inbox; manual capture v1 (share-to-Pulse),
  API ingest Wave 2. One tap converts an interaction to a lead.

### B · AUTOMATE — workflows, scoring, forms, pages [automate]
- **workflows** (name/Ar, trigger jsonb {event, filters}, actions jsonb[], active, lastRunAt) +
  **workflow_runs** (workflowId, entity, entityId, status, log jsonb) — trigger→condition→action
  from a **curated action library** (assign, notify, start process, create task, send WA template
  draft, add tag). No chaotic visual builder in v1.
- **lead_score_rules** (label, condition jsonb, points, active) → cached `leads.score`; hot leads
  surface on the kanban and in the Daily Pulse.
- **forms** (name, slug, campaignId?, fields jsonb[], successMsg/Ar, active) +
  **form_submissions** (formId, data jsonb, leadId?, contactId?, src) — generalizes the capture
  layer: many forms per campaign, each with its own conversion stats, public at `/f/:slug`.
- **landing_pages** (slug, title/Ar, blocks jsonb[], theme jsonb, formId?, campaignId?,
  status, views) — block-based bilingual pages at `/l/:slug`; every campaign gets a page with a
  tracked form and zero developer.
- **wa_templates** (name, body/Ar, variables jsonb, category, uses) — WhatsApp-first message
  library with merge fields; deep-link send; sends logged as lead activities.

### C · RESEARCH — surveys & insight [research]
- **surveys** (name/Ar, slug, kind SURVEY/NPS/CSAT, questions jsonb[], audience ANON/LINKED,
  campaignId?, productId?, active) + **survey_responses** (surveyId, answers jsonb, score?,
  contactId?/leadId?/customerId?) — public at `/s/:slug`; **surveys are tracked surfaces too.**
  Recurring NPS program per customer via sweep.
- **insights** (title/Ar, body, source SURVEY/LISTENING/INTERVIEW/DATA, links jsonb
  {personaIds, productIds, briefIds}, impact) — findings that **rewrite strategy**: attached to
  personas/products/briefs instead of dying in a chart.

### D · REACH — outreach engine & relationship health [reach]
- **outreach_campaigns** (name, goal, audienceKind MEDIA/INFLUENCER/PARTNER/CUSTOM, steps jsonb
  [{day, channel, templateId}], status) + **outreach_touches** (campaignId, targetKind, targetId,
  stepNo, channel WA/EMAIL/CALL, status PLANNED→SENT→REPLIED/DECLINED/PLACED, note) —
  BuzzStream's core, WhatsApp-first.
- **Relationship health (computed):** last-touch recency across journalists, influencers,
  partners, distributors → warm/cooling/cold, chased by the sweep.
- **coverage_reports** (title, periodStart/End, filters jsonb, snapshot jsonb) — one-click
  branded deliverable compiled from matched press + signals + SOV.

### E · STUDIO — the creative side [studio]
- **creative_requests** (title, brief, kind DESIGN/VIDEO/COPY/PRINT/OTHER, priority, requesterId,
  assigneeId?, status NEW→TRIAGED→IN_PROGRESS→REVIEW→DONE/REJECTED, dueDate, slaDueAt,
  campaignId?) — the intake queue anyone can file; kanban + SLA sweep.
- **creative_briefs** (requestId? | engagementId?, spec, references jsonb, format, dueDate) —
  deliverable-level briefs, reused by agency deliverables.
- **asset_versions** (assetId→assets, version, url, note, status DRAFT/REVIEW/APPROVED,
  approvedById?) — v1→v2→v3 with comments and approval stamps.
- **brand_assets** (kind LOGO/COLOR/FONT/TONE/DOC, label/Ar, value|url, public) — powers the
  **public Brand Center** at `/brand`: shareable with any printer or agency.
- **copy_bank** (text/Ar, kind CLAIM/TAGLINE/CTA/DISCLAIMER, productId?, personaId?, approved) —
  approved language that feeds the composer, landing pages, and WA templates.

### F · AGENCY — external vendor management [agency]
- **vendors** (name, kind AGENCY/FREELANCER/PRINTER/PRODUCTION/MEDIA_BUYER, contacts jsonb,
  phone, rateCard jsonb, rating cached, notes) — registry + computed scorecard (on-time rate,
  avg revision rounds, approval rate, total spend).
- **engagements** (vendorId, title, scope, campaignIds jsonb, feeUsd, startDate, endDate, status).
- **deliverables** (engagementId, title, briefId?, dueDate, status BRIEFED→IN_PROGRESS→SUBMITTED→
  IN_REVIEW→REVISION→APPROVED, revisionCount, submittedUrl, approvedAt) — the atomic unit of
  accountability; revision rounds become data.
- **deliverable_comments** (deliverableId, author INTERNAL/VENDOR, authorName, body) — the
  feedback thread both sides see, timestamped forever.
- **invoices** (vendorId, engagementId?, number, amountUsd, rateAtEntry, campaignId?, status
  RECEIVED→APPROVED→PAID, paidAt) — **approval writes a SPENT budget entry: agency costs flow
  into campaign ROMI automatically.**
- **portal_tokens** (vendorId, token, expiresAt, revoked, lastUsedAt) — the clever door:
  **magic-link guest portal** at `/p/:token`. No agency accounts, no passwords. Portal shows only
  their deliverables + read-only briefs + Brand Center; they submit links & reply to comments.
  Expiring, revocable, rate-limited, fully audited. **Sweep fairness:** overdue deliverables chase
  the vendor's scorecard *and* the internal owner; submissions unreviewed 48h chase *our* reviewer.

### G · CONNECTIVE TISSUE — what no competitor has
- **approvals** (entity, entityId, stage, requesterId, approverId?, status PENDING/APPROVED/
  REJECTED, note) — **one generalized engine** reused by content, scheduled posts, creative
  versions, deliverables, invoices, and budget-over-threshold.
- **media_plans** (name, period, channel RADIO/BILLBOARD/PRINT/TV/OTHER, budgetUsd, campaignId?) +
  **media_placements** (planId, label, location, startDate, endDate, costUsd, linkCode, qr) —
  **offline attribution**: every billboard and print ad carries a tracked QR (generated locally,
  `qrcode` lib — Wave 1, no external service).
- **competitors** (name/Ar, listeningTopicId?, priceNotes jsonb, notes, active) — first-class
  rivals: SOV binding + manual price tracking.
- **contacts** (name, phone, email, company?, tags jsonb, consent jsonb [{channel, grantedAt,
  source}], leadId?, customerId?) — the audience layer: not every human is a sales lead.
  **Consent tracking is a feature** when Pulse is sold to regulated clients.
- **promotions** (name/Ar, code, kind DISCOUNT/OFFER/BUNDLE, productIds jsonb, startsAt, endsAt,
  linkCode?, redemptions, active) — offers as measurable objects.
- **referrals** (referrerCustomerId, code→tracked_links, referredLeadId?, rewardState
  PENDING/EARNED/PAID) — word-of-mouth, finally measured.
- **partners** (name, kind DISTRIBUTOR/RESELLER/ALLIANCE, region, contacts jsonb, coopBudgetUsd)
  + **partner_campaigns** (partnerId, campaignId, sharePct) — channel co-op marketing.
- **playbooks** (title/Ar, body md, category, ownerId, published) — living SOPs; the platform
  teaches its own processes.
- **ad_spend** (platform META/TIKTOK/GOOGLE/OTHER, campaignId, date, amountUsd, rateAtEntry,
  impressions?, clicks?) — manual-first paid tracking feeding ROMI today; API sync Wave 2.
- **sites** (name, domain, snippetKey) + **web_events** (siteKey, kind PAGEVIEW/EVENT, path,
  ref, utm jsonb, src?, visitorHash, at) — **pulse.js**: a first-party analytics snippet any
  client drops on their website; traffic flows into *their own instance*. "Own your pixel."
- **key_results** (objectiveId, label/Ar, metric jsonb {source, filter}, target, current cached,
  auto) — **self-filling OKRs**: "40 leads from campaign X" updates itself nightly.
- **digest_log** (kind MORNING_PULSE, channel INAPP/EMAIL, payload jsonb, sentAt) — the Morning
  Pulse: in-app digest screen Wave 1; email via SMTP Wave 2.

### H · ANALYTICS — the measurement brain [analytics]

The current analytics endpoint computes everything on read. A platform needs a real measurement
layer: **defined once, snapshotted nightly, comparable over time, targeted, alerted, composable.**

- **metrics** (key, name/Ar, category, source jsonb {table|metric-formula, filter, agg},
  unit, format, direction HIGHER/LOWER, dimensions jsonb, description/Ar) — the **semantic
  layer**: every KPI in Pulse defined exactly once. Dashboards, reports, OKR `key_results`,
  alerts, and the Morning Pulse all *reference* the catalog — no formula ever re-implemented.
  Composite metrics reference other metrics, which is how the Pulse Index exists (below).
- **metric_snapshots** (metricKey, dims jsonb, date, value; unique metricKey+dims+date) —
  written by the Daily Pulse: nightly materialization of every active metric × its dimension
  slices. Unlocks history ("what did pipeline look like on March 1?"), sparklines everywhere,
  MoM/YoY comparison, and pacing — for the cost of one row per metric-slice-day.
- **metric_targets** (metricKey, dims?, periodStart, periodEnd, target, ownerId?) — actual vs
  target vs **pace** (the planning-pace logic, generalized to every KPI).
- **metric_alerts** (metricKey, dims?, condition ABOVE/BELOW/DELTA_PCT, threshold, windowDays,
  audience jsonb, active) — nightly anomaly checks against trailing baselines → notifications;
  each firing can draft an `insights` stub (Wave 3: AI explains the anomaly).
- **dashboards** (name/Ar, ownerId, role?, widgets jsonb [{metricKey, dims, viz KPI/LINE/BARS/
  TABLE/FUNNEL, size}], shared, isDefault) — composable boards on the catalog; role-aware
  defaults ship seeded (GM view, digital lead view, pipeline owner view).
- **report_runs** (templateKey, period, snapshot jsonb, generatedById, generatedAt) — the
  reports engine: monthly board pack, weekly campaign report, quarterly brand report —
  generated from snapshots, immutable once run. (`coverage_reports` becomes one template.)
- **Field addition:** `leads.lostReason` — win/loss analysis needs a reason taxonomy.

**Computed layers (no tables — documented views):** funnel & stage-conversion rates ·
**sales velocity** (avg days per stage from `lead_activities` STAGE entries) · cohorts (leads by
month/source: conversion & velocity over time) · **attribution v1** (first-touch & last-touch per
lead across tracked_links, forms, events, web_events; position-based later) · dimension slicing
(time, campaign, product, persona, channel, business unit, owner, source, partner, vendor).

**The KPI catalog (seeded — every row below is a `metrics` entry):**

| Area | KPIs |
|---|---|
| Demand & pipeline | new leads, MQL (score≥τ), SQL, pipeline value, weighted pipeline, won value/count, win rate, avg deal size, sales velocity, stage conversions, stale %, SLA first-touch compliance, CPL, cost/won, ROMI, pipeline coverage vs target |
| Acquisition & traffic | link clicks (by channel/campaign), QR scans per placement, sessions·pageviews·visitors (pulse.js), form views→submits CVR, landing page CVR, bio-page taps |
| Content & engagement | posts published, reach, impressions, ER by channel/pillar/product, top posts, content on-time rate, content cycle time (IDEA→PUBLISHED), approval turnaround |
| Brand & comms | mentions, unique articles, **SOV %**, avg sentiment, negative share, coverage count & matched sentiment, pitch→placement rate, outreach reply rate, relationship-health mix |
| Events | registrations, attendance, attend rate, cost/lead, pipeline influenced per event |
| Customer & retention | active/dormant/churned mix, **NPS**, CSAT avg, review-cadence compliance, expansion value, referral count & conversion, retention rate |
| Research | responses & response rate, NPS by segment/product, insights created, **insights applied** (linked into briefs) |
| Paid & media | ad spend by platform, CPM/CPC (when tracked), plan-vs-actual per media plan, cost per placement |
| Studio & agency | request throughput, creative cycle time, SLA hit rate, avg revision rounds, vendor on-time %, vendor approval rate, invoice cycle time |
| Money & strategy | budget plan vs spent (campaign/BU), burn rate, OKR progress & pace, key-result auto-fill coverage |
| **Composite** | **Pulse Index (0–100)** + area pulses: Brand · Demand · Engagement · Customer · Ops |

**The Pulse Index (مؤشر النبض)** — the signature. Each area pulse normalizes 4–6 of its KPIs
against targets/baselines to 0–100; the overall Index is their weighted composite. Formulas live
in the metrics catalog (transparent, per-client tunable weights). It headlines the dashboard,
the exec report, and the Morning Pulse: *one number for "how is marketing, really?"* — with
full drill-down, because every component is itself a catalog metric with history.

**Analytics UI:** Overview (Pulse Index + north-star tree + top movers) · per-territory boards ·
**Explore** (any metric × dimensions × period, compare mode) · custom Dashboards · Targets &
pacing · Reports. The Morning Pulse digest is generated from snapshots: yesterday's movers,
alerts fired, pace warnings.

### Public surfaces census (each: rate-limited, honeypotted, audited, robots-noindex)
`/r/:code` redirects · `/f/:slug` forms · `/l/:slug` landing pages · `/s/:slug` surveys ·
`/b/:slug` bio pages · `/p/:token` agency portal · `/brand` brand center ·
`/api/capture/*` legacy capture + CSAT · `/px` pulse.js collector.

---

## 5 · The Graph (why one system beats four)

Insight → persona → brief → variant → scheduled post → tracked link → click → form →
lead (scored, workflow-routed) → WON → customer → NPS → insight. Meanwhile: creative request →
brief → agency deliverable → approved asset → variant; invoice → budget → ROMI; placement QR →
web_event → attribution; listening → competitor SOV → coverage report → outreach touch.
And underneath it all: every node emits **catalog metrics, snapshotted nightly** — the graph
doesn't just connect, it *remembers*. **Every arrow above is a foreign key, not an export/import.** This diagram is the pitch deck's
centerpiece and the schema's table of contents.

---

## 6 · Engineering Standards (unchanged laws + additions)

- **CRUD factory** remains the backbone; `validateCreate`/`validateUpdate` hooks host all business
  rules; `jsonFix` for jsonb; cols snapshot **after** create-hooks (learned the hard way).
- **Approvals engine** is a shared service, never re-implemented per module.
- **Metrics discipline:** every territory ships with its KPIs registered in the metrics catalog,
  snapshotted by the Daily Pulse, and covered by tests — a Definition-of-Done item, not a phase.
- **Every feature lands with tests.** The suite (118 checks today) grows with every territory;
  green build is a session exit criterion. Public surfaces get abuse tests.
- **Migrations:** cumulative, idempotent `APPLY-LATEST.sql`; restore order stays FK-safe;
  backup/restore lists updated with every table.
- **Bilingual discipline:** every user-facing string enters the dictionary AR+EN, Arabic first.
- **Feature flags** checked server-side (route guard) and client-side (nav) — never client-only.
- **Security:** magic tokens ≥ 128-bit, expiring, revocable; per-surface rate limits; portal and
  pulse.js collectors never touch privileged tables.

---

## 7 · Nabd Design System (نبض) — the top-1% bar, operationalized

**Charter:** Pulse must look like a top-1% creative agency built it — editorial, confident,
alive — and it must survive 60 pages without decaying into an admin template. Therefore, a law:

1. **Tokens.** Ink/paper/amber duality; client accent flows through `--accent-*` tokens without
   breaking contrast (auto-derived shades). 8-pt spatial grid. Radius & shadow scales. The
   engineering grid texture as the surface signature.
2. **Typography.** IBM Plex Sans Arabic, Arabic-first; editorial display moments (oversized
   Arabic-Indic numerals as section watermarks); IBM Plex Mono for every number that matters
   (`kpi-num` everywhere).
3. **Motion language.** The **ECG line is the loading state and the brand's heartbeat**;
   count-ups on vitals; 200ms standard ease; staggered reveals; `prefers-reduced-motion`
   always honored. Motion means "alive," never decoration.
4. **Dark/light as meaning.** Ink for monitoring surfaces (dashboards, listening, analytics);
   warm paper for creation surfaces (composer, briefs, studio). Never arbitrary.
5. **Signature moments** — one memorable interaction per module, specified in design review:
   kanban card pulse on stage change · check-in heartbeat ripple · approval stamp animation ·
   composer slot "beat" on schedule · portal submission confirmation wave.
6. **Component library.** Every primitive designed once, superbly: buttons, cards, tables,
   kanban, calendar, empty states (illustrated, bilingual), charts, modals, toasts, steppers,
   file/link tiles. New pages compose; they never invent.
7. **Quality gates.** A page ships only if: uses tokens exclusively · has designed empty & error
   states · RTL-perfect · mobile-first verified at 360px · one signature detail · passes the
   "would a top agency sign this?" review.

---

## 8 · Wave Plan

**Wave 0 — Foundation & Rename — ✅ SHIPPED (this session):**
Rename across code/dict/PWA (ح→ECG mark) · Nabd accent tokens with per-client theming ·
settings expansion (branding, currency labels, business units, module flags, onboarded) ·
generic seed + `seed-demo.sql` (Saria, demo pw `Pulse@2026`) · built-in installer
(`/api/setup`, locks after first admin) · onboarding wizard · server-enforced module flags ·
suite 118→137 checks · ADMIN-GUIDE.md + INSTALLER.md. Deferred to a later pass: regenerated
sales presentation.

**Wave 0 — original scope (for reference):**
HELM→Pulse everywhere (code, dict, PWA manifest, ح→ECG mark) · Nabd token layer + theming ·
settings expansion (branding, modules flags) · generic seed + Saria demo seed · onboarding
wizard · Pulse Installer runbook · presentation regenerated under Pulse.

**Wave 1 — Zero-new-infrastructure territories (order of build):**
1. ✅ **SHIPPED (2026-07-30)** — **Approvals engine + Studio + Agency** (shared engine + the
   portal). 12 tables (44 total), suite 137→177. Engine wired to invoices (approval releases a
   SPENT budget entry at the captured rate), asset_versions (approval stamps), and deliverables
   (rejection = a revision round on the scorecard). Magic-link portal (/p/:token, 192-bit,
   expiring, revocable, rate-limited, audited as `portal:<vendor>`) + public Brand Center
   (/brand). Three new sweeps (studio SLA, agency overdue, review-stale 48h) — flag-aware.
   *Boundaries:* approvals cover the three entities above — content/scheduled-post approvals
   plug in at item 4; studio/agency KPIs register into the metrics catalog when item 3 lands;
   the sweep still runs inside the intel-gated cron (restructured into the Daily Pulse at item 3).
2. ✅ **SHIPPED (2026-07-30)** — **Forms + Landing Pages + Surveys + Contacts/consent**.
   7 tables (51 total), suite 177→227. Two territories flagged on: **[automate]** (forms +
   landing pages — workflows/scoring join at item 5) and **[research]** (surveys + insights).
   Three public surfaces (/f /l /s): honeypotted, rate-limited, noindex, validated against
   the builder definition. Every form submit runs one pipeline: contact found-or-created
   (consent granted per channel with source `form:<slug>`), lead created (source FORM,
   campaign from form or ?src= tracked link), submission stored — so attribution multiplies.
   Contacts carry an append-only consent ledger (grant/revoke audited, history kept — the
   regulated-client feature). NPS/CSAT score themselves (server-side math, demo-verified).
   *Boundaries:* the recurring NPS-per-customer program needs send mechanics → lands with
   outreach (item 6) or workflows (item 5); form/survey/contact KPIs register into the
   metrics catalog when item 3 lands; landing-page THEME tokens accepted but per-page
   theming UI arrives with the bio pages (item 4).
3. ✅ **SHIPPED (2026-07-30)** — **Analytics Core: the measurement brain**.
   6 tables (57 total), suite 227 → **259 checks**. The **metrics catalog** ships with 44
   entries — 38 builtins + 6 composites — every formula defined once in a versioned code
   registry, mirrored insert-only into the DB (admin edits survive). The **Daily Pulse**
   orchestrator replaces the OSINT cron (`/api/cron/daily-pulse`; legacy path aliased):
   snapshots → anomaly alerts → hygiene sweeps → intel — **sweeps and snapshots now run even
   with Intel disabled** (freed from the flag gate). Nightly `metric_snapshots` materialize
   every active metric × dimension slice (by source, platform, sentiment, lostReason…),
   unlocking series, slices, movers, and month-over-month deltas. **Targets & pacing**
   generalize the planning-pace math to any KPI (actual vs expected-by-today vs pace%).
   **Anomaly alerts** (ABOVE/BELOW/DELTA_PCT vs trailing baseline) notify their audience with
   a 20-hour dedupe. A seeded **Executive board** renders from the dashboards API. The
   **reports engine** generates the immutable monthly board pack (22 metrics, MoM deltas)
   from snapshots. `leads.lostReason` lands with a 7-value taxonomy enforced on LOST (kanban
   intercepts the drop and asks why). And the signature: **مؤشر النبض — the Pulse Index** —
   five area pulses (Demand · Engagement · Brand · Customer · Ops), each a target-aware
   weighted normalization of 4 catalog metrics, composing one transparent 0–100 headline
   with full drill-down; weights are per-client tunable via `PATCH /api/metrics/:key`.
   *Boundaries:* a custom dashboard-builder UI → later wave (API + default board ship now);
   attribution v1 (first/last-touch), cohorts, and Explore compare-mode → documented computed
   layers, arriving with `web_events`/pulse.js (item 7); alert→insight AI drafting → Wave 3;
   more report templates (weekly campaign, quarterly brand) → as their territories land;
   custom-SQL metric sources → Wave 2 (formulas live in the code registry today).
4. ✅ **SHIPPED (2026-07-30)** — **Publish: the composer & owned surfaces**.
   4 tables (61 total), suite 259 → **288 checks**. **content_variants** adapt one approved
   content item per platform (caption AR/EN, hashtags jsonb, format POST/REEL/STORY/ARTICLE/AD)
   with the **copy bank wired into the composer** — approved lines insert straight into
   captions. **scheduled_posts** run a real state machine (DRAFT→QUEUED→AWAITING_APPROVAL→
   READY→NOTIFIED→PUBLISHED/SKIPPED) with an enforced transition matrix, a hard gate — only
   APPROVED/PUBLISHED content can queue — and the **approvals engine plugged in with one
   ENTITY_RULES entry**: approval releases the slot to READY, rejection returns it to DRAFT.
   **Assisted publishing** lives in the Daily Pulse: READY slots past their time ping the
   owner (PUBLISH_DUE, copy + tracked link in hand), one tap opens the native share sheet,
   and "mark published" **auto-creates the measurement row in `posts`** (linkCode carried,
   publishedPostId back-ref) — the exact model true auto-publish will drive in Wave 2.
   **Bio pages** ship the Pulse-hosted link-in-bio at `/b/:slug` (per-page accent theme,
   AR-first), every tap attributed through `/r/:code`. 3 PUBLISH KPIs registered in the
   catalog (queue runway, publish on-time %, bio taps — catalog now 47). Also fixed en route:
   `/r/:code` had **no Vercel rewrite** (redirects worked in Docker only) — now rewritten,
   and the cron entry points at the canonical `/api/cron/daily-pulse`.
   *Boundaries:* true auto-publish via platform APIs → Wave 2 (same state machine, new
   executor); the social inbox (`inbox_items`) → item 7 per this plan; composer slots
   surfacing on the content Calendar → later polish; per-page bio theming beyond the accent
   → with the landing THEME work.
5. ✅ **SHIPPED (2026-07-31)** — **Automate: the event bus, lead scoring & WA library**.
   4 tables (65 total), suite 288 → **324 checks**. **workflows** run trigger → condition →
   action from a **curated six-action library** (assign owner, add tag, create task, start
   process template, WA draft, notify) — no chaotic visual builder; events fire from the
   code paths that matter (`lead.created`, `lead.stage_changed`, `form.submitted`), filters
   are shallow field matches, and every execution writes an audited **workflow_runs** row
   with a per-action ✓/✗ log. One failing action never stops the rest (error isolation,
   status ERROR). A **test-fire endpoint** rehearses any workflow against a sample payload.
   **lead_score_rules** compute a cached `leads.score` (field/op/value conditions, six
   operators) recomputed on lead writes, on rule changes, and nightly; **70+ = hot 🔥** on
   the kanban, and the Daily Pulse **hot-lead sweep** pings owners of hot leads gone quiet
   3+ days (20-hour dedupe). **wa_templates** ship the WhatsApp-first library with
   `{{merge}}` fields, a per-lead render endpoint returning a `wa.me` deep link, every send
   logged as a kind-`WA` lead activity, uses counted. 3 AUTOMATE KPIs registered (runs 7d,
   hot open leads, WA sends 30d — catalog now 50).
   *Boundaries:* recurring program sends (the NPS-per-customer mechanics) → item 6 outreach
   sequences — a WA template + workflow gets close, but recurrence needs sequences; more
   trigger events (content.approved, survey.response, schedule.daily) → added as territories
   need them; a visual flow builder → **Wave 3 (committed)**; tag filters on the kanban → later
   polish.
6. ✅ **SHIPPED (2026-07-31)** — **Reach: the outreach engine & relationship health**.
   4 tables (69 total), suite 324 → **362 checks**. **outreach_campaigns** are BuzzStream's
   core made WhatsApp-first: an audience kind (MEDIA / INFLUENCER / CUSTOMER / CONTACT) +
   ordered steps [{day, channel, templateId?}]; **enrolling targets mints one touch per
   step**, due-dated forward, with already-enrolled targets skipped — a sequence never
   double-books a relationship. Touches run their own machine (PLANNED→SENT→REPLIED/
   DECLINED/PLACED, SKIPPED⇄) and the **assisted send** renders the WA template against the
   target, hands back the `wa.me` deep link, stamps SENT, and **closes the loop on
   `media_contacts.lastContactAt`** — outreach and relationship health are one system.
   **Health buckets** (warm <30d · cooling 30–90 · cold >90) power the board, and two new
   Daily Pulse sweeps chase the gaps: OUTREACH_DUE (planned touches past due, per campaign)
   and REL_COLD (tier-1 relationships silent 60d+), both 20h-deduped. **coverage_reports**
   compile the one-click immutable deliverable: matched press + listening signals +
   **share-of-voice vs bound competitors** + the outreach funnel for the period.
   **competitors** are first-class: bound to a listening topic, mentions counted (30d) and
   feeding SOV. The **NPS-per-customer mechanics landed**: a CUSTOMER-audience sequence
   sends through the linked lead's phone. 3 REACH KPIs registered (sent 30d, reply rate,
   cold media count — catalog now 53).
   *Boundaries:* PARTNER audiences enroll once the partners table ships (item 7); true
   recurrence (auto-re-enroll every quarter) → a `schedule.daily` trigger or playbooks in
   item 7 — the send mechanics are done, the timer isn't; coverage-report PDF export → with
   the report_runs polish; EMAIL/CALL channels stay manual-log by design (WhatsApp-first).
7. **Connective — ✅ SHIPPED (2026-07-31)**: media plans + QR offline attribution (locally
   generated, tracked_links-minted, scans = clicks) · promotions with redemption counting ·
   referrals (link-minted, click-attributed, auto-EARNED by the nightly sweep when the referred
   lead wins) · partners + co-op campaign links · playbooks (living SOPs, publish flow) ·
   ad_spend (manual paid entries auto-writing SPENT budget lines → ROMI) · **pulse.js**
   ("own your pixel": /pulse.js snippet + silent-drop /api/public/collect + per-site stats) ·
   **self-filling key results** (catalog-referenced, nightly-refreshed, rendered under each
   objective) · **the Morning Pulse** (صباح النبض — compiled nightly to digest_log, /morning
   screen with the dial, today's four lanes, won-yesterday, alert chips) · inbox v1 (manual
   capture → one-tap lead conversion with social source). 5 CONNECT KPIs registered (DoD ✓);
   catalog at 58. Boundaries: QR print-sheet export → polish; public promo redemption endpoint →
   later; referral auto-attribution from /r src → later (manual attach v1); partner portal →
   maybe W2; custom-event dashboards on pulse.js → W2; email digest channel → W2 (SMTP);
   dims picker on key results → polish; inbox API ingest → W2 (Meta/TikTok APIs).

→ **Pulse v1.0 — ✅ COMPLETE (2026-07-31): 82 tables, 416/416 checks, 58-metric catalog.**
   Every marketing process covered *and measured*: plan → create → approve → publish → capture →
   automate → nurture → reach → analyze → learn — one bilingual instance, one Daily Pulse.

**Wave 2 — When external access lands (cluster order chosen 2026-07-31):**
- **W2·A — Mail rail (SMTP) — ✅ SHIPPED (2026-08-01)**: transport-abstracted `mail.js`
  (configured → nodemailer SMTP; unconfigured → **log mode**, recorded and never thrown) ·
  `mail_log` delivery audit (SENT/FAILED/LOGGED + error) · `settings.mail` with the password
  masked on read (`hasPass`) and merge-preserved on write · admin `POST /api/mail/test` +
  `GET /api/mail/log` · per-user `morningEmail` opt-in · RTL inline-styled briefing template
  (escaped, no SVG — email clients are a hostile runtime) · nightly `emailMorningDigest()` as
  the last Daily Pulse step, deduped one-per-person-per-day · `emails_sent_30d` KPI (catalog 59) ·
  **two rails behind one contract**: HTTP provider (Resend & API-compatible, 15s timeout,
  endpoint overridable) or client-owned SMTP, both masked (`hasKey`/`hasPass`) and merge-preserved,
  with provider inferred for configs saved before the switch existed. 83 tables, 451/451 checks.
  Boundaries: per-notification emails, digest batching, per-user language templates, inbound
  parsing, and attachments → later passes.
- **W2·B + W2·D — the connector layer (unified 2026-08-01)**: one contract, four adapters
  (WABA · Meta · TikTok · Google Ads) behind `backend/src/connectors/`; nothing platform-specific
  ever touches the product tables. **P1 — ✅ SHIPPED (2026-08-01)**: connector registry with a
  capability map + timed `platformFetch` + `integration_runs` audit · WABA adapter (verify,
  template & text sends, webhook parsing) · signed webhooks (HMAC over the raw body — `express.json`
  now captures `rawBody`) with handshake, redelivery-safe ingest via a unique `(platform,externalId)`
  index · **the 24-hour service window enforced server-side**, templates gated on an approved
  `waTemplateName` · account verify endpoint + capability map · token-expiry sweep · masked
  `settings.integrations` · KPIs `wa_sent_30d` + `inbox_api_7d` (catalog 61). 84 tables, 486/486.
  **P2–P4 — ✅ SHIPPED (2026-08-01)**: Meta adapter (Page feed + the Instagram two-step container
  flow, insights, `act_` campaign-day spend) · TikTok (publish + metrics; inbox capability
  deliberately off — restricted tier) · Google Ads (spend via GAQL, dormant without a developer
  token and honest about it) · **publish-tick** (`/api/cron/publish-tick`, 15-min cron + folded
  into the nightly for hobby-tier hosts) taking READY→PUBLISHED with the permalink, failures kept
  READY with the platform's reason + assignee notified · Meta webhooks (comments/mentions/DMs)
  reusing the signed-hook helper · nightly metrics + spend sync with **budget-written-once**
  idempotence and campaign-name auto-matching (unmatched refs kept and flagged, never dropped) ·
  KPIs `autopublished_30d` + `synced_spend_30d` (catalog 63). 84 tables, 517/517.
  Full architecture: `SOCIAL-API-BRIEF.md`. **Still gated in the real world by Meta app review,
  WABA template approval, TikTok content-posting access and a Google developer token.**
  **Real-world approval gates (Meta app review, WABA number + templates, TikTok access, Google
  dev token) must be started immediately — they gate the calendar, not the code.**
- **W2·C — Storage — ✅ SHIPPED (2026-08-01)**: a storage rail with **two drivers behind one
  contract** (Supabase Storage when configured, Postgres `bytea` otherwise — so self-hosted and
  offline instances are never blocked on a third party, and the product-facing URL is identical
  either way) · `files` table with SHA-256 on arrival (the groundwork for W2·E P3 evidence
  integrity) · raw-body upload (no multipart dependency, 25 MB cap) mounted ahead of the JSON
  parser · public stable URLs vs **HMAC-signed 1-hour links** with constant-time verification ·
  reusable `UploadButton` wired into the org logo, brand centre and Studio asset versions
  (v1→v2→v3, each keeping its own file) · publish tick now resolves relative media against
  `PUBLIC_URL` and **fails loudly rather than handing a platform an unfetchable link** ·
  KPI `storage_used_mb` (catalog 66) · **full DAM**: `/library` media library (multi-file
  drag-drop, name search, family filters, image thumbnails, rename, public/private toggle,
  copy-link) with **usage-aware deletion** (a file knows whether an asset, version, brand entry,
  bio link or the org logo still points at it, and refuses to orphan it without `?force=true`) ·
  brand centre renders logos as images and Studio shows thumbnails · demo instance ships a stocked
  library with a real logo wired to settings and the public brand page. Cap **50 MB**
  (`MAX_UPLOAD_MB`). 86 tables, 592/592 checks. Boundaries: image resizing/thumbnail generation,
  virus scanning, presigned direct-to-storage uploads for large video, byte-level backup export.
- **W2·E — Listening & OSINT hardening · P1 ✅ SHIPPED (2026-08-01)**: turns listening
  from keyword collection into validated intelligence. Today's signals are kept on exact-match
  dedupe and scored by an English-leaning lexicon, and those raw rows feed SOV → the metrics
  catalog → the Pulse Index → the board pack — so **collection noise is a data-integrity defect,
  not a feature gap**. Adopts established tradecraft: **Admiralty Code** source reliability (A–F)
  × information credibility (1–6) on a seeded source registry · **SimHash near-duplicate
  clustering** so a syndicated story counts once (with syndication volume as its own signal) ·
  a **relevance gate + analyst review queue** quarantining ambiguous hits from all metrics
  (سارية = flagpole; Nile = half of Sudanese commerce) · an **entity/alias layer** (Maltego-lite)
  so mentions and sentiment attach per-competitor instead of per-keyword · **Arabic normalization
  + Sudanese dialect lexicon + sentiment that abstains** with a confidence score rather than
  guessing · **evidence integrity** (content hashing, snapshots, chain of custody) and **case
  files** (Paliscope YOSE-style) exportable through the existing report engine · **ORG-only handle
  discovery** (Social Analyzer methodology) and a **corroboration engine** requiring ≥2 independent
  sources before an insight stands. Phases P1→P2→P4, with P3 after W2·C (snapshots need storage).
  +7 tables, ~+60 checks, +4 KPIs. **Permanent guardrail: entity kinds are ORG/BRAND/PRODUCT/
  OUTLET plus official spokespeople only — no private-individual profiling, enforced server-side.**
  **P1 delivered**: `osint_sources` registry with Admiralty A–F grading (auto-registering at D,
  re-grading a source's history on rating, pre-registration supported) · SimHash + Jaccard
  near-duplicate clustering with canonical election and `syndicationCount` · per-topic relevance
  gate (`mustInclude`/`mustExclude`/`contextTerms`/`reviewThreshold`) quarantining ambiguous hits
  as PENDING · analyst review queue with recorded rulings · **integrity filter applied at every
  call site** (metrics catalog, SOV, coverage reports, and the browse list, which now agrees with
  the numbers; `?include=all` audits what was filtered) · idempotent backfill for pre-release
  history · KPIs `signal_precision_30d` + `corroborated_share_30d` (catalog 65). 85 tables,
  557/557 checks. **P2 + P3 — ✅ SHIPPED (2026-08-01)**: `osint_entities`/`osint_aliases`/
  `osint_signal_entities` with Arabic-aware matching (diacritics, alef/ta-marbuta/tatweel folding,
  Arabic-Indic digits, prefix+suffix stemming so `ممتاز` matches `ممتازة` and `مشاكل` is found
  inside `ومشاكل`) · match provenance (method, surface, confidence) · **clause-aware per-entity
  sentiment** splitting on Arabic contrast markers so one article can read +0.67 for us and −0.75
  for a rival, **abstaining rather than borrowing a verdict formed about someone else** ·
  confidence on every reading, below 0.4 rendered as unresolved · Sudanese dialect lexicon ·
  entity-based share of voice over canonical non-rejected signals · evidence snapshots (fetch →
  extract → SHA-256 → private file, PARTIAL when the source is unreachable) · full provenance
  endpoint ("show your work") · `osint_cases`/`osint_case_items` timelines · KPIs
  `entity_resolution_rate_30d`, `sentiment_abstention_30d`, `evidence_preserved_30d` (catalog 69).
  **Guardrail enforced server-side**: entity kinds are ORG/BRAND/PRODUCT/OUTLET/PUBLIC_FIGURE only
  — the API rejects private-individual entities with an explicit error. 91 tables, 636/636 checks.
  **P4 — ✅ SHIPPED (2026-08-01)**: ORG-only handle discovery (name-derived guesses, sequential
  rate-limited public-page probes, trigram similarity + page-content evidence, never authenticated)
  producing **candidates that require human confirmation** before binding a HANDLE alias — pointing
  it at a PUBLIC_FIGURE returns an explicit refusal · corroboration engine judging independence by
  **owner group, not masthead**, so a media group's brands count once; single-source items chipped
  rather than hidden · nightly corroboration sweep · **threshold tuning** replaying analyst rulings
  across candidate thresholds to recommend the best F1, abstaining below 5 rulings · KPI
  `uncorroborated_share_30d` (catalog 70). 92 tables, 659/659 checks.
  **W2·E complete — Wave 2 complete.**
  Full architecture: `OSINT-BRIEF.md`.

**Wave 3 — Platform play (architected 2026-08-01, revised v2 · full brief: `WAVE-3-BRIEF.md`).**
Not more territory: every cluster makes what exists *usable by more people*, *survivable in
production*, or *smarter per unit of human attention*. **Instance-per-client stands — the
shared-SaaS fork is off the plan**; provisioning friction gets solved by the Pulse Installer, not by
a `tenantId` across 92 tables. Sequenced by dependency:

- **W3·A — Observability — ✅ SHIPPED (2026-08-01).** `error_log` with **fingerprinting** (uuids
  and numbers normalised out, so one recurring bug is one row with a count) · **payload digests
  never payloads** — field count, field names and a hash, because request bodies here carry contact
  data and a fault log must not become a second copy of the CRM · `X-Request-Id` on every response
  and in every error body, so a user can quote a reference · client-side `window.onerror` /
  `unhandledrejection` beacon (session-deduped, rate-limited) capturing render faults the server
  never sees, stored at level CLIENT and excluded from the server KPI · `GET /api/health`
  answering **503 when genuinely unhealthy** (DB, Daily Pulse age, publish tick, connector
  failures, faults, storage driver, mail) for uptime monitors · admin **System page**: health grid,
  faults grouped by fingerprint expanding to occurrences with stacks, and the previously scattered
  feeds gathered · 90-day nightly pruning · KPI `error_rate_24h` (catalog 71). 93 tables,
  687/687 checks.
- **W3·B — Visual flow builder — ✅ SHIPPED (2026-08-01).** **Pure UI over the existing engine** —
  the canvas serialises back into today's `workflows.actions` jsonb; there is no second execution
  path and must never be one. One engine change: a recursive `{type:"IF",cond,then,else}` node
  nested up to 5 deep, **fully backward compatible** (a test asserts pre-builder flat flows still
  run unchanged), reusing the *same* `OPS` vocabulary as the scoring rules so "at least" cannot
  mean two things · **the branch taken and the test that decided it are written to
  `workflow_runs.log`**, so the audit answers *why this lead got no task* · **dry-run against a
  real recent lead** describing each step in plain terms (*"would add tag big-deal"*) and
  **provably writing nothing** (a test compares tags and task count before/after) · save-time
  validation refusing every shape of broken flow with the reason (empty branch, missing field,
  missing value, unknown comparison, unknown action) · palette generated from the `ACTIONS`
  registry so new actions appear automatically · a condition on a field the event doesn't carry is
  **false, not a crash**. 707/707 checks. Boundaries: no loops, no long waits (scheduler → Wave 4),
  no rejoining parallel branches, desktop-first canvas; `SEND_WA` still gated on Meta
  template-status sync.
- **W3·C — The AI rail — ✅ SHIPPED (2026-08-01).** One contract like mail and storage (`ai.js`,
  masked config, `ai_runs` ledger, `ai_cache`). **All four laws enforced in code and tested:**
  (1) *drafts, not decisions* — explanations land as `insights.status='DRAFT'`, excluded from the
  published insight list until a person accepts them; (2) *grounded or silent* — `groundedComplete()`
  hands over numbered evidence and **discards any answer that cites nothing or cites evidence never
  supplied**, recording it as ABSTAINED (two tests prove a fluent ungrounded answer is thrown away);
  (3) *bounded cost* — the monthly ceiling is checked **before** spending, cache hits cost nothing,
  an unconfigured or capped instance degrades instead of failing; (4) *guardrails refuse before the
  request is built* — private-individual profiling, AI-drafted WhatsApp sends, and AI ruling the
  review queue are all rejected by feature name. Applications: **anomaly explanation** assembling
  real evidence (metric shape, co-moving metrics, spend changes, listening signals, publish gaps)
  into the ACH-lite `insights.hypotheses` field from W2·E P4 · creative-brief drafts from the brand's
  own tone + approved copy · Morning Pulse narrative. **Leak caught by its own test:** `apiKey` was
  missing from the settings mask list and was being returned to clients — now masked. 95 tables,
  741/741 checks.
- **W3·D — Live search — ✅ SHIPPED (2026-08-01).** `search.js` rail, four providers
  (WEB via the AI rail as default + metered X + free Reddit/YouTube). **The load-bearing rule holds
  in code:** live results are graded by the *same* `gradeSignal()` the RSS path uses — source
  registration, SimHash clustering, relevance gate, review-queue quarantine — then entity-linked,
  so nothing shortcuts W2·E. `search_budget` per provider with the cap checked **before** spending,
  a CAPPED run logged rather than silently skipped, and **automatic degradation to a free provider**
  instead of failure. `search_runs` records provider, query, results, ingested, quarantined, cost
  and who ran it. **Ask-your-listening** answers from the stored corpus with citations and
  **abstains with the corpus size** when the evidence is thin. KPIs `search_spend_30d`,
  `live_signal_share_30d` (catalog 73). 97 tables, 771/771 checks. Boundaries unchanged: no
  firehose, no full-archive, no paid vendors, **no third-party X mirrors** (ToS).
- **W3·E — AI-supercharged listening — ✅ SHIPPED (2026-08-01).** Wave 2 made listening
  trustworthy; this made it fast without spending the trust. **Semantic adjudication in the
  0.35–0.65 band only** (outside it the keyword gate is already decisive and the model is not
  called), prompted that Arabic names are also ordinary words, free to answer UNSURE · **the verdict
  is written to `aiVerdict` beside the queue and never touches `reviewStatus`** — a test asserts the
  analyst's ruling is untouched, because those rulings are the ground truth that tunes the
  thresholds · **`ai_relevance_agreement_pct` measures whether the model actually agrees with the
  analysts**, over human-ruled signals only, and a test proves disagreement lowers it · **theme
  clustering** (`osint_themes`/`osint_theme_signals`) turning "sentiment is −0.2" into named
  recurring themes with volume, tone and quotes, **discarding any theme with no evidence behind
  it**, flagging ones rising against their own baseline, all as DRAFTs · **query expansion learned
  from real rulings**, proposing terms *with the evidence each came from* and storing them for
  review rather than applying them · **competitor briefs from corroborated clusters only**, with an
  explicit refusal when coverage is single-source. KPIs `themes_active`,
  `ai_relevance_agreement_pct` (catalog 75). 99 tables, 800/800 checks. Boundaries: no embedding
  store, no AI sentiment on individuals, no autonomous topic creation.
- **W3·F — Forecasting & budget scenarios — ✅ SHIPPED (2026-08-01).** Damped Holt trend + weekly
  profile over `metric_snapshots`, **no ML dependency, nothing stored** (a forecast is a view of the
  data, not a fact about it). **Always an interval**, widening with horizon from *earned* residuals
  rather than assumed error. **Two refusals, both tested:** below 21 observations it says how much
  history it needs, and when residuals approach the series' own variance it refuses as "too
  volatile" — a smooth line through noise is the most confidently misleading thing shippable.
  Trend damping proven by test (late steps smaller than early ones). Target-arrival projections with
  a landing probability, feeding the existing pacing surface · **budget scenarios** priced on each
  channel's real cost-per-lead, returning a **range with its assumptions printed** (attribution by
  spend share; cheap-at-this-size may not stay cheap), refusing impossible shifts, never touching a
  real budget · **`forecast_accuracy_30d` is back-tested**, not asserted — forecast from a week ago
  vs what happened, including band coverage. 99 tables, 827/827 checks (catalog 76).
- **W3·G — Media-mix modelling — ✅ SHIPPED (2026-08-01).** Stage 1 delivered exactly as
  architected: `mmm_weeks` weekly panel (spend by channel + outcome + controls) with a
  **completeness score that marks a week unusable when it has spend but no outcome** · **adstock
  and saturation as inspectable transforms** — the saturation point ("Meta saturates around $X/wk")
  is actionable before any model exists · **ridge with non-negative coefficients** by projected
  gradient, so no channel is ever credited with destroying demand · **collinear channels reported
  as inseparable rather than silently credit-split** (tested with a deliberately mirrored channel) ·
  diagnostics (R², holdout MAPE, collinear pairs, completeness) returned by default and stored with
  every fit in `mmm_runs`. **Stage 2 gate enforced and tested:** below ~80 usable weeks the fit is
  marked `directional`, **withholds cost-per-outcome entirely, offers no optimiser**, and carries a
  caveat with the real numbers; above the floor ROI and a range-with-assumptions suggestion unlock.
  Readiness panel states plainly "needs about 80, there are N" with an estimated ready date. KPIs
  `mmm_readiness_pct`, `mmm_holdout_error` (catalog 78). 101 tables, 858/858 checks. Boundaries:
  no Bayesian/Robyn dependency, no geo modelling, no incrementality testing, never auto-adjusts
  budget.
- **W3·H — Multi-department cores — ✅ SHIPPED (2026-08-01).** A department **dimension**, not
  cloned tables: `departments` + nullable `departmentId` on campaigns, leads, content, tasks, budget
  entries and dashboards. **Scoping is enforced once, in the CRUD factory** — so it covers every
  dimensioned endpoint rather than the one it was written for, and a test proves that across leads,
  campaigns, tasks and content. Reads outside a user's department return **404, not 403** (existence
  is itself information); writes across the line are refused; a scoped user's creates are forced
  into their own department and cannot be planted in another; moving a record between departments is
  refused. **Migration-safe by design:** unassigned rows stay visible to all and a user with no
  department is unscoped, so an instance that never adopts departments behaves exactly as before —
  both asserted by test. Deleting a department leaves its records intact and merely unassigned.
  Roll-up endpoint: heads see their own row, admins see all plus what is unassigned.
  **Bug caught by its own test:** `isAdmin` was derived from `role === "ADMIN"`, but this system
  determines admin-ness from the permissions object and has no such role — the head admin would have
  been silently scoped. 102 tables, 887/887 checks.

Estimated shape: ~101 tables, ~890 checks, catalog ~80.

**The through-line.** Wave 2 proved that honesty is a feature — sentiment that abstains,
corroboration counting owners not mastheads, thresholds measured against real rulings, snapshots
marked partial, a publish tick that fails loudly. Wave 3 adds AI, live search and econometrics:
three things that fail by producing output which is confident, fluent and wrong. The discipline has
to hold hardest exactly here. **Every AI output is a draft. Every forecast is an interval. Every
model states its data floor. Every claim cites its rows.**

---

## 9 · Session Protocol

- **Restore ritual:** upload `pulse.zip` → `cd /home/claude && unzip -q pulse.zip` →
  `cd pulse/backend && npm install && npm i --no-save @electric-sql/pglite`
  (frontend builds: `cd frontend && npm install`).
- **Exit criteria per session:** all checks green · repo repackaged to `pulse.zip` (tests +
  .github kept; node_modules/dist/data/.env stripped) · `APPLY-LATEST.sql` copied to outputs ·
  summary states honest scope boundaries.
- **This document** is amended in the same session as any scope change.

## 10 · Pulse's own KPIs
Provision a new client < 1 hour · upgrade = one migration run · zero hardcoded client strings ·
every claim in sales material covered by an automated check · every page passes Nabd gates.

**الحلم صار نبضاً. Let's build.**


---

## Wave 4 — The Operating Spine (in progress)

Source: `CMO-BRIEF.md` practitioner red-team; architecture in `WAVE-4-BRIEF.md`; security gate in `SECURITY-BRIEF.md` (SEC·A/B/C, not yet built). All CMO-brief recommendations adopted except WhatsApp broadcasts (→ W4·X, deferred and recorded, consent-gated).

**LAW OF WAVE 4 — audit before build.** Every cluster opens with a grep and census of its prior art. HELM-era survivors are promoted and unified, never duplicated. This law has already changed two designs and caught six defects in this wave alone.

### Shipped

**W4·H — Architecture, documented** · `ARCHITECTURE.md` at repo root: rails and their laws, engines, state-machine appendix, 16-entry decision log, conventions. `backend/scripts/census.js` generates the table census from `schema.sql`; `npm run docs:check` fails the build when docs and schema diverge or a new table declares no territory. All 102 tables classified into 14 territories.

**W4·G — Bayan (بيان), the language system** · Sibling to Nabd: Nabd is how Pulse looks, Bayan is how Pulse speaks. `BAYAN.md` charter (marketing register, direct imperative, calque blacklist, numeral/date/orthography policy) + `frontend/src/locales/glossary.json` (27 canonical terms, banned variants each with a replacement and a reason) + `npm run lint:ar` in CI. The lint found 82 real issues across 1566 entries and now passes clean. Fixed: transliterations («السوشيال ميديا», «بايو»), colloquialism («طابور»), and «المراقبة» → «الرصد» — surveillance was the wrong word for a product whose guardrail exists to reject it. `frontend/src/lib/bayan.ts` adds a six-category Arabic plural engine, bidi isolation, and hijri dual dates on native `Intl`. The charter also exposed a live defect: `ar-EG` was rendering all dashboard data in Arabic-Indic numerals against §3, now `ar-EG-u-nu-latn`.
**Rule:** the lint checks vocabulary, never grammar — case inflection is correct Arabic, and a linter that fails valid Arabic teaches contributors to disable it.

**W4·A — The campaign spine** · Lifecycle transition matrix (`PLANNING → ACTIVE → PAUSED/COMPLETED → ARCHIVED`, PLANNING kept over DRAFT because existing rows use it and the word is better), with the pre-existing brief-required activation gate preserved. **The matrix is the single door**: plain CRUD status writes walk the same rules, or the matrix would be advisory. `CAMPAIGN_LINKS` registry over the FKs that already existed — the polymorphic join table was rejected mid-build as a second truth. War room endpoint with items, spend pacing, results, CPL and ROI. Campaign registered as a metrics **dimension**, so per-campaign series ride existing snapshots. Grounded retro draft that declines when evidence is thin. Five missing attribution FKs added. **Zero new tables.**

Side effects worth recording: `/metrics/:key/slices` gained `?dim=` filtering — campaign is the first second-dimension on a metric, which exposed that the endpoint returned all dimensions mixed.

**W4·B — Data foundation** · `import_jobs` wizard: quote-aware CSV parser (the legacy split(",") mangled quoted company names), auto-mapping, per-row validation with line numbers, dedupe against file *and* database, skip/update/merge strategies, consent captured at commit into the existing `contacts.consent` ledger. **Declared self-loops:** re-mapping legal, re-committing refused — a double-click cannot double-import. The HELM-era `POST /leads/import` still works; promotion, not replacement. **Segments promoted** from label to audience: `definition` evaluated by the workflow engine's `evalCond` — one evaluator, ever — with a per-source field whitelist as the injection gate and live count preview before saving. +1 table.

**W4·C — Value & the lead loop** · `conversions`: one row per realised amount, campaign attribution inherited from the lead, USD-normalised. A value-capture point, not a CRM — and MMM's missing y-variable. Lead loop: assign starts a `followUpDueAt` clock, contact stops it, a Daily Pulse step breaches overdue leads **once** (`slaBreached` latch) and escalates to the department head. **KPIs registered: `conversions_value_30d` (campaign-sliced), `marketing_roi_90d`, `lead_followup_sla_pct_30d`, `campaigns_active`** — catalog 78 → 82. +1 table.

**W4·D — Calendar, approval SLA, link builder** · Audit found more prior art than the brief expected: the content calendar page, QR generation, and inbox→lead conversion all already shipped. Built what was actually missing: unified `calendarFeed` adding the **publishing queue and the seasonal layer**; `seasonal_packs`/`seasonal_events` as seeded data with **hijri month/day resolved per year via native Intl Umm al-Qura** (Ramadan moves correctly; each occurrence carries its `prepFrom` lead time); `approval_delegations` with overlap refusal and window-scoped authority; `decideOne()` extracted so **bulk approval is N single decisions** through the same permission checks, side-effects and audit trail; approval escalation as a Daily Pulse step with an `escalatedAt` latch; UTM composition and QR for **any** tracked link, not just media placements. +3 tables.

**W4·E — Experience & productization** · `process_templates` **promoted** to the general library (`kind` + `definition`; existing PROCESS rows untouched) with seeded bilingual campaign and workflow starting points — campaign templates carry their brief so a new user is not blocked by the activation gate, workflow templates instantiate inactive for review. Role homes (`/api/home`) scoped by permission, each queue carrying the age that makes it urgent. Setup checklist **computed from live data, never stored**. Morning Pulse extended with an action block (approvals + stale, leads due + overdue, review depth + oldest age, campaigns ending this week). **Zero new tables.**

Recorded: the demo seed truncates and re-seeds `process_templates`, so library rows had to be added to **both** seeds — the demo instance must showcase the library too.

**W4·F — Listening Control Room** · Audit found `osint_topics` already carried query/mustInclude/mustExclude/contextTerms/reviewThreshold — **topics ARE the watches**, so promoted (campaign attach → SOV in the war room, assignee, shrink-only pause) rather than a new `watches` table. Built: **replay preview** re-scoring the trailing window with the pipeline's own `scoreRelevance` and writing nothing; `listening_changes` versioning every tuning edit with its replay and rendering as **chart markers**; block-vs-mute as distinct levers (**mute enforced at `entitySov`**, pause enforced **at ingest** — levers that bite where they matter, not settings rows); admin-only regrading with a mandatory written reason; queue assignment, bulk rulings and an SLA with oldest-item age; `listening_alert_rules` with spike baselines, corroborated-only, quiet hours and firing dedupe; budget meters **reusing the search rail's `budgets()`** rather than a second meter that could disagree. +2 tables.

**Guardrail correction recorded:** the control room initially excluded `PUBLIC_FIGURE`, making it *stricter* than the recorded guardrail and breaking legitimate spokesperson PR monitoring. `CONTROLLABLE_ENTITY_KINDS` now mirrors the `osint_entities` check constraint exactly, and a test asserts the two cannot drift apart in either direction.

### Wave 4 complete
**109 tables · 1134/1134 checks · 82-metric catalog · 9 production dependencies · zero new dependencies across the entire wave.**

### Remaining
W4·X WhatsApp broadcast campaigns (deferred, recorded, consent-gated) · SEC·A/B/C security gate (architected, not built) — SEC·A first, before any enterprise security review.

**Wave-wide DoD:** audit log first · N/N green · KPIs registered or ops-exception with reason · **Bayan compliance (`lint:ar` green)** · **ARCHITECTURE.md section current (`docs:check` green)** · ADMIN-GUIDE section · masterplan amended.


---

## Security Gate — SHIPPED (SEC·A / SEC·B / SEC·C)

Source: `SECURITY-BRIEF.md`, answering RED-TEAM-BRIEF items 3, 2 and 5. **Zero new production dependencies across all three.**

**SEC·A — Secrets at rest.** `crypto.js` rail: AES-256-GCM on native node:crypto, `enc:v{n}:{iv}:{ct}:{tag}`, **AAD-bound to `table:row:column`** so a ciphertext cannot move between rows, per-instance key in the environment only, versioned rotation, fail-closed. **Encrypt what we use** (`social_accounts.accessToken`, `users.totpSecret`, `sso_connections.clientSecret`); **hash what we verify** (bcrypt passwords, SHA-256 `portal_tokens.token` and `erasure_requests.verifyToken` — existing magic links keep working, a dump yields none). `SECRET_SCAN` in CI. Migration/rotation/audit CLI. Crypto posture on `/api/health`. *The scanner proved itself the same session: it caught `sso_connections.clientSecret` the moment SEC·B added it.*

**SEC·B — SSO.** OIDC-first; **SAML refused at the schema level**, not half-implemented — same IdPs, no XML-DSig attack class, no new dependencies. Discovery + PKCE S256 + state + nonce in an HMAC-signed httpOnly cookie (no state table), ID token verified for signature/iss/aud/exp/nonce with JWKS refetch on unknown `kid`, domain allow-list, JIT provisioning with claim→role mapping, **the same session token the password flow issues**. `ssoRequired` closes password login except for one designated **break-glass** administrator — mandatory before the mode can be enabled, irremovable while it is on, every use audited. `auth_events` records every attempt. Tested against a **self-signed IdP stub with zero network**.

**SEC·C — Erasure & export.** `PII_MAP` + `PII_SCAN` (three buckets, because a column name cannot say whose data it is). **Anonymise, never delete** — the board pack is not rewritten. Per-request email sentinel; NOT NULL columns get `[erased]`; failures reported, never swallowed. Identity verified by the subject's own link (token hashed) or by an admin with written evidence — and which is recorded. **Confirm by rediscovery**: the request closes only when the discovery engine finds nothing. Hashed `erasure_log` enabling **replay after a backup restore**. Export rides the same map.

### State
**113 tables · 1264/1264 checks · 82-metric catalog · 9 production dependencies.**

### Remaining
W4·X WhatsApp broadcast campaigns (deferred, recorded, consent-gated) · SOC 2 (process, not code — SEC·A/B/C are the controls an auditor samples).


---

## Demo instance — complete (2026-08-03)

`seed-demo.sql` now covers **all 113 tables · 4,462 rows**, up from 68 tables. Every screen has something true to show, and all dates are relative to installation.

Highlights: 90 days × 34 metrics of snapshot history with weekly seasonality and a seeded anomaly (3,960 rows) · campaign spine with briefs and one closed campaign with its retro · conversions and a lead loop with deliberate SLA breaches · an import job with realistic dedupe stats · Admiralty-graded listening sources with one muted and one blocked, alert rules and tuning-change markers · an MMM run **refusing** at 34 weeks against a floor of 80 · an AI run that **abstained** · SSO configured-but-off, auth events, and a completed erasure with certificate.

**Bugs this work surfaced (all real, all pre-existing or newly introduced by the seed):**
- `TRUNCATE departments CASCADE` silently wiped the demo's own **user accounts** — users reference departments.
- `TRUNCATE assets CASCADE` reached `content_variants` → `scheduled_posts`, emptying the Publish territory seeded moments earlier.
- **`RESTORE_ORDER` listed `departments` last**, after `campaigns` which references it; restore aborts on the first failing table, so everything after campaigns was left empty. `osint_sources` was also listed **twice**, violating its own primary key on the second insert. Both fixed in `export.js`.
- The demo seed was **truncating and replacing the metrics catalog**, destroying composite component weights. It now fills gaps only and never overwrites code-registered truth.
- A staleness test aged **all** snapshots by ten days, which collides with the `(metricKey, dims, date)` unique key once real history exists; rewritten to delete-and-restore the recent window.
- Three W4·C assertions used absolute totals; scoped to their own fixtures.
- Non-deterministic `ORDER BY "createdAt"` with tied timestamps handed the same lead to two event registrations.

### State
**113 tables · 1264/1264 checks · 82-metric catalog · 9 production dependencies · demo covers 113/113 tables.**

---

## W4·UX — Seven Chairs (2026-08-13)

Source: `PERSONA-AUDIT.md` — seven personas (first-run admin, marketer, approving GM, CMO, agency lead, analyst, principal engineer) sat at a live instance; every finding verified in code. Baseline before touching anything: 113 tables, 1,264/1,264.

**The two P0s were wiring failures on the most-touched surfaces, not design failures:**

**Approve with eyes** · `GET /approvals` now hydrates a uniform `preview` per row — one batched query per entity type present (no N+1; inbox capped at 200), covering scheduled_posts (title, caption AR/EN, platform·format, slot time, media), invoices (vendor · number, amount), deliverables (title, due, revision round, submitted file) and asset_versions (name · vN, file). **An unknown entity declares `preview: null`** — the inbox never breaks and never blocks on what it can't describe. The UI renders the preview in the pending card *and again in the decide modal*, and `ENTITY_LINK` now deep-links scheduled_posts → /publish and content → /calendar instead of the dashboard. Hydration is read-only — a test proves deciding still releases the slot through the engine.

**Composer media** · `content_variants.assetId` existed since Wave 1; publishtick already joined it; the API already accepted it; the composer never offered it — the interrupted-run pattern in miniature, caught by the persona walk rather than a grep. The composer's new-variant branch now carries a media rail: pick an IMAGE/VIDEO from the DAM or upload inline (file → storage rail → asset row → `assetId`), thumbnail chip with remove. The queue list joins `assetUrl` and every row shows its media — assignee and approver both see what ships.

Also: Calendar save/delete wrapped with visible error toasts (a failed write used to vanish); four Bayan-clean dict keys (`pb_media*`).

**Recorded, designed, not built (from the audit):** inline quick-draft in the composer routed through the existing approvals engine (kills the Monday-morning dead end; until then the gate message signposts Calendar) · **W4·PERF**: `crud.js` visibility-aware SQL pushdown + keyset pagination for the four heavy tables (today's full-table load into Node is correct but pathological at month-12 scale; frontend dropdowns legitimately depend on full lists, so this is a cluster, not a hotfix) · Report page must say "module off," never render zeros that mean off · best-time-to-post from snapshot history (abstain under floor, same discipline as forecasting) · calendar drag-reschedule · per-platform caption preview.

### State
**113 tables · 1,272/1,272 checks · 82-metric catalog (no new KPIs — UX wiring) · 9 production dependencies · zero schema changes.**

---

## W4·UX2 — The Backlog Starts Falling (2026-08-13)

Three of the six recorded audit items built, each through an existing rail rather than beside it:

**Quick-draft through the engine** · The Monday-morning dead end is closed. The composer's content picker leads with **＋ New draft**: title AR/EN + channel, created inline. `POST /content/:id/request-approval` is the single door — it walks the item to REVIEW and files it with the **same approvals engine** as slots and invoices (`ENTITY_RULES.content_items`: approve → APPROVED only from REVIEW, reject → IDEA only from REVIEW; an item someone already walked on the calendar is left untouched). The approver's inbox previews the draft (title + channel) via a new `content_items` previewer. The composed slot is **forced DRAFT** on this path and the gate messages now signpost "send it for approval first" — the loop is proven end-to-end by a test: draft → request → approve → QUEUED succeeds. Idempotent re-request (one PENDING row), 409 on approved items, rejection returns to IDEA. Inline upload on this path defers the asset row to save-time, once the content item exists to own it.

**Best hours, grounded or silent** · `GET /scheduled-posts/best-times?platform=` ranks posting hours from the platform's **own measured posts** using the analytics rail's ER definition (engagement over reach-else-impressions). Floors are the feature: <12 measured posts → abstains with the count; an hour with <3 posts cannot rank however loud (a 90%-ER n=1 midnight post is excluded by test). Hours are UTC and say so. The composer renders the hint under the slot picker — amber when it speaks, muted with (n/floor) when it declines. **Deliberately not a catalog metric**: it is a suggestion surface, not a KPI.

**Report honesty** · Listening and planning cards on the board pack now render **"Module off"** instead of zeros when the module is disabled — a zero that means *off* reads as a collapse, violating grounded-or-silent on the one page printed for the GM.

Also: `ap_e_scheduled_posts` / `ap_e_content_items` labels (the approvals inbox no longer shows raw table names for the two newest entities).

**Still recorded:** W4·PERF pagination pushdown (a cluster, not a hotfix) · calendar drag-reschedule · per-platform caption preview.

### State
**113 tables · 1,284/1,284 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

---

## W4·UX3 + W4·PERF — The Audit Backlog, Cleared (2026-08-13)

The last three recorded items from `PERSONA-AUDIT.md` shipped. **The persona-audit backlog is now empty.**

**W4·PERF — pagination pushed into SQL** · The generic list handler no longer loads whole tables into Node to slice them. The page is cut in SQL wherever the W3·H visibility predicate allows, on a three-branch matrix: (1) no department scope on the request, or the table has no `departmentId` column → plain `LIMIT/OFFSET`, with default-query tables paging on `(orderBy, id)` so **timestamp ties cannot duplicate or drop rows across pages** (a test inserts twelve distinct-timestamp rows and proves consecutive pages disjoint); (2) scoped user + default query + dept column → the **same predicate `visible()` applies, expressed as parameterized `WHERE`**; (3) scoped user + bespoke `listSql` + dept column → the pre-existing in-memory path, byte-identical — correctness beats speed where the join shape is custom. The external contract is unchanged everywhere: `X-Total-Count` counts **visible** rows, and unpaginated requests still return full lists, so every dropdown survives. Table→column introspection via `information_schema`, cached per router.

**Harness lesson recorded:** the scoped-pagination assertions could not live in a late block — `/auth/login` is IP-rate-budgeted and **saturated by design** before the final rate-limit test (a probe showed the clean 429). They live inside the W3·H block instead, where the scoped token is minted mid-suite. Any future test needing a fresh login must splice mid-suite, not at the tail.

**W4·UX3 — drag to reschedule** · Month-view content chips are draggable onto other day cells; time-of-day travels, only the date changes, `PATCH /content` through the already-guarded path with toast on refusal. Pointer affordance only — touch keeps tap-to-edit; events and campaign markers deliberately stay put.

**W4·UX3 — the post preview** · The composer renders the variant as it will read: dir-aware caption (AR-first for Arabic readers), hashtags, attached media, and a per-language character counter against documented platform ceilings (`CAPTION_LIMIT`). Over the ceiling the counter turns clay and names it — **warns, never blocks**, because platforms truncate more often than they reject.

### State
**113 tables · 1,290/1,290 checks · 82-metric catalog · 9 production dependencies · zero schema changes across all three audit waves.**

---

## W3·G2 — MMM Stage 2: Earned Numbers Above the Floor (2026-08-13)

Source: `MMM-STAGE2-BRIEF.md`. The horizon item "MMM Stage 2 — gated on data readiness" is now **built**; the gate remains, joined by three more. Baseline audit caught the half-truth in the plan: a Stage-1 `optimise()` already existed above the floor — moving a flat 15% on *average* cost-per-outcome with a `×0.5/×1.5` gain band and a holdout MAPE nothing acted on. Stage 2 replaces asserted numbers with earned ones:

**The skill gate** · `naiveMape` (train-mean onto the holdout, same formula) sits beside `holdoutMape`; the optimiser speaks only when the model beats it, else `null` with `diagnostics.optimiserNote` naming both figures. Above the data floor but below the skill floor is a new, tested refusal class.

**Resampled intervals** · Moving-block bootstrap (B=120, block 8 — blocks because weeks are autocorrelated), seeded mulberry32 with the **seed stored in the run** — every interval reproducible, proven by a same-seed-same-numbers test. Per channel: `roi {lo,hi}` (p10–p90) and `signalShare`.

**Per-channel abstention, probe-calibrated** · First cut used `coef > 1e-9` as survival; the planted-zero channel "survived" 73% of resamples — **floating-point residue from the non-negative projection is not signal**. A probe against planted ground truth calibrated the materiality rule: a draw counts only when the coefficient is ≥5% of that draw's largest media coefficient (leader 1.00, an 18%-strength channel 1.00, planted zero 0.38). Below 0.7 share the range is withheld with its reason, even above every floor.

**The optimiser walks its own curves** · Equal-marginal coordinate transfers on `coef·hill(adstock-steady·s)` across only the channels that earned a range; each bounded ±25% of current weekly spend; **budget conserved to the cent by construction**; lift evaluated per bootstrap draw → `projectedGain {lo,mid,hi}` per week + 12-week horizon; a band that cannot strictly bracket its own point returns `null` rather than asserting one.

**Compatibility held** · Everything additive; legacy `costPerOutcome` semantics and the W3·G optimiser-shape assertions untouched and still green. New tests run on dedicated outcomeKeys with ground truth generated through the model's own transforms. Zero schema changes, zero new dependencies.

### State
**113 tables · 1,302/1,302 checks · 82-metric catalog · 9 production dependencies.**

### Horizon (updated)
W4·X WhatsApp broadcasts (deferred, consent-gated) · SOC 2 · bus factor. ~~MMM Stage 2~~ — shipped; the remaining MMM gate is the client's own calendar: real deployments unlock it at ~80 usable weeks.

---

## SEC·D — SOC 2 Readiness: Audit Integrity & Access Evidence (2026-08-13)

Source: `SOC2-BRIEF.md`. SOC 2 is an audit of an organization, not a property of code — the brief's three-column honesty (shipped / built now / organizational) is the deliverable as much as the controls. Built:

**Tamper-evident governance trail** · `audit_log` gains `seq/prevHash/rowHash`; every entry extends `sha256(prevHash | actor | action | entity | entityId | canonical(meta))` through an in-process mutex — sound because deployment is one Node process per instance (the instance-per-client architecture is itself the concurrency argument; a multi-process future takes an advisory lock, recorded). Defense in depth: a trigger makes the table **append-only** (UPDATE/DELETE raise, even for the app role); the chain covers what the trigger cannot and vice versa — `createdAt` sits outside the hash by declared design, guarded by the trigger. `GET /api/security/audit-verify` walks the chain: `{ok, checked, legacyRows, firstBreakSeq}`.

**Two real findings from the test on day one:**
1. **The portal wrote the trail through a raw INSERT** — a second door producing unhashed rows. Closed: `logAuditSystem` is now the trail's only req-less door; portal rides the same chain and mutex.
2. **The demo seed plants five sample audit rows** (Yousra Idris, relative dates) — pre-chain by design. That reframed the contract from "zero legacy" to the stronger invariant: **legacy is declared exactly, and no runtime writer can ever add to it across an entire run** — now a standing test that will catch any future unhashed writer the day it appears.

**Access review, live** · `GET /api/security/access-review`: every account × role × admin flag × last successful login (auth_events, refreshes excluded) × dormant at 90d, with summary counts — surfaced on System beside one-tap chain verification. **Evidence pack** · `npm run soc2:evidence`: dependency inventory, table census, and 14 product controls verified by static inspection of the repo (the generator caught its own first overclaim — a wrong file path for the headers control — and refused to bless it), ending with the organizational checklist where **the bus factor of one is named as the top open segregation-of-duties risk**. Columns + trigger only — **table count unchanged at 113**; zero new dependencies (node:crypto).

### State
**113 tables · 1,313/1,313 checks · 82-metric catalog · 9 production dependencies.**

### Horizon (updated)
W4·X WhatsApp broadcasts (deferred, consent-gated) · bus factor (organizational; now formally recorded in the SOC 2 evidence pack as the top open risk). ~~SOC 2~~ — product controls shipped with evidence-on-demand; the organizational track is enumerated in `SOC2-BRIEF.md` column 3 and generated into every evidence pack.

---

## SEC·E — Continuity: The Bus Factor's Technical Share (2026-08-13)

The bus factor is a people problem; this cluster ships its **technical share** and names the remainder instead of dressing it up. The baseline audit opened with the perfect specimen: **`devDependencies` was empty** — the entire 1,318-check suite imports `@electric-sql/pglite`, declared nowhere; the requirement lived solely as an `npm install --no-save` workaround inside `ci.yml`. A successor's `npm ci && npm test` would have died at the first import. Fixed: the dependency is declared, the CI workaround deleted, and a standing test now asserts the declaration — trapped knowledge converted into a failing build.

**`CONTINUITY.md`** · The day-one successor document: reading order for all eighteen root documents, an honest systems-and-access register where every row currently reads **Founder only** (the register *is* the risk statement), a one-line operations index for all fifteen npm scripts, incident quick cards (outage, bad deploy, data loss, IdP lockout → the audited break-glass account, tampering → chain verification), and a closing section that refuses to pretend: the irreducible item is an appointment, not a commit.

**`npm run continuity:drill`** · Successor-readiness as an 8-second command on an embedded instance: schema+seed → boot → the **real installer** creates the first admin → probe data → **real backup** → deliberate destruction → **real restore** in FK-safe order → **governance chain verified on the recovered instance**. The drill's first run met Pulse's own honesty: a virgin instance's `/health` correctly answers 503, so the drill probes `setup/status` instead — the honest installer state is the right first signal. The drill runs **inside the suite** as an async child (a sync spawn froze the parent's event loop and staled the harness server's keep-alive sockets — ECONNRESET in the next block; recorded as a harness law: child processes in the suite must be async).

**`npm run continuity:check`** · The runbook's completeness gate, in CI: every npm script and every root document must be referenced by literal name (generated `SOC2-EVIDENCE-*.md` exempt), the drill must exist, and the harness dependency must be declared — the runbook cannot quietly fall behind the repo.

**Evidence pack** · Two new verified controls (A1.3 recovery drill, CC1.4 CI-gated runbook — 16 total) and the organizational bus-factor line sharpened: *a NAMED second human holding the register's credentials, who has run the drill on their own machine* — mitigations shipped, substitute refused.

### State
**113 tables · 1,318/1,318 checks · 82-metric catalog · 9 production dependencies (+1 declared dev dependency the suite always needed).**

### Horizon (final form)
**W4·X WhatsApp broadcasts** (deferred by choice, consent-gated) — the only remaining build item. **The appointment** — a second keyholder who has run the drill — the only remaining organizational item, printed by every evidence pack until made.

---

## W4·AR + W4·BLD + W4·NAV — Market Arabic, Builders, Seven Groups (2026-08-14)

Source: `UX-LANGUAGE-BRIEF.md`. Three tracks, one standard.

**W4·NAV** · 35 flat menu entries → **seven job-named groups** (يومك · التخطيط · النشر والإبداع · الاستقطاب والتحويل · القياس والفهم · الشركاء · الإدارة). Nothing removed, filtering rules byte-identical, mobile tabs untouched — and one genuine find fixed: **the Executive Report page had no menu entry at all**; it now sits under Insight. A static suite test walks the nav registry against the router: every pre-existing route present, `/report` present and routed, ≥7 groups — the IA can no longer silently lose a screen.

**W4·AR** · The CMO pass, codified as **BAYAN § لغة السوق**: executive marketing vocabulary (الاستقطاب والتحويل، الولاء، العلاقات الإعلامية), honesty in naming (**المستشار الذكي، never المدير** — the menu must not promote the machine above the human), the disambiguation rule (التواصل banned as a screen name; it collided between social and outreach), rail discipline (≤2 words), and street-warm respondent copy («نلقاك في الفعالية», never «يرجى إدخال…»). Applied: three precision renames (Reach → العلاقات الإعلامية، AI CMO → المستشار الذكي، Growth → النمو والولاء), seven group names, the full builder vocabulary — 29 new/changed strings, all Bayan-green.

**W4·BLD** · One shared `Builder` for Forms + Surveys: **quick-start templates** (lead capture / RSVP / quote · NPS / CSAT / event feedback, fully bilingual), type-chip palette, ↑↓ reorder, machine-managed item keys (humans never type a database key again), auto-slug from the name, and a **live respondent preview** — RTL Arabic-first with a language toggle — beside the editor. Zero backend changes: both template payloads are posted **verbatim** through the real API and read back intact by tests, and a respondent submits the templated form through the public door in-suite.

**The gates guarded themselves twice this session:** SEC·E's continuity check failed the build the moment `UX-LANGUAGE-BRIEF.md` landed unregistered (fixed by registering it), and the nav test caught its own wrong regex before it could bless a missing route.

### State
**113 tables · 1,324/1,324 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### Recorded, not built
Landing-pages builder parity (templates + preview, same `Builder` family) · Links page quick-copy + QR chip · the deep dict pass beyond navigation/builders (the § لغة السوق charter now governs it).

---

## W5·NERVE — One Money Truth, One Connected Spine (2026-08-14)

Source: `NERVE-BRIEF.md` (architected during the outage, executed on reconnection after a byte-perfect post-outage audit: 113 tables, 1,324/1,324 confirmed before a line changed).

**The baseline audit reshaped the design twice, both times for the better:** invoices carry `campaignId` **directly** (no engagement mediation, no allocation-split question), and invoice approval **already writes the SPENT budget entry** — so the triad reads **ledgers, not documents**: المخطط = `campaigns.budgetUsd` · الملتزم = RECEIVED invoices + booked placements on campaign-linked plans · المصروف = `ad_spend` + `budget_entries(SPENT)`. Approved money flows into actual through the existing rail — **money never gets a second writer, nothing counts twice**. PAID is a cash status, not a spend event, and stays out of the triad by declared design. Health at (actual+committed)/planned: ضمن الحد / اقترب من الحد / تجاوز الحد at 90/100.

**Unlinked money is declared** — a first-class pool on the overview («أموال غير مربوطة بحملة»), never zeroed, never guessed into a campaign: grounded-or-silent applied to finance. **Two reconciliations are law and test**: campaign rows + unlinked pool ≡ totals, and the channel rollup decomposes exactly the same actual.

**Control at the signature** · the invoices previewer computes the same triad and the approval card states *"this approval takes «X» to N% of its envelope"* — a RECEIVED invoice already sits inside committed, so pctAfter ≡ current pct (approval just moves it committed→actual; one truth). Amber ≥90, clay ≥100. Warn, never block.

**Strategy joins the spine** · `objectives."campaignIds" jsonb` (columns-only ×3 SQL surfaces; engagements' own pattern; 113 preserved) with a checkbox picker in Planning and a nerve line per objective; `GET /api/nerve/campaigns/:id` returns money + twelve tissue counts + the objectives served (`@> jsonb` containment). Finance wears the budget module's own permission gate — proven by a parity test, not a new gate.

**Thirteen planted-number checks, first-run green**: 10,000/3,000/5,500 = 85% ضمن الحد → 95% اقترب → 110% تجاوز with the clay signature line at exactly 110% · unlinked 777 lands only in the pool · both reconciliations exact · tissue counts equal planted rows · the objective loop closes.

**Recorded, not built:** the Nerve panel inside the campaign room UI (endpoint shipped + tested; panel wiring next) · budget_entries kind=PLANNED as per-campaign allocation detail lines · SDG mirror of the triad via rateAtEntry.

### State
**113 tables · 1,337/1,337 checks · 82-metric catalog · 9 production dependencies · columns-only schema change.**

---

## W5·NERVE2 — The Room, the Allocations, the Mirror (2026-08-14)

The three recorded items from W5·NERVE, shipped — and the baseline audit upgraded the first one: asking "who fetches `/room`?" revealed the W4·A war-room backend had **no UI consumer at all** — the interrupted-run pattern, again caught by an audit rather than a user. So "wire the nerve panel into the room" became "**build the room**": tapping a campaign's name opens its drawer — money bar + health pill, twelve tissue chips, the objectives served — with the nerve endpoint as first tenant. (The room payload's remaining sections — brief, retro, links — join the drawer next; recorded.)

**Allocations inside the envelope** · `budget_entries kind=PLANNED` per campaign surfaces as an allocation chip on the Finance Model; `allocated > planned` raises **overAllocated** — a named clay flag («تتجاوز الغلاف»), never a silent overflow, proven by a planted 150-of-100 case.

**The SDG mirror, per-row honest** · Each money row converts at *its own truth*, in strict precedence: its recorded `amountSdg` first, its `rateAtEntry` second, today's settings rate last — proven by a planted trio (100@600 + 50@today + 40-with-own-26,000 = **exactly 111,000**) and a committed invoice at its 550 entry rate. A campaign's own `budgetSdg` outranks any conversion (1,300,000 wins over 2,000×500). The overview declares `sdgMeta { currentRate, atEntrySharePct }` — the mirror names what share of the money carries entry-day truth. **The SDG totals reconcile by the same law as USD**: campaigns + unlinked ≡ totals, now a standing test. Two bugs were mine and caught in-run: triadRows never SELECTed `budgetSdg`, and the nerve's money projection dropped the mirror fields — both one-line fixes the planted numbers refused to let pass.

### State
**113 tables · 1,345/1,345 checks · 82-metric catalog · 9 production dependencies · zero schema changes this wave.**

### Recorded, not built
Room drawer's remaining tenants (brief status, retro, quick transition) · department/channel SDG rollups · allocation lines editable from the room itself.

---

## W5·NERVE3 — The Room Completed (2026-08-14)

The three recorded items from W5·NERVE2, shipped.

**The room's remaining tenants** · The drawer now consumes the full W4·A `/room` payload: brief status (green «الموجز جاهز» / amber «لا موجز بعد — التفعيل يتطلبه»), CPL + ROI when computable, **quick transitions** offering exactly `allowedTransitions` from the matrix — COMPLETED opens a learnings box first, and a refused transition (the brief gate) surfaces its server message in the drawer verbatim — and the retro renders once written. Transition and allocation controls are permission-gated (`campaigns`/`budget` write) in the UI while the server remains the enforcer.

**Allocations editable from the room** · add/delete lines ride the existing `/budget` CRUD (rateAtEntry auto-filled at create, so the mirror stays honest) — proven end to end through the API: a 300 allocation posted through the rail lands in the model, and deleting it clears it with no ghosts.

**Rollup mirror** · `byDepartment` gains plannedSdg/committedSdg/actualSdg; `byChannel` gains actualSdg — both under the standing law: the channel SDG decomposition ≡ `totalsSdg.actual`, and a planted department read back exactly 400/260,000 planned · 80/48,000 actual. Budget shows a compact by-channel row.

**One find**: `can` was destructured only inside `BriefPanel` — the main Campaigns component never had permission awareness; it does now.

### State
**113 tables · 1,351/1,351 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### Recorded, not built
Department SDG rollup surfaced in UI (API shipped) · allocation lines with SDG amounts entered directly in the room · room drawer deep-link (`/campaigns?room=<id>`) for Morning Pulse and Report cross-links.

---

## W5·NERVE4 — The Last Connections (2026-08-14)

The three recorded items from W5·NERVE3, shipped.

**Room deep-link** · `/campaigns?room=<id>` opens the drawer on arrival (URL syncs on open/close, `replace` so the back button behaves). Two consumers wired the same session: **Finance Model campaign rows** and **Planning's objective nerve-line names** are now doors into their rooms — finance → room and strategy → room, the tissue navigable in both directions. Morning Pulse cross-links recorded, not forced: its payload carries no campaign ids today.

**Department rollup surfaced** · the Finance Model shows حسب القسم triad lines (hidden when only one bucket exists — a single-department chart is noise).

**Allocation SDG, directly** · the room's add-row takes an optional SDG amount; `allocatedSdg` joins the model under the **same precedence law** (own SDG → entry rate → today's rate), proven by a planted pair reading exactly 160,000, and the unlinked pool declares orphan allocations in both currencies. **One honest correction mid-proof**: my assertion hardcoded rate 500, but `currentRate()` carries a 60-second cache — the test now asserts the real contract (a real rate is stamped; the mirror converts at exactly that stamp), which is stronger than the constant it replaced.

### State
**113 tables · 1,355/1,355 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### Recorded, not built
Morning Pulse / Report campaign-id enrichment so their mentions can deep-link into rooms · department rollup tap-through (department → its campaigns filtered) · room drawer keyboard navigation.

---

## W4·BLD2 + W4·AR2 + W5·NERVE5 — Parity, Wires, and the Street-Warm Law (2026-08-14)

Six recorded items, one session, three interrupted-run catches.

**Landing builder parity (W4·BLD2)** · `LP_TEMPLATES` (عرض خاص / صفحة فعالية / عرض منتج, fully bilingual) + `LandingPreview` mirroring `LandingPublic`'s exact four-block vocabulary (HERO with the ECG line, TEXT, FEATURES, CTA, plus the form marker) + auto-slug — Pages.tsx now reads like Forms and Surveys: template bar, editor left, visitor's truth right. Round-trip proven through `/landing-pages` and served through the public door.

**Links quick-copy + QR (W4·BLD2)** · Quick-copy already existed; the finding was better: **`GET /links/:id/qr` existed on the link-builder router with no consumer** — the interrupted-run pattern in miniature. The Links page now carries the ⬛ QR chip and modal on the existing rail; the test pins the printable data URL.

**Morning → rooms (W5·NERVE5)** · Second catch: the digest computed `campaignsEnding` **with ids** and Morning never rendered it. The fifth list now exists — «حملات تقترب من نهايتها» — each item a door into its room. **Dept tap-through** filters the Finance Model's campaign bars in place; **room keyboard**: ←/→ walk campaigns, Esc closes.

**The deep dict pass (W4·AR2), made durable** · § لغة السوق became mechanical: six glossary bans (يرجى، الرجاء، قم بـ، قم بت، الخاص بك، الخاصة بك) landed against an **already-clean dictionary** — 1,677 entries, zero hits, the street-warm law was being kept; now it fails builds instead of relying on memory. Third catch: banning «المدير الذكي» surfaced **four** hiding places the W4·AR nav rename missed (`brain_cmo`, `brain_empty`, `brain_notConfigured`, `brain_notConfiguredHint`) — all dethroned to المستشار الذكي / AI Adviser in both languages, and no future contributor can reinstate the director without a red build.

### State
**113 tables · 1,360/1,360 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### Recorded, not built
Report-side campaign deep-links (the board pack names campaigns without ids today) · LandingPreview theme tokens (per-client palette in the miniature) · QR chip on landing-page cards (same rail, one more consumer).

---

## AG·FIX + W5·WIRES — The Vendor Desk, Proven; The Last Consumers (2026-08-15)

**The vendor-page audit ("make sure it is working").** The rails were healthy — every mount correct, the suite's portal tests green — but the page itself had the failure mode users describe as "not working": **nine unguarded mutations and no toast anywhere** (the main component lacked even `useI18n` — the decide path had no feedback channel at all). Any refusal — permission edge, validation, a transition the deliverable state machine won't allow, module flag — rendered as a button that silently did nothing. Fixed uniformly: every mutation on the desk (save vendor, save engagement, decide, request-revision, advance, deliverable save, comment, mint, revoke) is guarded, confirms on success, and **surfaces the server's own refusal verbatim**. And the desk's exact click-sequence is now a standing suite walk — vendor → engagement → magic link (`/p/…`, plaintext-once by SEC·A design) → revoke → deliverable → advance — eight checks that keep "the vendor page works" true on every push. One test-side correction en route: my assertion expected `/portal/`; the guest door is `/p/` — the constant class of error again, fixed toward the real contract.

**W5·WIRES** · **Landing QR**: `GET /landing-pages/:id/qr` on the same artefact rail (mounted before CRUD so `/:id/qr` is not shadowed), ⬛ chip + printable modal on every card — pinned to `/l/<slug>`. **Theme token**: `theme.primary` now flows editor → `LandingPreview` → `LandingPublic` with the honest chain **page theme → client brand accent (`org.accentColor`, discovered in the payload) → Nabd amber**; round-trip pinned at `#0e7490`. **Report deep-links — recorded precisely, not forced**: the board pack renders no campaign *entities* (metrics dims carry names as chart labels only); the vehicle would be a "top campaigns" report section — a feature for a future wave, not a wire.

### State
**113 tables · 1,368/1,368 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### Recorded, not built
"Top campaigns" report section (the vehicle for board-pack → room deep-links) · engagement `campaignIds` picker on the desk (schema carries it; UI doesn't offer it yet) · portal-token QR (hand the printed code to a vendor's phone).

---

## UI·COVER + W5·WIRES2 — No Rail Without a Door (2026-08-15)

**The ask generalized the recurring defect** ("make sure everything in the backend or schema has its UI"), so the answer is a **standing gate**, not a sweep: `npm run coverage:ui` (in CI, registered in CONTINUITY.md) asserts every `/api` mount is consumed by the frontend, carries a reasoned permanent allowlist entry (guest portal, cron, webhooks, the pulse.js beacon), or sits in a **dated DEBT register printed loudly on every run**. Honest limitation stated in the script header: mount-level — subroute orphans (the `/room` class) remain the persona audit's job.

**First run: 14 flagged → 13 real orphans** — whole rails shipped with tests and zero frontend references, including SSO sign-in, erasure, and delegation. Five opened this session: **Login SSO button** (+ `/auth/sso/config` public probe) and the **System SSO-connections card** with live test — SEC·B finally usable; **approval delegation card** (window picker, revoke, server refusals verbatim — and the suite now pins both the success and the overlap refusal, after the first probe collided with existing test furniture and proved the validator works); **Calendar seasonal chips**; **engagement `campaignIds` picker** (the CRUD accepted it all along — pure UI). Plus the three carried items: **Report "Top campaigns by spend"** (budget-gated, five rows, health pills, room doors — the board pack's missing tenant), and **portal-token QR minted from the plaintext at the only moment it exists** — the hash can never rebuild it, so the QR ships in the plaintext-once response by design.

**Eight rails in dated debt** (imports · conversions · home — *inspect: possibly superseded* · listening/control · creative-briefs · dashboards · privacy · erasure workflow) — each line carries its date and destination, reprinted by every CI run until closed.

### State
**113 tables · 1,375/1,375 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### § UI-Debt Register
Living section, owned jointly with `backend/scripts/coverage-ui.js` — amend both together when a line closes.
Current (2026-08-15, after UI·DEBT4): **ZERO lines.** The register opened at 13 real orphans (2026-08-15), was reduced across four sessions — UI·DEBT1: home, erasure, creative-briefs, conversions · UI·DEBT2: imports · UI·DEBT3: listening/control · UI·DEBT4: dashboards — with privacy reclassified to the permanent allowlist (public subject-confirmation leg). The mechanism stays armed: any future rail without a consumer fails CI unless it enters this register with a date and a destination.

---

## UI·DEBT1 — Four Doors Open; the Register Shrinks 8 → 3 (2026-08-15)

**`/api/home` — fate decided: adopted, not retired.** Inspection revealed it is W4·E, the "9AM loop" — per-role action cards computed from live data, shipped and never consumed. The Dashboard now opens with it: what does Pulse want from me today, with overdue/stale badges and one-tap doors.

**`/api/erasure` — SEC·C finally reaches the operator.** A full workflow card on Contacts: open a request (`subjectEmail` — the first contract lesson of the session), send the verification email or verify manually, discover where the subject lives table by table, submit into the same approvals door as everything else. Two rail contracts corrected on *my* side, and one on the UI I had just written: manual verification refuses without **`evidence`** — "Record how identity was established" — so the card now demands the identity note inline before it will call the rail. The suite walks the entire chain on a planted lead.

**`/api/creative-briefs`** — Studio's briefs card: list + create against a creative request *or* an engagement; the orphan-brief refusal is pinned in the validator's own words. **`/api/conversions`** — not a definitions admin but a **recorder**: 💰 on every Customers row, amount + currency + notes, campaign attribution inherited so the value lands in its room; the header chip speaks the summary rail's real language — value against spend over a window, with ROI. **`/api/privacy`** — reclassified: it is the *public* subject-confirmation leg of erasure, consumed by the data subject's emailed link; permanent allowlist with that reason, not debt.

Session pattern worth naming: **four of six failures were my consumers being shallower than the rails** (`email` vs `subjectEmail`, `note` vs `evidence`, a WON lead is not yet a customer, `count/totalUsd` vs the ROI payload). The rails were right every time; the contracts won every time.

### State
**113 tables · 1,384/1,384 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

---

## UI·DEBT2 — The Import Wizard Gets Its Door, and Its First Walk Finds a Rail Bug (2026-08-15)

**The door.** W4·B's five-state import machine (UPLOADED → MAPPED → VALIDATED → PREVIEWED → COMMITTED) finally has its UI: one generic `ImportWizard` component, three doors — ⬆ on **Leads**, **Contacts** (with consent basis + list source captured at the mapping step), and **Customers** (conversions). The job's `status` IS the stepper; the UI never invents a sixth state; every refusal is the matrix speaking verbatim. Paste or pick a file, confirm the auto-guessed column mapping (required fields marked ●), choose dedupe key and merge strategy (**fill blanks only** / skip), check the rows, preview what will happen, then run it — `{created, updated, skipped}` on the way out.

**The bug the first walk found — two defects in the shipped W4·B rail:**
1. **Validation lied about numbers.** A `number:true` field fed "not-a-number" coerced to a silent `null` and *passed* validation, then detonated at commit against `leads."valueUsd" NOT NULL` — a 500 **after some rows had already landed**, with the job still claiming PREVIEWED. Fixed at `buildRows`: an unparsable number is a per-row error in the errors ledger, never a silent null.
2. **Commit was not atomic.** Fixed with a new platform primitive: **`tx(fn)` in db.js** — pins ONE client (pool checkout in production, the PGlite client in tests; naive `BEGIN` through the pool would land on a different connection), all rows or none. Inside it, the optional consent echo gets its own SAVEPOINT so it can fail without aborting the import, and **null columns are omitted from INSERT** so database DEFAULTs apply — an explicit null bypasses DEFAULT, which was half the detonation.

The suite's eleven-check walk pins all of it: auto-mapping, the required-field refusal, one bad row rejected not the batch, the duplicate declared at preview and merged not doubled at commit, value updated to the newer figure, a second commit refused by the matrix, and the job COMMITTED in history.

### State
**113 tables · 1,394/1,394 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### § UI-Debt Register (after this session)
Two lines: `/api/listening/control` · `/api/dashboards`.

---

## UI·DEBT3 — The Control Room Gets Its Door, and Finds the Dead Echo (2026-08-15)

**The door.** W4·F's seventeen-verb listening control-plane finally has its UI: `ListeningControl.tsx`, mounted behind a 🎛 toggle on the Listening page (intel-read to see, intel-write to touch). The cockpit strip shows live/paused, review backlog against SLA, per-provider search budgets with the 80% warning, and **the guardrail line printed verbatim from the server** — ORG · BRAND · PRODUCT · OUTLET · PUBLIC_FIGURE, "no control can widen this." Then the cards: **band calibration with replay-before-apply** (preview what the last 7 days would have done, then apply with a written note that lands on the trail); **sources** with Admiralty grade chips, the admin regrade demanding its written reason inline, and the two levers explained in the UI's own words — block stops ingestion, mute keeps collecting for evidence but hides from alerts and metrics; **watches** with assignee and pause; **the review list** with multi-select, the model's suggestion rendered as a 🤖 chip explicitly labeled "never a ruling," and bulk CONFIRMED/REJECTED whose toast reports how often the model agreed; **alert rules** under the guardrail with the four kinds, corroborated-only, and «ما الذي سينطلق؟» dry-run; and **the change trail** that explains the chart's jumps.

**The bug the first walk found — the dead echo.** The bulk-ruling route compared the analyst's verdict (`CONFIRMED/REJECTED`) against the model's verdict (`RELEVANT/NOT_RELEVANT/UNSURE`) **raw** — vocabularies that never intersect, so `agreedWithAi` was structurally always zero. The metrics engine's KPI mapped the two spaces correctly all along (the ledger was never wrong); only the live echo every analyst would see after every ruling was dead. Fixed with the same mapping the KPI uses; the fixture and the UI chip now speak the model's own vocabulary. Third session running where the door's first walk caught what surface tests couldn't — the coverage gate's thesis, proven again.

Bayan also caught the author: «طابور» is banned in the platform's own glossary (a physical line of people); the review queue is «قائمة».

### State
**113 tables · 1,406/1,406 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### § UI-Debt Register (after this session)
One line: `/api/dashboards`.

---

## UI·DEBT4 — Metric Boards; the Register Hits Zero (2026-08-15)

**The last line closes.** The dashboards rail — CRUD, the seeded «لوحة الإدارة», the `{metricKey, viz, size}` widget vocabulary — gets its builder: `MetricBoards.tsx` atop the Analytics page. Pick a board, flip into 🧱 build mode, hang widgets from **the 82-metric catalog grouped by category** (the palette is the same semantic layer the board pack reads — the modal says so in its own label), choose number or number-with-trend, wide or standard, reorder with ↑↓, rename, share, or start a new board. Every value renders through `GET /metrics/:key/value` and every trend through the snapshot ledger — **no widget can invent a value the catalog cannot compute**, and the suite pins the refusal of an unknown metric key to prove it.

One contract lesson (the recurring class, mild edition): the shared CRUD's DELETE speaks **204 No Content**; my assertion expected 200. The contract won, as always.

**The UI-Debt Register: 13 → 0 in four sessions.** Opened by the coverage gate's first run; every line closed with a real consumer, a suite walk in the page's own payloads, and — three times out of four — a genuine rail bug the door's first walk exposed (the import validation lie and non-atomic commit; the agreement echo comparing vocabularies that never intersect). The gate stays armed in CI: a rail without a door is a failing build.

### State
**113 tables · 1,414/1,414 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

### § UI-Debt Register (after this session)
**Empty.** The mechanism remains — `coverage:ui` in CI, DEBT map in `backend/scripts/coverage-ui.js`, this section as its mirror.

---

## W3·FIN — Wave 3, Proven Complete (2026-08-15)

**The audit before the build found the build.** "Do the remaining for Wave 3" opened with the mandatory census, and the census reshaped the session: all eight clusters exist on disk — `observability.js`, `ai.js`, `search.js`, `forecast.js`, `mmm.js`, `automate-engine.js`, the schema's `error_log`/`ai_runs`/`search_budget`/`osint_themes` — and the coverage gate being green meant every rail already had its consumer. **FlowCanvas was already wired** as Automate's action editor (this author's own stale note said "unrouted"; the component was the editor all along, 29 dict keys shipped with it). D, E, and G carried suite markers. What Wave 3 was missing was not code but **witness**: five clusters had never been walked.

**The five walks, sixteen checks, all green — zero production changes:**
- **W3·A** — a browser fault is acknowledged 204 and lands as a CLIENT row carrying a fingerprint, with the planted secret **structurally absent from the entire row** (the digest law); the full health report and the liveness stub remain two different doors (the SEC·A lesson, held).
- **W3·B** — the library teaches the canvas its vocabulary; a dry-run walks a nested IF against a real lead, logs which branch fired, and changes nothing; the drawn flow round-trips verbatim — both arms — into the same `workflows.actions` jsonb the runner has always read. One engine, no second path.
- **W3·C** — the rail states its own posture (`configured`, model, ceiling, spend against it); the drafts shelf answers; a decision outside PUBLISHED/DISMISSED is refused — humans dispose in exactly two ways — and deciding a non-existent draft is a plain 404.
- **W3·F** — below 21 observations the forecast **refuses and says how much history it needs**; above the floor it answers in ordered intervals lo ≤ mid ≤ hi, never a point.
- **W3·H** — a department-bound analyst (token minted by the platform's own signer — no login, no limiter noise) sees their department's campaigns and the shared ones, **not** the other department's; the head admin sees across all.

**Three consumer-side contract lessons, the recurring class:** the error beacon speaks 204 fire-and-ack; AI status says `configured`, not `enabled`; and the login rate-limiter's shared window means test fixtures mint tokens with `signToken`, never a fresh login late in the run.

### State
**113 tables · 1,430/1,430 checks · 82-metric catalog · 9 production dependencies · zero schema changes.**

**Wave 3: eight of eight clusters shipped and proven.** Remaining on the whole roadmap: W4·X WhatsApp broadcasts (deferred by choice, consent-gated) · W2·E OSINT hardening full build · the second keyholder appointment (an appointment, not a commit).

---

## NAV·CHECK — The Menu Is a Contract, and the Contract Is Tested (2026-08-15)

**The ask** ("make sure the groups list and menu got ordered, everything working and tested") **becomes a permanent gate**, in the platform's own style: `npm run nav:check` (in CI after `coverage:ui`, registered in CONTINUITY.md, run as a suite child) reconciles five artifacts against each other — **the router, the menu, the dictionary, the module vocabulary, and the icon set**. Every route must have a menu door or a named reason; every door must lead to a route; no path may hang twice; every label must speak both languages; every `flag` must be a module the System page can actually switch (`MODULE_KEYS` imported from `flags.js`) and every `mod` a real permission module (`PERM_MODULES` imported from `auth.js` — the checker holds the menu to the platform's vocabulary, never to a hand-copied list); every icon must have a drawing; and the **seven groups must stand in canonical order**: يومي ← خطط ← أنشئ ← اجذب ← افهم ← شركاء ← النظام. Disorder is a failing build, not a taste note.

**First run: 39 routes ↔ 39 menu items ↔ 7 groups ↔ 38 icons — one real defect.** `/library` carried `flag: "content"`, a switch that has never existed: "content" is permission vocabulary (in `PERM_MODULES`) but not module vocabulary (absent from `MODULE_KEYS`), and its rail mounts ungated by design. The dead flag looked like a control and controlled nothing — removed; the content library is honestly always-on, permission-gated only. Everything else already agreed: W4·NAV's ordering discipline had held, and now it cannot silently stop holding.

### State
**113 tables · 1,432/1,432 checks · 82-metric catalog · 9 production dependencies · zero schema changes · six standing gates** (docs census · Bayan · continuity · coverage:ui · nav:check · the suite itself).
