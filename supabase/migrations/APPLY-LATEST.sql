-- Pulse (نبض) — apply latest changes to an EXISTING database. Run once in the Supabase SQL Editor.
-- Idempotent: safe to run more than once.

-- 1) Lead → campaign link (intelligence loop)
alter table leads
  add column if not exists "campaignId" uuid references campaigns(id) on delete set null;

-- 2) Strategy & Planning: objectives / OKRs
create table if not exists objectives (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  "labelAr"      text,
  metric         text not null default 'CUSTOM'
                   check (metric in ('PIPELINE_USD','WON_USD','LEADS_COUNT','WON_COUNT','CONTENT_PUBLISHED','SPEND_USD','CUSTOM')),
  "targetValue"  numeric(18,2) not null default 0,
  "manualCurrent" numeric(18,2) not null default 0,
  "startDate"    date,
  "endDate"      date,
  "businessUnit" text,
  "ownerId"      uuid references users(id) on delete set null,
  status         text not null default 'ACTIVE' check (status in ('ACTIVE','DONE','ARCHIVED')),
  "createdAt"    timestamptz not null default now()
);

-- 3) Governance: custom roles & permissions
alter table users drop constraint if exists users_role_check;
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  label       text not null,
  "labelAr"   text,
  permissions jsonb not null default '{}'::jsonb,
  builtin     boolean not null default false,
  "createdAt" timestamptz not null default now()
);
insert into roles (key, label, "labelAr", permissions, builtin) values
  ('HEAD',          'Head of Marketing', 'رئيس التسويق',        '{"admin":true,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read"}',    true),
  ('DIGITAL',       'Digital Lead',      'مسؤول الرقمي',        '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read"}', true),
  ('PAID_MEDIA',    'Paid Media',        'الإعلانات المدفوعة',  '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true),
  ('EVENTS',        'Events',            'الفعاليات',           '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true),
  ('CONTENT_BRAND', 'Content & Brand',   'المحتوى والعلامة',    '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true)
on conflict (key) do nothing;

-- 4) OSINT v2: wider source set + richer topic defaults
alter table osint_signals drop constraint if exists "osint_signals_sourceType_check";
alter table osint_signals drop constraint if exists osint_signals_sourcetype_check;
alter table osint_signals add constraint "osint_signals_sourceType_check"
  check ("sourceType" in ('GOOGLE_NEWS','BING_NEWS','GDELT','REDDIT','RSS','MANUAL','SEARCH'));
alter table osint_topics alter column sources
  set default '["GOOGLE_NEWS","BING_NEWS","GDELT","REDDIT"]'::jsonb;
update osint_topics set sources = '["GOOGLE_NEWS","BING_NEWS","GDELT","REDDIT"]'::jsonb
  where sources = '["GOOGLE_NEWS","GDELT"]'::jsonb;

-- 5) Governance: audit trail
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  "actorId"   uuid,
  "actorName" text,
  action      text not null,
  entity      text not null,
  "entityId"  text,
  meta        jsonb,
  "createdAt" timestamptz not null default now()
);

-- 6) Performance indexes
create index if not exists idx_leads_stage       on leads (stage);
create index if not exists idx_leads_updated     on leads ("updatedAt");
create index if not exists idx_tasks_status      on tasks (status);
create index if not exists idx_content_scheduled on content_items ("scheduledAt");
create index if not exists idx_audit_created     on audit_log ("createdAt");

-- 7) Process → lead binding, notifications, lead timeline
alter table tasks add column if not exists "leadId" uuid references leads(id) on delete set null;

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  "userId"    uuid not null references users(id) on delete cascade,
  type        text not null,
  meta        jsonb,
  link        text,
  "readAt"    timestamptz,
  "createdAt" timestamptz not null default now()
);
create index if not exists idx_notif_user on notifications ("userId", "readAt", "createdAt" desc);

create table if not exists lead_activities (
  id          uuid primary key default gen_random_uuid(),
  "leadId"    uuid not null references leads(id) on delete cascade,
  "actorId"   uuid,
  "actorName" text,
  kind        text not null check (kind in ('CREATED','STAGE','NOTE','CAPTURE','TASK')),
  body        text,
  meta        jsonb,
  "createdAt" timestamptz not null default now()
);
create index if not exists idx_leadact_lead on lead_activities ("leadId", "createdAt" desc);

-- 8) HUB MODELS (Phases A–C) — idempotent


-- M1 · What we sell
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  "nameAr"      text,
  "businessUnit" text,
  category      text,
  description   text,
  "priceMinUsd" numeric(16,2),
  "priceMaxUsd" numeric(16,2),
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  "ownerId"     uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- M2 · Who we sell to
create table if not exists segments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  "nameAr"      text,
  "businessUnit" text,
  kind          text not null default 'OTHER'
                  check (kind in ('B2B_DISTRIBUTOR','B2B_ENTERPRISE','GOV_TENDER','CONSUMER','NGO','OTHER')),
  "sizeEstimate" text,
  notes         text,
  "createdAt"   timestamptz not null default now()
);
create table if not exists personas (
  id           uuid primary key default gen_random_uuid(),
  "segmentId"  uuid not null references segments(id) on delete cascade,
  name         text not null,
  "nameAr"     text,
  goals        text,
  pains        text,
  channels     jsonb not null default '[]',
  objections   text,
  message      text,
  "messageAr"  text,
  "createdAt"  timestamptz not null default now()
);

-- M3 · What we're doing and why (one brief per campaign)
create table if not exists campaign_briefs (
  id            uuid primary key default gen_random_uuid(),
  "campaignId"  uuid unique not null references campaigns(id) on delete cascade,
  objective     text,
  "personaId"   uuid references personas(id) on delete set null,
  "productId"   uuid references products(id) on delete set null,
  "keyMessage"  text,
  "keyMessageAr" text,
  offer         text,
  "kpiMetric"   text,
  "kpiTarget"   numeric(16,2),
  channels      jsonb not null default '[]',
  learnings     text,
  "closedAt"    timestamptz,
  "createdAt"   timestamptz not null default now()
);

-- M4 · Attribution without ad platforms
create table if not exists tracked_links (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  url          text not null,
  "campaignId" uuid references campaigns(id) on delete set null,
  channel      text,
  clicks       integer not null default 0,
  "lastClickAt" timestamptz,
  "createdAt"  timestamptz not null default now()
);

-- M9 · Processes the team owns
create table if not exists process_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  name        text not null,
  "nameAr"    text,
  tasks       jsonb not null default '[]',
  builtin     boolean not null default false,
  "createdAt" timestamptz not null default now()
);

-- M5 · Events become measurable
create table if not exists event_registrations (
  id           uuid primary key default gen_random_uuid(),
  "eventId"    uuid not null references events(id) on delete cascade,
  "leadId"     uuid not null references leads(id) on delete cascade,
  status       text not null default 'REGISTERED' check (status in ('REGISTERED','ATTENDED','NO_SHOW')),
  "checkedInAt" timestamptz,
  source       text,
  "createdAt"  timestamptz not null default now(),
  unique ("eventId", "leadId")
);

-- M6 · Life after WON
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  "leadId"        uuid references leads(id) on delete set null,
  company         text not null,
  "businessUnit"  text,
  "productIds"    jsonb not null default '[]',
  "firstWonAt"    timestamptz,
  "totalValueUsd" numeric(16,2) not null default 0,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','DORMANT','CHURNED')),
  "accountOwnerId" uuid references users(id) on delete set null,
  "nextReviewAt"  date,
  notes           text,
  "createdAt"     timestamptz not null default now()
);

-- M7 · Earned media as a managed channel
create table if not exists media_contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  outlet        text,
  role          text,
  phone         text,
  email         text,
  beat          text,
  tier          text,
  "lastContactAt" timestamptz,
  notes         text,
  "createdAt"   timestamptz not null default now()
);
create table if not exists press_items (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  "contactId"  uuid references media_contacts(id) on delete set null,
  "campaignId" uuid references campaigns(id) on delete set null,
  status       text not null default 'PITCHED' check (status in ('PITCHED','PROMISED','PUBLISHED','DECLINED')),
  url          text,
  "publishedAt" timestamptz,
  notes        text,
  "createdAt"  timestamptz not null default now()
);

-- M8 · Influencers / KOL
create table if not exists influencers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  platform    text,
  handle      text,
  audience    integer,
  niche       text,
  "rateUsd"   numeric(12,2),
  phone       text,
  rating      integer,
  notes       text,
  "createdAt" timestamptz not null default now()
);
create table if not exists influencer_collabs (
  id             uuid primary key default gen_random_uuid(),
  "influencerId" uuid not null references influencers(id) on delete cascade,
  "campaignId"   uuid references campaigns(id) on delete set null,
  deliverable    text,
  "costUsd"      numeric(12,2) not null default 0,
  "linkCode"     text,
  status         text not null default 'PLANNED' check (status in ('PLANNED','LIVE','DONE','CANCELLED')),
  "postUrl"      text,
  notes          text,
  "createdAt"    timestamptz not null default now()
);

-- Content → Post effectiveness (a plan becomes measurable instances)
create table if not exists posts (
  id           uuid primary key default gen_random_uuid(),
  "contentId"  uuid references content_items(id) on delete set null,
  "campaignId" uuid references campaigns(id) on delete set null,
  platform     text not null,
  url          text,
  "linkCode"   text,
  "publishedAt" timestamptz not null default now(),
  reach        integer not null default 0,
  impressions  integer not null default 0,
  engagement   integer not null default 0,
  clicks       integer not null default 0,
  "costUsd"    numeric(12,2) not null default 0,
  notes        text,
  "createdAt"  timestamptz not null default now()
);

-- DAM-lite: asset link registry (any entity)
create table if not exists assets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null,
  kind        text not null default 'OTHER' check (kind in ('IMAGE','VIDEO','DOC','DESIGN','OTHER')),
  entity      text not null,
  "entityId"  uuid not null,
  "createdAt" timestamptz not null default now()
);

-- Customer voice
create table if not exists feedback (
  id           uuid primary key default gen_random_uuid(),
  score        integer not null check (score between 1 and 5),
  comment      text,
  "customerId" uuid references customers(id) on delete set null,
  "leadId"     uuid references leads(id) on delete set null,
  "eventId"    uuid references events(id) on delete set null,
  source       text,
  "createdAt"  timestamptz not null default now()
);

-- Hub columns on existing tables
alter table users add column if not exists "tokenVersion" integer not null default 0;
alter table users add column if not exists "mustChangePassword" boolean not null default false;
alter table users add column if not exists "totpSecret" text;
alter table users add column if not exists "totpEnabled" boolean not null default false;
alter table content_items add column if not exists "personaId" uuid references personas(id) on delete set null;
alter table content_items add column if not exists "productId" uuid references products(id) on delete set null;
alter table content_items add column if not exists pillar text;
alter table leads add column if not exists "productId" uuid references products(id) on delete set null;
alter table leads add column if not exists "rateAtEntry" numeric(18,2);
alter table budget_entries add column if not exists "rateAtEntry" numeric(18,2);
alter table settings add column if not exists "staleLeadDays" integer not null default 3;
alter table settings add column if not exists "customerReviewDays" integer not null default 90;

create index if not exists idx_posts_campaign on posts ("campaignId");
create index if not exists idx_posts_content  on posts ("contentId");
create index if not exists idx_regs_event     on event_registrations ("eventId");
create index if not exists idx_customers_rev  on customers (status, "nextReviewAt");
create index if not exists idx_press_url      on press_items (url);
create index if not exists idx_assets_entity  on assets (entity, "entityId");
create index if not exists idx_links_campaign on tracked_links ("campaignId");

-- ═══ Wave 0 · Pulse foundation (rename + productization) ═══════════════
-- Per-client branding, currency labels, business units, module flags,
-- and first-run onboarding state. Idempotent — safe on any instance.
alter table settings add column if not exists "logoUrl" text;
alter table settings add column if not exists "accentColor" text not null default '#E8A33D';
alter table settings add column if not exists "localCurrency" text not null default 'SDG';
alter table settings add column if not exists "localCurrencyAr" text not null default 'ج.س';
alter table settings add column if not exists "businessUnits" jsonb not null default '[]';
alter table settings add column if not exists "modules" jsonb not null default '{}';
alter table settings add column if not exists "onboarded" boolean not null default false;
-- Existing live instances are already configured — never re-trigger the wizard on upgrade.
update settings set "onboarded" = true where id = 1 and "orgName" <> 'Your Organization';
alter table events alter column city drop default;  -- de-hardcode legacy 'Khartoum' default

-- ═══ Wave 1·A — Approvals engine + Studio + Agency ═══════════════════

-- One generalized approvals engine, reused by every territory that needs
-- a sign-off (invoices, asset versions, deliverables — later: content,
-- scheduled posts, budget-over-threshold). Never re-implemented per module.
create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null,
  "entityId"    uuid not null,
  stage         text not null default 'APPROVAL',
  "requesterId" uuid references users(id) on delete set null,
  "approverId"  uuid references users(id) on delete set null,
  status        text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  note          text,
  "decidedAt"   timestamptz,
  "createdAt"   timestamptz not null default now()
);
create index if not exists idx_approvals_entity on approvals (entity, "entityId");
create index if not exists idx_approvals_status on approvals (status);

-- AGENCY · vendor registry
create table if not exists vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'AGENCY' check (kind in ('AGENCY','FREELANCER','PRINTER','PRODUCTION','MEDIA_BUYER')),
  phone       text,
  email       text,
  contacts    jsonb not null default '[]',
  "rateCard"  jsonb not null default '[]',
  notes       text,
  active      boolean not null default true,
  "createdAt" timestamptz not null default now()
);

create table if not exists engagements (
  id            uuid primary key default gen_random_uuid(),
  "vendorId"    uuid not null references vendors(id) on delete cascade,
  title         text not null,
  scope         text,
  "campaignIds" jsonb not null default '[]',
  "feeUsd"      numeric(16,2) not null default 0,
  "rateAtEntry" numeric(18,2),
  "startDate"   timestamptz,
  "endDate"     timestamptz,
  status        text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
  "ownerId"     uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- STUDIO · creative intake queue (kanban + SLA sweep)
create table if not exists creative_requests (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  brief         text,
  kind          text not null default 'DESIGN' check (kind in ('DESIGN','VIDEO','COPY','PRINT','OTHER')),
  priority      text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH')),
  status        text not null default 'NEW' check (status in ('NEW','TRIAGED','IN_PROGRESS','REVIEW','DONE','REJECTED')),
  "requesterId" uuid references users(id) on delete set null,
  "assigneeId"  uuid references users(id) on delete set null,
  "campaignId"  uuid references campaigns(id) on delete set null,
  "dueDate"     timestamptz,
  "slaDueAt"    timestamptz,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

-- Deliverable-level briefs: written once, reused by requests AND agency deliverables
create table if not exists creative_briefs (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  "requestId"    uuid references creative_requests(id) on delete cascade,
  "engagementId" uuid references engagements(id) on delete cascade,
  spec           text,
  format         text,
  refs           jsonb not null default '[]',
  "dueDate"      timestamptz,
  "createdAt"    timestamptz not null default now()
);

-- Brand Center source of truth (public rows power /brand)
create table if not exists brand_assets (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'DOC' check (kind in ('LOGO','COLOR','FONT','TONE','DOC')),
  label       text not null,
  "labelAr"   text,
  value       text,
  url         text,
  public      boolean not null default true,
  sort        integer not null default 0,
  "createdAt" timestamptz not null default now()
);

-- Approved language that feeds the composer, landing pages & WA templates (later waves)
create table if not exists copy_bank (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  "textAr"    text,
  kind        text not null default 'CLAIM' check (kind in ('CLAIM','TAGLINE','CTA','DISCLAIMER')),
  "productId" uuid references products(id) on delete set null,
  "personaId" uuid references personas(id) on delete set null,
  approved    boolean not null default false,
  "createdAt" timestamptz not null default now()
);

-- v1→v2→v3 asset iterations with approval stamps
create table if not exists asset_versions (
  id             uuid primary key default gen_random_uuid(),
  "assetId"      uuid not null references assets(id) on delete cascade,
  version        integer not null default 1,
  url            text not null,
  note           text,
  status         text not null default 'DRAFT' check (status in ('DRAFT','REVIEW','APPROVED')),
  "approvedById" uuid references users(id) on delete set null,
  "approvedAt"   timestamptz,
  "createdAt"    timestamptz not null default now(),
  unique ("assetId", version)
);

-- The atomic unit of agency accountability: revision rounds become data
create table if not exists deliverables (
  id              uuid primary key default gen_random_uuid(),
  "engagementId"  uuid not null references engagements(id) on delete cascade,
  title           text not null,
  "briefId"       uuid references creative_briefs(id) on delete set null,
  "dueDate"       timestamptz,
  status          text not null default 'BRIEFED' check (status in ('BRIEFED','IN_PROGRESS','SUBMITTED','IN_REVIEW','REVISION','APPROVED')),
  "revisionCount" integer not null default 0,
  "submittedUrl"  text,
  "submittedAt"   timestamptz,
  "approvedAt"    timestamptz,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);
create index if not exists idx_deliv_eng on deliverables ("engagementId");

-- The feedback thread both sides see, timestamped forever
create table if not exists deliverable_comments (
  id              uuid primary key default gen_random_uuid(),
  "deliverableId" uuid not null references deliverables(id) on delete cascade,
  author          text not null default 'INTERNAL' check (author in ('INTERNAL','VENDOR')),
  "authorName"    text not null,
  body            text not null,
  "createdAt"     timestamptz not null default now()
);

-- Invoice approval writes a SPENT budget entry → agency costs flow into ROMI
create table if not exists invoices (
  id             uuid primary key default gen_random_uuid(),
  "vendorId"     uuid not null references vendors(id) on delete cascade,
  "engagementId" uuid references engagements(id) on delete set null,
  number         text not null,
  "amountUsd"    numeric(16,2) not null default 0,
  "rateAtEntry"  numeric(18,2),
  "campaignId"   uuid references campaigns(id) on delete set null,
  status         text not null default 'RECEIVED' check (status in ('RECEIVED','APPROVED','PAID')),
  "paidAt"       timestamptz,
  "createdAt"    timestamptz not null default now()
);
create index if not exists idx_inv_vendor on invoices ("vendorId");

-- The clever door: magic-link guest portal (/p/:token). No vendor accounts.
create table if not exists portal_tokens (
  id            uuid primary key default gen_random_uuid(),
  "vendorId"    uuid not null references vendors(id) on delete cascade,
  token         text unique not null,
  "expiresAt"   timestamptz not null,
  revoked       boolean not null default false,
  "lastUsedAt"  timestamptz,
  "createdById" uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);
create index if not exists idx_portal_token on portal_tokens (token);

-- Built-in roles learn the new territories (guarded: never clobbers admin edits)
update roles set permissions = permissions || '{"studio":"write","agency":"write"}'::jsonb
  where key in ('HEAD','DIGITAL') and builtin and not (permissions ? 'studio');
update roles set permissions = permissions || '{"studio":"write","agency":"read"}'::jsonb
  where key in ('PAID_MEDIA','EVENTS','CONTENT_BRAND') and builtin and not (permissions ? 'studio');

-- ═══ Wave 1·B — Forms + Landing Pages + Surveys + Contacts/consent ═══

-- The audience layer: not every human is a sales lead.
-- Consent tracking is a FEATURE when Pulse is sold to regulated clients.
create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  email        text,
  company      text,
  tags         jsonb not null default '[]',
  consent      jsonb not null default '[]',
  "leadId"     uuid references leads(id) on delete set null,
  "customerId" uuid references customers(id) on delete set null,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);
create index if not exists idx_contacts_email on contacts (lower(email));
create index if not exists idx_contacts_phone on contacts (phone);

-- Many forms per campaign, each with its own conversion stats. Public at /f/:slug.
create table if not exists forms (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text unique not null,
  "campaignId"   uuid references campaigns(id) on delete set null,
  fields         jsonb not null default '[]',
  "successMsg"   text,
  "successMsgAr" text,
  active         boolean not null default true,
  "createdAt"    timestamptz not null default now()
);

create table if not exists form_submissions (
  id          uuid primary key default gen_random_uuid(),
  "formId"    uuid not null references forms(id) on delete cascade,
  data        jsonb not null default '{}',
  "leadId"    uuid references leads(id) on delete set null,
  "contactId" uuid references contacts(id) on delete set null,
  src         text,
  "createdAt" timestamptz not null default now()
);
create index if not exists idx_fsub_form on form_submissions ("formId");

-- Block-based bilingual pages at /l/:slug — every campaign gets a page
-- with a tracked form and zero developer.
create table if not exists landing_pages (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  "titleAr"    text,
  blocks       jsonb not null default '[]',
  theme        jsonb not null default '{}',
  "formId"     uuid references forms(id) on delete set null,
  "campaignId" uuid references campaigns(id) on delete set null,
  status       text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  views        integer not null default 0,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);

-- Surveys are tracked surfaces too. Public at /s/:slug.
create table if not exists surveys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  "nameAr"     text,
  slug         text unique not null,
  kind         text not null default 'SURVEY' check (kind in ('SURVEY','NPS','CSAT')),
  questions    jsonb not null default '[]',
  audience     text not null default 'ANON' check (audience in ('ANON','LINKED')),
  "campaignId" uuid references campaigns(id) on delete set null,
  "productId"  uuid references products(id) on delete set null,
  active       boolean not null default true,
  "createdAt"  timestamptz not null default now()
);

create table if not exists survey_responses (
  id           uuid primary key default gen_random_uuid(),
  "surveyId"   uuid not null references surveys(id) on delete cascade,
  answers      jsonb not null default '{}',
  score        integer,
  "contactId"  uuid references contacts(id) on delete set null,
  "leadId"     uuid references leads(id) on delete set null,
  "customerId" uuid references customers(id) on delete set null,
  "createdAt"  timestamptz not null default now()
);
create index if not exists idx_sresp_survey on survey_responses ("surveyId");

-- Findings that rewrite strategy — attached to personas/products/briefs
-- instead of dying in a chart.
create table if not exists insights (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  "titleAr"   text,
  body        text,
  source      text not null default 'DATA' check (source in ('SURVEY','LISTENING','INTERVIEW','DATA')),
  links       jsonb not null default '{}',
  impact      text not null default 'MEDIUM' check (impact in ('LOW','MEDIUM','HIGH')),
  "createdAt" timestamptz not null default now()
);

-- Built-in roles learn the new territories (guarded: never clobbers admin edits)
update roles set permissions = permissions || '{"automate":"write","research":"write"}'::jsonb
  where builtin and not (permissions ? 'automate');

-- ═══ Wave 1·C — Analytics Core: the measurement brain ═══════════════

-- The semantic layer: every KPI in Pulse defined exactly once.
-- Dashboards, targets, alerts, and reports all REFERENCE the catalog —
-- no formula is ever re-implemented. source.kind: builtin (computed by
-- the engine registry) or composite (weighted normalization of other
-- catalog metrics — how the Pulse Index exists).
create table if not exists metrics (
  key             text primary key,
  name            text not null,
  "nameAr"        text,
  category        text not null default 'GENERAL',
  source          jsonb not null default '{"kind":"builtin"}',
  unit            text not null default 'count',
  direction       text not null default 'HIGHER' check (direction in ('HIGHER','LOWER')),
  dimensions      jsonb not null default '[]',
  description     text,
  "descriptionAr" text,
  active          boolean not null default true,
  "createdAt"     timestamptz not null default now()
);

-- Nightly materialization: one row per metric × dimension-slice × day.
-- Unlocks history, sparklines, MoM comparison, and pacing.
create table if not exists metric_snapshots (
  id          uuid primary key default gen_random_uuid(),
  "metricKey" text not null references metrics(key) on delete cascade,
  dims        jsonb not null default '{}',
  date        date not null,
  value       double precision not null,
  "createdAt" timestamptz not null default now(),
  unique ("metricKey", dims, date)
);
create index if not exists idx_snap_key_date on metric_snapshots ("metricKey", date desc);

-- Actual vs target vs PACE — the planning-pace logic generalized to any KPI.
create table if not exists metric_targets (
  id            uuid primary key default gen_random_uuid(),
  "metricKey"   text not null references metrics(key) on delete cascade,
  dims          jsonb not null default '{}',
  "periodStart" date not null,
  "periodEnd"   date not null,
  target        double precision not null,
  "ownerId"     uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- Nightly anomaly checks against trailing baselines → notifications.
create table if not exists metric_alerts (
  id            uuid primary key default gen_random_uuid(),
  "metricKey"   text not null references metrics(key) on delete cascade,
  dims          jsonb not null default '{}',
  condition     text not null check (condition in ('ABOVE','BELOW','DELTA_PCT')),
  threshold     double precision not null,
  "windowDays"  integer not null default 7,
  audience      jsonb not null default '[]',
  active        boolean not null default true,
  "lastFiredAt" timestamptz,
  "createdAt"   timestamptz not null default now()
);

-- Composable boards on the catalog. Role-aware defaults ship seeded.
create table if not exists dashboards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  "nameAr"    text,
  "ownerId"   uuid references users(id) on delete set null,
  role        text,
  widgets     jsonb not null default '[]',
  shared      boolean not null default false,
  "isDefault" boolean not null default false,
  "createdAt" timestamptz not null default now()
);

-- The reports engine: generated from snapshots, immutable once run.
create table if not exists report_runs (
  id              uuid primary key default gen_random_uuid(),
  "templateKey"   text not null,
  period          text not null,
  snapshot        jsonb not null default '{}',
  "generatedById" uuid references users(id) on delete set null,
  "generatedAt"   timestamptz not null default now()
);

-- Win/loss analysis needs a reason taxonomy.
alter table leads add column if not exists "lostReason" text;

-- ═══ Wave 1·D — Publish: the composer & owned surfaces ═════════════

-- Per-platform adaptation of one content item: same idea, native voice.
create table if not exists content_variants (
  id          uuid primary key default gen_random_uuid(),
  "contentId" uuid not null references content_items(id) on delete cascade,
  platform    text not null,
  caption     text,
  "captionAr" text,
  hashtags    jsonb not null default '[]',
  "assetId"   uuid references assets(id) on delete set null,
  format      text not null default 'POST' check (format in ('POST','REEL','STORY','ARTICLE','AD')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Assisted publishing: at slot time the Daily Pulse notifies the owner
-- with copy + asset + tracked link; one tap opens the share sheet;
-- "mark published" auto-creates the measurement row in posts. The same
-- model drives true auto-publish when platform APIs land (Wave 2).
create table if not exists scheduled_posts (
  id                uuid primary key default gen_random_uuid(),
  "variantId"       uuid not null references content_variants(id) on delete cascade,
  "scheduledAt"     timestamptz not null,
  "assigneeId"      uuid references users(id) on delete set null,
  status            text not null default 'DRAFT'
                      check (status in ('DRAFT','QUEUED','AWAITING_APPROVAL','READY','NOTIFIED','PUBLISHED','SKIPPED')),
  "linkCode"        text references tracked_links(code) on delete set null,
  "publishedPostId" uuid references posts(id) on delete set null,
  "notifiedAt"      timestamptz,
  "createdAt"       timestamptz not null default now(),
  "updatedAt"       timestamptz not null default now()
);
create index if not exists idx_sched_due on scheduled_posts (status, "scheduledAt");

-- Pulse-hosted link-in-bio at /b/:slug — every tap is attributed.
create table if not exists bio_pages (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  "titleAr"   text,
  theme       jsonb not null default '{}',
  active      boolean not null default true,
  "createdAt" timestamptz not null default now()
);

create table if not exists bio_links (
  id          uuid primary key default gen_random_uuid(),
  "pageId"    uuid not null references bio_pages(id) on delete cascade,
  label       text not null,
  "labelAr"   text,
  "linkCode"  text not null references tracked_links(code) on delete cascade,
  sort        integer not null default 0,
  active      boolean not null default true,
  "createdAt" timestamptz not null default now()
);

-- ═══ Wave 1·E — Automate: live-DB alters ═══════════════════════════
alter table leads add column if not exists score integer not null default 0;
alter table leads add column if not exists tags jsonb not null default '[]';
alter table lead_activities drop constraint if exists lead_activities_kind_check;
alter table lead_activities add constraint lead_activities_kind_check
  check (kind in ('CREATED','STAGE','NOTE','CAPTURE','TASK','WA'));

-- ═══ Wave 1·E — Automate: workflows, lead scoring, WA templates ═════

-- Trigger → condition → action, from a curated library. No chaotic
-- visual builder in v1: events fire from the code paths that matter,
-- filters are shallow field matches, actions are named and audited.
create table if not exists workflows (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  "nameAr"    text,
  trigger     jsonb not null default '{}',   -- { event, filters: { field: value } }
  actions     jsonb not null default '[]',   -- [ { type, ...params } ]
  active      boolean not null default true,
  "lastRunAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists workflow_runs (
  id           uuid primary key default gen_random_uuid(),
  "workflowId" uuid not null references workflows(id) on delete cascade,
  entity       text,
  "entityId"   uuid,
  status       text not null default 'DONE' check (status in ('DONE','ERROR')),
  log          jsonb not null default '[]',
  "createdAt"  timestamptz not null default now()
);
create index if not exists idx_wf_runs on workflow_runs ("workflowId", "createdAt" desc);

-- Points-based lead scoring; the cached leads.score is recomputed on
-- write, on rule change, and nightly by the Daily Pulse.
create table if not exists lead_score_rules (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  "labelAr"   text,
  condition   jsonb not null default '{}',   -- { field, op: eq|neq|gte|lte|contains|notnull, value }
  points      integer not null default 10,
  active      boolean not null default true,
  "createdAt" timestamptz not null default now()
);

-- WhatsApp-first message library with {{merge}} fields; deep-link send,
-- every send logged as a lead activity (kind WA).
create table if not exists wa_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  "nameAr"    text,
  body        text,
  "bodyAr"    text,
  variables   jsonb not null default '[]',
  category    text not null default 'FOLLOW_UP',
  uses        integer not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- ═══ Wave 1·F — Reach: outreach engine, coverage, competitors ═══════

-- Sequenced outreach — BuzzStream's core, WhatsApp-first. A campaign is
-- an audience kind + ordered steps [{day, channel, templateId?}]; enrolling
-- targets mints one touch per step with a due date.
create table if not exists outreach_campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  "nameAr"       text,
  goal           text,
  "audienceKind" text not null default 'MEDIA'
                   check ("audienceKind" in ('MEDIA','INFLUENCER','PARTNER','CUSTOMER','CUSTOM')),
  steps          jsonb not null default '[]',
  status         text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','PAUSED','DONE')),
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);

create table if not exists outreach_touches (
  id           uuid primary key default gen_random_uuid(),
  "campaignId" uuid not null references outreach_campaigns(id) on delete cascade,
  "targetKind" text not null check ("targetKind" in ('MEDIA','INFLUENCER','CUSTOMER','CONTACT','PARTNER')),
  "targetId"   uuid not null,
  "targetName" text not null,
  "stepNo"     integer not null default 1,
  channel      text not null default 'WA' check (channel in ('WA','EMAIL','CALL')),
  "templateId" uuid references wa_templates(id) on delete set null,
  "dueAt"      timestamptz,
  status       text not null default 'PLANNED'
                 check (status in ('PLANNED','SENT','REPLIED','DECLINED','PLACED','SKIPPED')),
  note         text,
  "sentAt"     timestamptz,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);
create index if not exists idx_touch_campaign on outreach_touches ("campaignId", "stepNo");
create index if not exists idx_touch_due on outreach_touches (status, "dueAt");

-- One-click branded coverage deliverable: an immutable compiled snapshot
-- of matched press + listening signals + share-of-voice + outreach stats.
create table if not exists coverage_reports (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  "periodStart" date not null,
  "periodEnd"   date not null,
  filters       jsonb not null default '{}',
  snapshot      jsonb not null default '{}',
  "createdById" uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- First-class rivals: SOV binding via a listening topic + manual price notes.
create table if not exists competitors (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  "nameAr"           text,
  "listeningTopicId" uuid references osint_topics(id) on delete set null,
  "priceNotes"       jsonb not null default '[]',
  notes              text,
  active             boolean not null default true,
  "createdAt"        timestamptz not null default now(),
  "updatedAt"        timestamptz not null default now()
);

-- ═══ Wave 1·G — Connective Tissue: the pieces no competitor has ══════

-- Offline media buying with real attribution: every billboard and print
-- ad carries a tracked QR minted from tracked_links, generated locally.
create table if not exists media_plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  "nameAr"    text,
  period      text,
  channel     text not null default 'BILLBOARD'
                check (channel in ('RADIO','BILLBOARD','PRINT','TV','OTHER')),
  "budgetUsd" numeric(16,2) not null default 0,
  "campaignId" uuid references campaigns(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists media_placements (
  id          uuid primary key default gen_random_uuid(),
  "planId"    uuid not null references media_plans(id) on delete cascade,
  label       text not null,
  location    text,
  "startDate" date,
  "endDate"   date,
  "costUsd"   numeric(16,2) not null default 0,
  "linkCode"  text,
  qr          text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Offers as measurable objects.
create table if not exists promotions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  "nameAr"    text,
  code        text not null unique,
  kind        text not null default 'DISCOUNT' check (kind in ('DISCOUNT','OFFER','BUNDLE')),
  "productIds" jsonb not null default '[]',
  "startsAt"  date,
  "endsAt"    date,
  "linkCode"  text,
  redemptions integer not null default 0,
  active      boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Word-of-mouth, finally measured.
create table if not exists referrals (
  id                    uuid primary key default gen_random_uuid(),
  "referrerCustomerId"  uuid not null references customers(id) on delete cascade,
  code                  text not null unique,
  "referredLeadId"      uuid references leads(id) on delete set null,
  "rewardState"         text not null default 'PENDING'
                          check ("rewardState" in ('PENDING','EARNED','PAID')),
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

-- Channel co-op marketing.
create table if not exists partners (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  "nameAr"       text,
  kind           text not null default 'DISTRIBUTOR'
                   check (kind in ('DISTRIBUTOR','RESELLER','ALLIANCE')),
  region         text,
  contacts       jsonb not null default '[]',
  "coopBudgetUsd" numeric(16,2) not null default 0,
  notes          text,
  active         boolean not null default true,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);

create table if not exists partner_campaigns (
  id          uuid primary key default gen_random_uuid(),
  "partnerId" uuid not null references partners(id) on delete cascade,
  "campaignId" uuid not null references campaigns(id) on delete cascade,
  "sharePct"  numeric(5,2) not null default 50,
  "createdAt" timestamptz not null default now(),
  unique ("partnerId", "campaignId")
);

-- Living SOPs: the platform teaches its own processes.
create table if not exists playbooks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  "titleAr"   text,
  body        text,
  category    text not null default 'GENERAL',
  "ownerId"   uuid references users(id) on delete set null,
  published   boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Manual-first paid tracking; approval-free, flows into ROMI via budget.
create table if not exists ad_spend (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null default 'META' check (platform in ('META','TIKTOK','GOOGLE','OTHER')),
  "campaignId"  uuid references campaigns(id) on delete set null,
  date          date not null default current_date,
  "amountUsd"   numeric(16,2) not null default 0,
  "rateAtEntry" numeric(12,2),
  impressions   integer,
  clicks        integer,
  "createdAt"   timestamptz not null default now()
);

-- pulse.js — "own your pixel": first-party analytics into the instance.
create table if not exists sites (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  domain       text,
  "snippetKey" text not null unique,
  active       boolean not null default true,
  "createdAt"  timestamptz not null default now()
);

create table if not exists web_events (
  id            uuid primary key default gen_random_uuid(),
  "siteKey"     text not null,
  kind          text not null default 'PAGEVIEW' check (kind in ('PAGEVIEW','EVENT')),
  path          text,
  ref           text,
  utm           jsonb not null default '{}',
  src           text,
  "visitorHash" text,
  at            timestamptz not null default now()
);
create index if not exists idx_webev_site on web_events ("siteKey", at desc);

-- Self-filling OKRs: key results reference the metrics catalog and
-- update themselves nightly.
create table if not exists key_results (
  id            uuid primary key default gen_random_uuid(),
  "objectiveId" uuid not null references objectives(id) on delete cascade,
  label         text not null,
  "labelAr"     text,
  metric        jsonb not null default '{}',   -- { metricKey, dims }
  target        numeric(18,2) not null default 0,
  current       numeric(18,2) not null default 0,
  auto          boolean not null default true,
  "updatedAt"   timestamptz not null default now(),
  "createdAt"   timestamptz not null default now()
);

-- The Morning Pulse: one compiled briefing, logged.
create table if not exists digest_log (
  id        uuid primary key default gen_random_uuid(),
  kind      text not null default 'MORNING_PULSE',
  channel   text not null default 'INAPP',
  payload   jsonb not null default '{}',
  "sentAt"  timestamptz not null default now()
);

-- Social inbox v1: manual capture, one tap converts to a lead.
create table if not exists inbox_items (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null default 'IG',
  kind           text not null default 'COMMENT' check (kind in ('COMMENT','DM','MENTION')),
  author         text,
  text           text,
  url            text,
  status         text not null default 'OPEN'
                   check (status in ('OPEN','REPLIED','CONVERTED','ARCHIVED')),
  "leadId"       uuid references leads(id) on delete set null,
  "capturedById" uuid references users(id) on delete set null,
  "receivedAt"   timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);

-- ═══ Wave 2·A — the mail rail ════════════════════════════════════════

-- Every send audited, whatever the transport. `digest_log` records what
-- was compiled; this records what was actually delivered (or logged).
create table if not exists mail_log (
  id        uuid primary key default gen_random_uuid(),
  kind      text not null default 'MORNING_PULSE',
  "to"      text not null,
  subject   text,
  status    text not null default 'LOGGED' check (status in ('SENT','FAILED','LOGGED')),
  error     text,
  "sentAt"  timestamptz not null default now()
);
create index if not exists idx_mail_log_kind on mail_log (kind, "sentAt" desc);

-- SMTP config lives with the other per-client settings; the password is
-- masked on read (never leaves the server).
alter table settings add column if not exists "mail" jsonb not null default '{}';

-- Opt-in, per person: nobody gets mail they didn't ask for.
alter table users add column if not exists "morningEmail" boolean not null default false;

-- ═══ Wave 2·B/D — the connector layer ════════════════════════════════

-- Every platform call, logged. The admin's "is it actually working" view.
create table if not exists integration_runs (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null,
  "accountId" uuid references social_accounts(id) on delete cascade,
  kind        text not null check (kind in ('VERIFY','METRICS','INBOX','ADSPEND','PUBLISH','SEND','WEBHOOK')),
  status      text not null check (status in ('OK','FAILED')),
  detail      text,
  at          timestamptz not null default now()
);
create index if not exists idx_intruns on integration_runs (platform, at desc);

-- WhatsApp joins the accounts model.
alter table social_accounts drop constraint if exists social_accounts_platform_check;
alter table social_accounts add constraint social_accounts_platform_check
  check (platform in ('FACEBOOK','INSTAGRAM','X','LINKEDIN','YOUTUBE','TIKTOK','WA'));
alter table social_accounts add column if not exists "autoPublish" boolean not null default false;
alter table social_accounts add column if not exists "tokenExpiresAt" timestamptz;

-- App-level integration secrets, masked on read like settings.mail.
alter table settings add column if not exists integrations jsonb not null default '{}';

-- Inbox items can now arrive by API; the pair (platform, externalId) is
-- the idempotency key that makes webhook redelivery harmless.
alter table inbox_items add column if not exists "externalId" text;
alter table inbox_items add column if not exists via text not null default 'MANUAL'
  check (via in ('MANUAL','API'));
create unique index if not exists uq_inbox_ext on inbox_items (platform, "externalId")
  where "externalId" is not null;

-- Publishing gains an outcome: where it landed, or why it didn't.
alter table scheduled_posts add column if not exists "externalUrl" text;
alter table scheduled_posts add column if not exists "publishError" text;

-- Synced spend must never double-write the budget ledger.
alter table ad_spend add column if not exists source text not null default 'MANUAL'
  check (source in ('MANUAL','SYNC'));
alter table ad_spend add column if not exists "campaignRef" text;
create unique index if not exists uq_adspend_sync on ad_spend (platform, "campaignRef", date)
  where source = 'SYNC';

-- The Meta-approved template name a wa_template maps to.
alter table wa_templates add column if not exists "waTemplateName" text;

-- ═══ Wave 2·D — Google Ads joins the accounts model ══════════════════
alter table social_accounts drop constraint if exists social_accounts_platform_check;
alter table social_accounts add constraint social_accounts_platform_check
  check (platform in ('FACEBOOK','INSTAGRAM','X','LINKEDIN','YOUTUBE','TIKTOK','WA','GOOGLE'));

-- ═══ Wave 2·E — listening becomes intelligence ═══════════════════════

-- The source registry: who is speaking, and how much weight they earn.
-- Reliability follows the Admiralty Code (A best … F unassessable);
-- unknown sources default to D so nothing unvetted arrives loud.
create table if not exists osint_sources (
  id            uuid primary key default gen_random_uuid(),
  domain        text not null unique,
  name          text,
  "nameAr"      text,
  kind          text not null default 'BLOG'
                  check (kind in ('NEWS','WIRE','GOV','TRADE','BLOG','FORUM','SOCIAL','AGGREGATOR')),
  reliability   text not null default 'D' check (reliability in ('A','B','C','D','E','F')),
  "ownerGroup"  text,                      -- media groups count once when corroborating
  country       text,
  lang          text,
  paywalled     boolean not null default false,
  "robotsOk"    boolean not null default true,
  notes         text,
  active        boolean not null default true,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

-- Signals carry their provenance and their verdict, not just their text.
alter table osint_signals add column if not exists credibility integer not null default 4;
alter table osint_signals add column if not exists relevance numeric not null default 1;
alter table osint_signals add column if not exists "clusterId" text;
alter table osint_signals add column if not exists canonical boolean not null default true;
alter table osint_signals add column if not exists "reviewStatus" text not null default 'AUTO'
  check ("reviewStatus" in ('PENDING','CONFIRMED','REJECTED','AUTO'));
alter table osint_signals add column if not exists "contentHash" text;
alter table osint_signals add column if not exists "syndicationCount" integer not null default 1;
alter table osint_signals add column if not exists "reviewedById" uuid references users(id) on delete set null;
alter table osint_signals add column if not exists "reviewedAt" timestamptz;
create index if not exists idx_signals_cluster on osint_signals ("clusterId");
create index if not exists idx_signals_review on osint_signals ("reviewStatus", canonical);

-- Topics gain disambiguation: the terms that must (and must not) appear.
alter table osint_topics add column if not exists "mustInclude" jsonb not null default '[]';
alter table osint_topics add column if not exists "mustExclude" jsonb not null default '[]';
alter table osint_topics add column if not exists "contextTerms" jsonb not null default '[]';
alter table osint_topics add column if not exists "reviewThreshold" numeric not null default 0.55;

-- ═══ Wave 2·C — the storage rail ═════════════════════════════════════

-- Files live behind a driver. On Supabase instances the bytes go to
-- object storage and this row is the record; on self-hosted or offline
-- instances the bytes live right here, so nothing is ever blocked on a
-- third party. Same URLs either way.
create table if not exists files (
  id            uuid primary key default gen_random_uuid(),
  "key"         text not null unique,
  name          text not null,
  mime          text not null default 'application/octet-stream',
  size          integer not null default 0,
  sha256        text,
  driver        text not null default 'DB' check (driver in ('DB','SUPABASE')),
  data          bytea,
  "remoteUrl"   text,
  public        boolean not null default false,
  entity        text,
  "entityId"    uuid,
  "uploadedById" uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);
create index if not exists idx_files_entity on files (entity, "entityId");

-- ═══ Wave 2·E · P2 — entity resolution ═══════════════════════════════

-- GUARDRAIL: Pulse is a marketing platform. Entities are organisations,
-- brands, products and outlets — plus named spokespeople acting in an
-- official capacity. Private individuals are never profiled. The check
-- constraint is the enforcement, not the documentation.
create table if not exists osint_entities (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'ORG'
                  check (kind in ('ORG','BRAND','PRODUCT','OUTLET','PUBLIC_FIGURE')),
  name          text not null,
  "nameAr"      text,
  country       text,
  notes         text,
  "competitorId" uuid references competitors(id) on delete set null,
  "customerId"  uuid references customers(id) on delete set null,
  "isSelf"      boolean not null default false,
  active        boolean not null default true,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

-- Every way a name appears in the wild: Arabic, English, transliterated,
-- abbreviated, misspelled, or as a handle.
create table if not exists osint_aliases (
  id          uuid primary key default gen_random_uuid(),
  "entityId"  uuid not null references osint_entities(id) on delete cascade,
  surface     text not null,
  "surfaceNorm" text not null,
  lang        text not null default 'ar' check (lang in ('ar','en','other')),
  kind        text not null default 'EXACT'
                check (kind in ('EXACT','TRANSLITERATION','ABBREVIATION','HANDLE','MISSPELLING')),
  weight      numeric not null default 1,
  "createdAt" timestamptz not null default now(),
  unique ("entityId", "surfaceNorm")
);
create index if not exists idx_alias_norm on osint_aliases ("surfaceNorm");

-- A signal can mention three competitors with different sentiment toward
-- each — which one score per row could never express.
create table if not exists osint_signal_entities (
  id            uuid primary key default gen_random_uuid(),
  "signalId"    uuid not null references osint_signals(id) on delete cascade,
  "entityId"    uuid not null references osint_entities(id) on delete cascade,
  "matchMethod" text not null default 'ALIAS' check ("matchMethod" in ('ALIAS','HANDLE','URL','MANUAL')),
  "matchedOn"   text,
  confidence    numeric not null default 0.5,
  sentiment     numeric,
  "sentimentLabel" text check ("sentimentLabel" in ('POS','NEU','NEG')),
  "sentimentConfidence" numeric not null default 0,
  "createdAt"   timestamptz not null default now(),
  unique ("signalId", "entityId")
);
create index if not exists idx_sigent_entity on osint_signal_entities ("entityId");

alter table osint_signals add column if not exists "sentimentConfidence" numeric not null default 0;
alter table osint_signals add column if not exists "entityCount" integer not null default 0;

-- ═══ Wave 2·E · P3 — evidence integrity & case files ═════════════════

-- Link rot is the norm. A board-pack claim whose source 404s six months
-- later is worthless, and that is exactly when the original matters.
alter table osint_signals add column if not exists "snapshotFileId" uuid references files(id) on delete set null;
alter table osint_signals add column if not exists "capturedAt" timestamptz;
alter table osint_signals add column if not exists "capturedById" uuid references users(id) on delete set null;
alter table osint_signals add column if not exists "snapshotKind" text
  check ("snapshotKind" in ('FULL','PARTIAL'));

-- Evidence gathered around a question, not a keyword.
create table if not exists osint_cases (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  "titleAr"   text,
  question    text,
  status      text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  "ownerId"   uuid references users(id) on delete set null,
  summary     text,
  "closedAt"  timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists osint_case_items (
  id          uuid primary key default gen_random_uuid(),
  "caseId"    uuid not null references osint_cases(id) on delete cascade,
  "signalId"  uuid references osint_signals(id) on delete cascade,
  "entityId"  uuid references osint_entities(id) on delete set null,
  note        text,
  "addedById" uuid references users(id) on delete set null,
  "createdAt" timestamptz not null default now()
);
create index if not exists idx_caseitem_case on osint_case_items ("caseId");

-- ═══ Wave 2·E · P4 — discovery, corroboration, tuning ════════════════

-- Handle discovery proposes; a human disposes. Nothing binds to an
-- entity until someone confirms it, and only ORG-shaped entities may be
-- searched at all (enforced in code, see osint/discovery.js).
create table if not exists osint_handle_candidates (
  id           uuid primary key default gen_random_uuid(),
  "entityId"   uuid not null references osint_entities(id) on delete cascade,
  platform     text not null,
  handle       text not null,
  url          text,
  similarity   numeric not null default 0,
  evidence     jsonb not null default '{}',
  status       text not null default 'PENDING'
                 check (status in ('PENDING','CONFIRMED','REJECTED')),
  "decidedById" uuid references users(id) on delete set null,
  "decidedAt"  timestamptz,
  "checkedAt"  timestamptz not null default now(),
  unique ("entityId", platform, handle)
);

-- Corroboration: how many *independent* sources carry this story. Two
-- brands of the same media group are one source, not two.
alter table osint_signals add column if not exists "corroborationCount" integer not null default 1;
alter table osint_signals add column if not exists corroborated boolean not null default false;

-- ACH-lite: what else could explain this, recorded beside the claim.
alter table insights add column if not exists hypotheses jsonb not null default '[]';
alter table insights add column if not exists corroborated boolean not null default false;
alter table insights add column if not exists "signalIds" jsonb not null default '[]';

-- ═══ Wave 3·A — observability ════════════════════════════════════════

-- What broke, where, and how often. Fingerprints group the same fault so
-- one recurring bug reads as one row with a count, not a thousand rows.
--
-- NOTE: "payloadDigest" is a hash and a shape — never the payload. Request
-- bodies in this product carry contact data; a log that quietly becomes a
-- second copy of the CRM is a liability, not observability.
create table if not exists error_log (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  level         text not null default 'ERROR' check (level in ('ERROR','WARN','CLIENT')),
  fingerprint   text not null,
  route         text,
  method        text,
  status        integer,
  message       text not null,
  stack         text,
  "userId"      uuid references users(id) on delete set null,
  "requestId"   text,
  "userAgent"   text,
  "payloadDigest" text
);
create index if not exists idx_errlog_at on error_log (at desc);
create index if not exists idx_errlog_fp on error_log (fingerprint, at desc);

-- ═══ Wave 3·C — the AI rail ══════════════════════════════════════════

-- Every model call, logged: what it was for, what it cost, how long it
-- took, whether the cache answered instead. The same "is it working and
-- what is it costing" surface integration_runs gives connectors.
create table if not exists ai_runs (
  id            uuid primary key default gen_random_uuid(),
  feature       text not null,
  model         text,
  status        text not null check (status in ('OK','FAILED','CACHED','SKIPPED','ABSTAINED')),
  "promptTokens"     integer not null default 0,
  "completionTokens" integer not null default 0,
  "costUsd"     numeric(12,6) not null default 0,
  "latencyMs"   integer,
  "cacheKey"    text,
  detail        text,
  at            timestamptz not null default now()
);
create index if not exists idx_airuns_at on ai_runs (at desc);
create index if not exists idx_airuns_cache on ai_runs ("cacheKey") where "cacheKey" is not null;

-- The cache is keyed on the content, not the clock: the same evidence
-- asked the same question returns the same answer for free.
create table if not exists ai_cache (
  "cacheKey"  text primary key,
  feature     text not null,
  response    text not null,
  "createdAt" timestamptz not null default now()
);

-- AI writes drafts, never facts. An insight it proposed is marked as such
-- and stays DRAFT until a person accepts it.
alter table insights add column if not exists status text not null default 'PUBLISHED'
  check (status in ('DRAFT','PUBLISHED','DISMISSED'));
alter table insights add column if not exists "aiGenerated" boolean not null default false;
alter table insights add column if not exists "alertId" uuid references metric_alerts(id) on delete set null;

-- ═══ Wave 3·D — live search ══════════════════════════════════════════

-- Every live query, logged with what it cost. Pay-per-use providers
-- without a ledger are how a client gets a surprise invoice.
create table if not exists search_runs (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  query       text not null,
  "topicId"   uuid references osint_topics(id) on delete set null,
  results     integer not null default 0,
  ingested    integer not null default 0,
  "costUsd"   numeric(12,6) not null default 0,
  status      text not null check (status in ('OK','FAILED','CAPPED','SKIPPED')),
  detail      text,
  "runById"   uuid references users(id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists idx_searchruns_at on search_runs (at desc);

-- A per-provider monthly ceiling, as a first-class object rather than a
-- setting nobody looks at. A provider that would exceed its cap degrades
-- to a free one instead of failing the query.
create table if not exists search_budget (
  provider        text primary key,
  "monthlyCapUsd" numeric(12,2) not null default 0,
  "costPerUnit"   numeric(12,6) not null default 0,
  active          boolean not null default true,
  "updatedAt"     timestamptz not null default now()
);

-- ═══ Wave 3·E — AI-supercharged listening ════════════════════════════

-- A theme is what people are actually talking about, as opposed to how
-- they feel about it. "Sentiment is −0.2" is not actionable; "delivery
-- delays, price increases, one product defect" is.
create table if not exists osint_themes (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  "labelAr"     text,
  summary       text,
  "topicId"     uuid references osint_topics(id) on delete cascade,
  "entityId"    uuid references osint_entities(id) on delete set null,
  sentiment     numeric,
  "signalCount" integer not null default 0,
  "priorCount"  integer not null default 0,
  emerging      boolean not null default false,
  status        text not null default 'DRAFT' check (status in ('DRAFT','ACCEPTED','DISMISSED')),
  "aiGenerated" boolean not null default true,
  "firstSeenAt" timestamptz,
  "lastSeenAt"  timestamptz,
  "createdAt"   timestamptz not null default now()
);
create index if not exists idx_themes_topic on osint_themes ("topicId", status);

create table if not exists osint_theme_signals (
  id         uuid primary key default gen_random_uuid(),
  "themeId"  uuid not null references osint_themes(id) on delete cascade,
  "signalId" uuid not null references osint_signals(id) on delete cascade,
  quote      text,
  unique ("themeId", "signalId")
);

-- The model's opinion on an ambiguous signal, kept beside the analyst's
-- ruling rather than replacing it — which is how we can measure whether
-- the model actually agrees with the people who know.
alter table osint_signals add column if not exists "aiRelevance" numeric;
alter table osint_signals add column if not exists "aiVerdict" text
  check ("aiVerdict" in ('RELEVANT','NOT_RELEVANT','UNSURE'));
alter table osint_signals add column if not exists "aiReason" text;

-- Terms the model proposes from what analysts actually rejected.
alter table osint_topics add column if not exists "suggestedTerms" jsonb not null default '{}';

-- ═══ Wave 3·G — media-mix modelling ══════════════════════════════════

-- The weekly panel, materialised so it can be inspected rather than
-- recomputed invisibly. "completeness" is what tells you whether a week
-- is real evidence or a gap the model would otherwise paper over.
create table if not exists mmm_weeks (
  id            uuid primary key default gen_random_uuid(),
  "weekStart"   date not null,
  "outcomeKey"  text not null,
  outcome       double precision not null default 0,
  spend         jsonb not null default '{}',      -- { META: 1200, TIKTOK: 400, ... }
  controls      jsonb not null default '{}',      -- ramadan, eid, promotions, competitor events
  completeness  numeric not null default 0,       -- 0–1: how much of this week we actually have
  "createdAt"   timestamptz not null default now(),
  unique ("weekStart", "outcomeKey")
);

-- One fit, kept with its diagnostics. A model whose R² and collinearity
-- warnings are not stored beside its coefficients is a number without a
-- provenance — and this is exactly the number that moves real budget.
create table if not exists mmm_runs (
  id            uuid primary key default gen_random_uuid(),
  "outcomeKey"  text not null,
  weeks         integer not null,
  "aboveFloor"  boolean not null default false,
  params        jsonb not null default '{}',      -- adstock decay + saturation per channel
  coefficients  jsonb not null default '{}',
  contributions jsonb not null default '{}',
  diagnostics   jsonb not null default '{}',      -- r2, holdoutMape, collinear pairs, completeness
  "runById"     uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);
create index if not exists idx_mmmruns_at on mmm_runs ("createdAt" desc);

-- ═══ Wave 3·H — multi-department cores ═══════════════════════════════

-- A department is a DIMENSION, not a fork. There is one instance, one
-- schema, one set of tables; departments slice them. Cloning tables per
-- department would double the maintenance surface forever.
create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  "nameAr"    text,
  code        text unique,
  "headId"    uuid references users(id) on delete set null,
  active      boolean not null default true,
  "createdAt" timestamptz not null default now()
);

-- A user with no department sees everything their permissions allow —
-- which keeps every existing instance working exactly as before.
alter table users add column if not exists "departmentId" uuid references departments(id) on delete set null;

-- Nullable everywhere: unassigned rows stay visible to all, so adopting
-- departments never hides data that was already there.
alter table campaigns      add column if not exists "departmentId" uuid references departments(id) on delete set null;
alter table leads          add column if not exists "departmentId" uuid references departments(id) on delete set null;
alter table content_items  add column if not exists "departmentId" uuid references departments(id) on delete set null;
alter table tasks          add column if not exists "departmentId" uuid references departments(id) on delete set null;
alter table budget_entries add column if not exists "departmentId" uuid references departments(id) on delete set null;
alter table dashboards     add column if not exists "departmentId" uuid references departments(id) on delete set null;

create index if not exists idx_leads_dept on leads ("departmentId");
create index if not exists idx_campaigns_dept on campaigns ("departmentId");
create index if not exists idx_tasks_dept on tasks ("departmentId");

-- ═══ Wave 3·I — persistent AI CMO conversations ══════════════════════

-- A conversation is a durable thread of asks and answers. Persisting it
-- means a stream can keep running server-side after the user navigates
-- away; the poll resumes it visually when they come back.
create table if not exists ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  "userId"   uuid not null references users(id) on delete cascade,
  title      text not null default 'New conversation',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists idx_ai_conversations_user on ai_conversations ("userId", "updatedAt" desc);

-- Ordered, append-only ledger of a thread. The 'cmo' row is created empty
-- the moment the stream starts and grows as tokens arrive; 'user' rows are
-- the prompts (edited ones stay put, a fresh 'user' row follows).
create table if not exists ai_messages (
  id              uuid primary key default gen_random_uuid(),
  "conversationId" uuid not null references ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','cmo')),
  text            text not null default '',
  label           text,
  "createdAt"     timestamptz not null default now()
);
create index if not exists idx_ai_messages_conversation on ai_messages ("conversationId", "createdAt");
