-- HELM — Marketing Department OS · Supabase / PostgreSQL schema
-- Run this in the Supabase SQL Editor (or via `npm run db:apply`).
-- Identifiers are quoted to preserve camelCase so the API/JSON contract is stable.

create extension if not exists pgcrypto;

-- ── Users ────────────────────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text unique not null,
  "passwordHash" text not null,
  role          text not null default 'CONTENT_BRAND',  -- references roles.key (soft link; custom roles allowed)
  "titleAr"     text,
  active        boolean not null default true,
  "createdAt"   timestamptz not null default now()
);

-- ── Campaigns ────────────────────────────────────────────────────────
create table if not exists campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  "nameAr"      text,
  objective     text,
  status        text not null default 'PLANNING'
                  check (status in ('PLANNING','ACTIVE','PAUSED','COMPLETED')),
  channel       text not null default 'SOCIAL'
                  check (channel in ('SOCIAL','PAID','EVENT','PR','EMAIL','WEB','BTL')),
  "startDate"   timestamptz,
  "endDate"     timestamptz,
  "budgetUsd"   numeric(16,2) not null default 0,
  "budgetSdg"   numeric(18,2) not null default 0,
  "businessUnit" text,
  "ownerId"     uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- ── Content calendar ─────────────────────────────────────────────────
create table if not exists content_items (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  "titleAr"     text,
  channel       text not null default 'SOCIAL'
                  check (channel in ('SOCIAL','PAID','EVENT','PR','EMAIL','WEB','BTL')),
  status        text not null default 'IDEA'
                  check (status in ('IDEA','IN_PROGRESS','REVIEW','APPROVED','PUBLISHED')),
  "scheduledAt" timestamptz,
  notes         text,
  "campaignId"  uuid references campaigns(id) on delete set null,
  "authorId"    uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- ── Leads / pipeline ─────────────────────────────────────────────────
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  company       text not null,
  "contactName" text,
  phone         text,
  email         text,
  source        text,
  "businessUnit" text,
  stage         text not null default 'NEW'
                  check (stage in ('NEW','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST')),
  "valueUsd"    numeric(16,2) not null default 0,
  "valueSdg"    numeric(18,2) not null default 0,
  notes         text,
  "campaignId"  uuid references campaigns(id) on delete set null,
  "ownerId"     uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

-- ── Events / BTL ─────────────────────────────────────────────────────
create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  "nameAr"      text,
  type          text,
  venue         text,
  city          text default 'Khartoum',
  "startDate"   timestamptz,
  "endDate"     timestamptz,
  status        text not null default 'PLANNED'
                  check (status in ('PLANNED','CONFIRMED','RUNNING','DONE','CANCELLED')),
  "budgetUsd"   numeric(16,2) not null default 0,
  "budgetSdg"   numeric(18,2) not null default 0,
  "ownerId"     uuid references users(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- ── Budget entries ───────────────────────────────────────────────────
create table if not exists budget_entries (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  kind          text not null default 'PLANNED' check (kind in ('PLANNED','SPENT')),
  channel       text not null default 'PAID'
                  check (channel in ('SOCIAL','PAID','EVENT','PR','EMAIL','WEB','BTL')),
  "amountUsd"   numeric(16,2) not null default 0,
  "amountSdg"   numeric(18,2) not null default 0,
  date          timestamptz not null default now(),
  "campaignId"  uuid references campaigns(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- ── Tasks ────────────────────────────────────────────────────────────
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  status        text not null default 'TODO' check (status in ('TODO','DOING','DONE')),
  priority      text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH')),
  "dueDate"     timestamptz,
  "assigneeId"  uuid references users(id) on delete set null,
  "campaignId"  uuid references campaigns(id) on delete set null,
  "leadId"      uuid references leads(id) on delete set null,
  "createdAt"   timestamptz not null default now()
);

-- ── Social accounts (connected channels) ─────────────────────────────
create table if not exists social_accounts (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null
                  check (platform in ('FACEBOOK','INSTAGRAM','X','LINKEDIN','YOUTUBE','TIKTOK')),
  handle        text not null,
  "displayName" text,
  status        text not null default 'PENDING'
                  check (status in ('CONNECTED','PENDING','DISCONNECTED')),
  "accessToken" text,           -- stored server-side; treat as a secret (see README)
  "externalId"  text,
  "connectedAt" timestamptz,
  "createdAt"   timestamptz not null default now()
);

-- ── Social metrics (the data fed in / pulled / imported) ─────────────
create table if not exists social_metrics (
  id            uuid primary key default gen_random_uuid(),
  "accountId"   uuid not null references social_accounts(id) on delete cascade,
  date          date not null default current_date,
  followers     numeric default 0,
  posts         numeric default 0,
  impressions   numeric default 0,
  reach         numeric default 0,
  engagement    numeric default 0,
  clicks        numeric default 0,
  "spendUsd"    numeric(16,2) default 0,
  source        text not null default 'MANUAL' check (source in ('MANUAL','CSV','API')),
  "createdAt"   timestamptz not null default now()
);

create index if not exists idx_metrics_account on social_metrics ("accountId", date);

-- ── Settings (single row) ────────────────────────────────────────────
create table if not exists settings (
  id            integer primary key default 1 check (id = 1),
  "orgName"     text not null default 'Saria Industrial Complex',
  "orgNameAr"   text not null default 'مجمع ساريا الصناعي',
  "usdToSdgRate" numeric not null default 2500
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- ── OSINT / Market intelligence ──────────────────────────────────────
-- Public market, brand and competitor intelligence (NOT individual tracking).
create table if not exists osint_topics (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  query         text not null,                 -- search expression
  lang          text not null default 'en',    -- 'ar' | 'en'
  region        text not null default 'SD',
  category      text not null default 'MARKET'
                  check (category in ('BRAND','COMPETITOR','MARKET','SECTOR','CUSTOM')),
  sources       jsonb not null default '["GOOGLE_NEWS","BING_NEWS","GDELT","REDDIT"]',
  feeds         jsonb not null default '[]',   -- extra custom RSS/Atom feed URLs
  active        boolean not null default true,
  "lastRunAt"   timestamptz,
  "createdAt"   timestamptz not null default now()
);

create table if not exists osint_signals (
  id              uuid primary key default gen_random_uuid(),
  "topicId"       uuid not null references osint_topics(id) on delete cascade,
  source          text,                         -- domain or provider
  "sourceType"    text not null default 'RSS'
                    check ("sourceType" in ('GOOGLE_NEWS','BING_NEWS','GDELT','REDDIT','RSS','MANUAL','SEARCH')),
  title           text not null,
  url             text,
  snippet         text,
  author          text,
  lang            text,
  sentiment       numeric not null default 0,   -- -1..1
  "sentimentLabel" text not null default 'NEU' check ("sentimentLabel" in ('NEG','NEU','POS')),
  "publishedAt"   timestamptz,
  "fetchedAt"     timestamptz not null default now(),
  "createdAt"     timestamptz not null default now()
);

create unique index if not exists idx_osint_dedupe on osint_signals ("topicId", url) where url is not null;
create index if not exists idx_osint_topic_date on osint_signals ("topicId", "publishedAt" desc);

-- ── Strategy & Planning: objectives / OKRs ───────────────────────────
-- Targets that the rest of HELM rolls up to. Progress is computed live
-- from leads / budget / content within each objective's date window.
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

-- ── Governance: roles & permissions ──────────────────────────────────
-- Built-in roles are seeded and locked; custom roles are user-defined.
-- permissions jsonb: { "admin": bool, "<module>": "none"|"read"|"write" }
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  label       text not null,
  "labelAr"   text,
  permissions jsonb not null default '{}'::jsonb,
  builtin     boolean not null default false,
  "createdAt" timestamptz not null default now()
);

-- ── Governance: audit trail (who did what, when) ─────────────────────
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

-- ── Performance indexes ──────────────────────────────────────────────
create index if not exists idx_leads_stage       on leads (stage);
create index if not exists idx_leads_updated     on leads ("updatedAt");
create index if not exists idx_tasks_status      on tasks (status);
create index if not exists idx_content_scheduled on content_items ("scheduledAt");
create index if not exists idx_audit_created     on audit_log ("createdAt");

-- ── Notifications: the system reaches the team, not the reverse ──────
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  "userId"    uuid not null references users(id) on delete cascade,
  type        text not null,               -- TASK_ASSIGNED / LEAD_CAPTURED / ALERT_* ...
  meta        jsonb,                       -- values the UI localizes (title, company, ...)
  link        text,                        -- in-app route
  "readAt"    timestamptz,
  "createdAt" timestamptz not null default now()
);
create index if not exists idx_notif_user on notifications ("userId", "readAt", "createdAt" desc);

-- ── Lead activity timeline: what happened with this account ──────────
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

-- ═══════════════════ HUB MODELS (Phases A–C) ═══════════════════

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
