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
