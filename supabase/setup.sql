-- HELM — ONE-SHOT SETUP (schema + demo data). Run this whole file once in the Supabase SQL Editor.
-- Safe to re-run: tables use IF NOT EXISTS; the seed clears and re-inserts demo data.

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

-- M10 · AI CMO conversation memory
create table if not exists ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  "userId"      uuid not null references users(id) on delete cascade,
  title         text not null default 'New conversation',
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

create table if not exists ai_messages (
  id              uuid primary key default gen_random_uuid(),
  "conversationId" uuid not null references ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','cmo')),
  text            text not null default '',
  reasoning       text,
  label           text,
  "createdAt"     timestamptz not null default now()
);

create index if not exists idx_ai_messages_conversation on ai_messages ("conversationId", "createdAt");
create index if not exists idx_ai_conversations_user on ai_conversations ("userId", "updatedAt" desc);

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

-- ========================= SEED DATA =========================

-- HELM seed data (Supabase / PostgreSQL)
-- Safe to run on a fresh database. Demo password for all users: Helm@2026
-- Run AFTER schema.sql. Idempotent-ish: clears app tables first.

begin;

truncate feedback, assets, posts, influencer_collabs, influencers, press_items, media_contacts, customers, event_registrations, tracked_links, campaign_briefs, personas, segments, products, process_templates, roles, objectives, osint_signals, osint_topics, social_metrics, social_accounts, tasks, budget_entries,
         content_items, events, leads, campaigns, users restart identity cascade;

-- Roles (built-in) ------------------------------------------------------
insert into roles (key, label, "labelAr", permissions, builtin) values
  ('HEAD',          'Head of Marketing', 'رئيس التسويق',        '{"admin":true,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read"}',    true),
  ('DIGITAL',       'Digital Lead',      'مسؤول الرقمي',        '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read"}', true),
  ('PAID_MEDIA',    'Paid Media',        'الإعلانات المدفوعة',  '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true),
  ('EVENTS',        'Events',            'الفعاليات',           '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true),
  ('CONTENT_BRAND', 'Content & Brand',   'المحتوى والعلامة',    '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true);


update settings set "usdToSdgRate" = 2500 where id = 1;

-- Demo password hash = bcrypt('Helm@2026')
-- Users -----------------------------------------------------------------
insert into users (id, name, email, "passwordHash", role, "titleAr") values
  ('11111111-1111-1111-1111-111111111111','Yousra Idris','head@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','HEAD','رئيس قسم التسويق'),
  ('22222222-2222-2222-2222-222222222222','Mazin Tarig','digital@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','DIGITAL','مسؤول التسويق الرقمي'),
  ('33333333-3333-3333-3333-333333333333','Rawan Osman','paid@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','PAID_MEDIA','مسؤول الإعلانات المدفوعة'),
  ('44444444-4444-4444-4444-444444444444','Khalid Babiker','events@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','EVENTS','مسؤول الفعاليات والأنشطة الميدانية'),
  ('55555555-5555-5555-5555-555555555555','Sara Hamid','content@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','CONTENT_BRAND','مسؤول المحتوى والعلامة التجارية');

-- Campaigns -------------------------------------------------------------
insert into campaigns (id, name, "nameAr", objective, status, channel, "startDate", "endDate", "budgetUsd", "budgetSdg", "businessUnit", "ownerId") values
  ('c0000001-0000-0000-0000-000000000001','Ramadan Battery Promotion','عرض بطاريات رمضان','Drive retail demand for Saria batteries during peak season','ACTIVE','SOCIAL', now()-interval '20 day', now()+interval '10 day', 12000, 30000000,'Batteries','22222222-2222-2222-2222-222222222222'),
  ('c0000002-0000-0000-0000-000000000002','SES Solar Solutions Launch','إطلاق حلول الطاقة الشمسية','Position SES as the local solar EPC partner','ACTIVE','PAID', now()-interval '5 day', now()+interval '40 day', 25000, 62500000,'SES','33333333-3333-3333-3333-333333333333'),
  ('c0000003-0000-0000-0000-000000000003','Plastics Distributor Drive','حملة موزعي البلاستيك','Recruit regional distributors for plastics line','PLANNING','BTL', now()+interval '15 day', now()+interval '60 day', 8000, 20000000,'Plastics','44444444-4444-4444-4444-444444444444'),
  ('c0000004-0000-0000-0000-000000000004','Saria — Made Locally','ساريا — صُنع محلياً','Corporate brand campaign on local manufacturing','ACTIVE','PR', now()-interval '30 day', now()+interval '30 day', 18000, 45000000,'Group','55555555-5555-5555-5555-555555555555'),
  ('c0000005-0000-0000-0000-000000000005','Odoo ERP Awareness','التوعية بنظام أودو','Generate ERP implementation leads','PAUSED','EMAIL', now()-interval '45 day', now()-interval '5 day', 6000, 15000000,'SES','22222222-2222-2222-2222-222222222222');

-- Content ---------------------------------------------------------------
insert into content_items (title, "titleAr", channel, status, "scheduledAt", "campaignId", "authorId") values
  ('Ramadan battery offer reel','ريل عرض البطاريات','SOCIAL','PUBLISHED', now()-interval '3 day','c0000001-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555'),
  ('Solar ROI calculator post','منشور حاسبة عائد الطاقة الشمسية','SOCIAL','REVIEW', now()+interval '2 day','c0000002-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222'),
  ('Customer story: factory off-grid','قصة عميل: مصنع خارج الشبكة','WEB','IN_PROGRESS', now()+interval '5 day','c0000002-0000-0000-0000-000000000002','55555555-5555-5555-5555-555555555555'),
  ('Made-locally brand film','فيلم صُنع محلياً','PR','APPROVED', now()+interval '7 day','c0000004-0000-0000-0000-000000000004','55555555-5555-5555-5555-555555555555'),
  ('Distributor recruitment one-pager','نشرة استقطاب الموزعين','BTL','IDEA', now()+interval '12 day','c0000003-0000-0000-0000-000000000003','44444444-4444-4444-4444-444444444444'),
  ('Odoo webinar invite email','دعوة ندوة أودو','EMAIL','IDEA', now()+interval '9 day','c0000005-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222'),
  ('Battery quality explainer','شرح جودة البطاريات','SOCIAL','IN_PROGRESS', now()+interval '4 day','c0000001-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');

-- Leads -----------------------------------------------------------------
insert into leads (company, "contactName", source, "businessUnit", stage, "valueUsd", "valueSdg", "ownerId", email) values
  ('Ministry of Energy','Eng. Tarig A.','Exhibition','SES','PROPOSAL',120000,300000000,'33333333-3333-3333-3333-333333333333','procurement@energy.gov.sd'),
  ('Blue Nile Contracting','Mr. Osman','Web form','SES','QUALIFIED',45000,112500000,'22222222-2222-2222-2222-222222222222',null),
  ('Khartoum Mall Group','Ms. Amani','Referral','Batteries','NEGOTIATION',30000,75000000,'11111111-1111-1111-1111-111111111111',null),
  ('Gezira Agri Co.','Mr. Fadl','Exhibition','Plastics','NEW',18000,45000000,'44444444-4444-4444-4444-444444444444',null),
  ('Red Sea Logistics','Capt. Idris','Web form','SES','WON',80000,200000000,'33333333-3333-3333-3333-333333333333',null),
  ('Nile Cement','Eng. Suad','Referral','SES','LOST',60000,150000000,'22222222-2222-2222-2222-222222222222',null),
  ('Omdurman Hospital','Dr. Hind','Web form','SES','QUALIFIED',95000,237500000,'11111111-1111-1111-1111-111111111111',null);

-- Events ----------------------------------------------------------------
insert into events (name, "nameAr", type, venue, city, "startDate", "endDate", status, "budgetUsd", "budgetSdg", "ownerId") values
  ('Khartoum International Fair','معرض الخرطوم الدولي','Exhibition','Khartoum Fairground','Khartoum', now()+interval '18 day', now()+interval '25 day','CONFIRMED',15000,37500000,'44444444-4444-4444-4444-444444444444'),
  ('Solar Energy Expo','معرض الطاقة الشمسية','Exhibition','Friendship Hall','Khartoum', now()+interval '45 day', now()+interval '47 day','PLANNED',9000,22500000,'44444444-4444-4444-4444-444444444444'),
  ('SES ICT Roadshow — Port Sudan','جولة تقنية المعلومات — بورتسودان','Activation','Coral Hotel','Port Sudan', now()-interval '2 day', now()+interval '1 day','RUNNING',5000,12500000,'44444444-4444-4444-4444-444444444444'),
  ('Distributor Day','يوم الموزعين','Conference','Saria HQ','Khartoum', now()+interval '30 day', now()+interval '30 day','PLANNED',4000,10000000,'44444444-4444-4444-4444-444444444444');

-- Budget ----------------------------------------------------------------
insert into budget_entries (label, kind, channel, "amountUsd", "amountSdg", date, "campaignId") values
  ('Meta ads — Ramadan','SPENT','PAID',4200,10500000, now()-interval '8 day','c0000001-0000-0000-0000-000000000001'),
  ('Google ads — Solar','SPENT','PAID',6800,17000000, now()-interval '3 day','c0000002-0000-0000-0000-000000000002'),
  ('Influencer batch','SPENT','SOCIAL',2500,6250000, now()-interval '6 day','c0000001-0000-0000-0000-000000000001'),
  ('PR newswire','SPENT','PR',1800,4500000, now()-interval '12 day','c0000004-0000-0000-0000-000000000004'),
  ('Fair booth deposit','SPENT','EVENT',5000,12500000, now()-interval '1 day',null),
  ('Q3 paid media plan','PLANNED','PAID',30000,75000000, now()+interval '20 day','c0000002-0000-0000-0000-000000000002'),
  ('BTL distributor drive','PLANNED','BTL',8000,20000000, now()+interval '15 day','c0000003-0000-0000-0000-000000000003'),
  ('Brand film production','PLANNED','PR',12000,30000000, now()+interval '10 day','c0000004-0000-0000-0000-000000000004');

-- Tasks -----------------------------------------------------------------
insert into tasks (title, status, priority, "dueDate", "assigneeId", "campaignId") values
  ('Approve solar ROI post','TODO','HIGH', now()+interval '1 day','11111111-1111-1111-1111-111111111111','c0000002-0000-0000-0000-000000000002'),
  ('Brief influencer batch 2','DOING','MEDIUM', now()+interval '3 day','22222222-2222-2222-2222-222222222222','c0000001-0000-0000-0000-000000000001'),
  ('Confirm fair booth design','DOING','HIGH', now()+interval '5 day','44444444-4444-4444-4444-444444444444',null),
  ('Finalize brand film script','TODO','MEDIUM', now()+interval '4 day','55555555-5555-5555-5555-555555555555','c0000004-0000-0000-0000-000000000004'),
  ('Reconcile May paid spend','DONE','LOW', now()-interval '2 day','33333333-3333-3333-3333-333333333333',null),
  ('Distributor list research','TODO','MEDIUM', now()+interval '7 day','44444444-4444-4444-4444-444444444444','c0000003-0000-0000-0000-000000000003');

-- Sample connected social accounts (status PENDING until real OAuth) -----
insert into social_accounts (id, platform, handle, "displayName", status) values
  ('a0000001-0000-0000-0000-000000000001','INSTAGRAM','@saria.industrial','Saria Industrial','PENDING'),
  ('a0000002-0000-0000-0000-000000000002','FACEBOOK','SariaIndustrial','Saria Industrial Complex','PENDING'),
  ('a0000003-0000-0000-0000-000000000003','LINKEDIN','saria-electronic-systems','Saria Electronic Systems','PENDING');

-- OSINT watch-topics (public market/brand/competitor intelligence) ------
insert into osint_topics (label, query, lang, region, category) values
  ('Saria brand mentions', '"Saria Industrial" OR "ساريا" OR "Saria Electronic Systems"', 'en', 'SD', 'BRAND'),
  ('Sudan solar energy market', 'Sudan solar energy OR "الطاقة الشمسية السودان"', 'en', 'SD', 'MARKET'),
  ('Sudan battery & power', 'Sudan battery OR "بطاريات السودان" OR power backup Sudan', 'en', 'SD', 'SECTOR'),
  ('Sudan ICT & ERP tenders', 'Sudan ICT tender OR Odoo Sudan OR "مناقصة تقنية المعلومات"', 'en', 'SD', 'MARKET'),
  ('Nile Power Systems (competitor)', '"Nile Power Systems" OR "أنظمة النيل للطاقة"', 'en', 'SD', 'COMPETITOR');

-- Strategy objectives / OKRs (windows span 2026 so live progress shows) ---
insert into objectives (label, "labelAr", metric, "targetValue", "startDate", "endDate", "businessUnit", "ownerId") values
  ('2026 qualified pipeline', 'خط الأنابيب المؤهل ٢٠٢٦', 'PIPELINE_USD', 500000, '2026-01-01', '2026-12-31', 'All', (select id from users where email='head@saria.sd')),
  ('H1 2026 new leads', 'عملاء محتملون جدد النصف الأول', 'LEADS_COUNT', 40, '2026-01-01', '2026-06-30', 'All', (select id from users where email='digital@saria.sd')),
  ('2026 won revenue', 'الإيرادات المكسوبة ٢٠٢٦', 'WON_USD', 150000, '2026-01-01', '2026-12-31', 'All', (select id from users where email='head@saria.sd')),
  ('Q2 content published', 'المحتوى المنشور الربع الثاني', 'CONTENT_PUBLISHED', 15, '2026-04-01', '2026-06-30', 'Marketing', (select id from users where email='content@saria.sd')),
  ('2026 marketing spend cap', 'سقف الإنفاق التسويقي ٢٠٢٦', 'SPEND_USD', 120000, '2026-01-01', '2026-12-31', 'All', (select id from users where email='head@saria.sd'));

commit;


-- Demo listening data (relative dates → the Listening page is alive on first run) --
insert into osint_signals ("topicId", source, "sourceType", title, lang, sentiment, "sentimentLabel", "publishedAt")
select t.id, v.source, v.stype, v.title, v.lang, v.sent, v.slabel, now() - (v.days || ' days')::interval
from (values
  -- Brand mentions: steady drumbeat, positive tilt, small spike this week
  ('Saria brand mentions','sudantribune.com','GOOGLE_NEWS','Saria expands solar assembly line in Khartoum North','en',0.7,'POS',2),
  ('Saria brand mentions','alrakoba.net','RSS','ساريا تعلن شراكة لتجميع البطاريات محلياً','ar',0.6,'POS',3),
  ('Saria brand mentions','medameek.com','RSS','قرّاء يسألون عن أسعار أنظمة ساريا الشمسية','ar',0.1,'NEU',4),
  ('Saria brand mentions','dabangasudan.org','GOOGLE_NEWS','Distributor lists Saria inverters in Port Sudan','en',0.3,'POS',5),
  ('Saria brand mentions','sudanakhbar.com','RSS','شكوى من تأخر صيانة في أحد مراكز الخدمة','ar',-0.5,'NEG',6),
  ('Saria brand mentions','gdelt','GDELT','Saria cited in industrial recovery briefing','en',0.4,'POS',9),
  ('Saria brand mentions','sudantribune.com','GOOGLE_NEWS','Solar assembly jobs announcement mentions Saria','en',0.5,'POS',12),
  ('Saria brand mentions','alrakoba.net','RSS','مقارنة بين مزودي الطاقة الشمسية في السودان','ar',0.0,'NEU',16),
  ('Saria brand mentions','medameek.com','RSS','ساريا ترعى معرض الخرطوم للصناعات','ar',0.6,'POS',20),
  ('Saria brand mentions','sudanakhbar.com','RSS','استفسارات عن ضمان بطاريات ساريا','ar',0.0,'NEU',24),
  ('Saria brand mentions','gdelt','GDELT','Regional supplier roundup includes Saria','en',0.2,'NEU',31),
  ('Saria brand mentions','dabangasudan.org','GOOGLE_NEWS','Saria ICT unit demos ERP rollout for factories','en',0.5,'POS',38),
  ('Saria brand mentions','sudantribune.com','GOOGLE_NEWS','Saria battery plant tour coverage','en',0.4,'POS',45),
  ('Saria brand mentions','alrakoba.net','RSS','تغطية إعلامية لمشروع طاقة شمسية بمشاركة ساريا','ar',0.5,'POS',52),
  -- Competitor mentions: thinner, mixed
  ('Nile Power Systems (competitor)','sudanakhbar.com','RSS','أنظمة النيل تطلق عرضاً على المحولات','ar',0.3,'POS',3),
  ('Nile Power Systems (competitor)','gdelt','GDELT','Nile Power Systems tender participation noted','en',0.1,'NEU',8),
  ('Nile Power Systems (competitor)','medameek.com','RSS','تباين آراء حول خدمة ما بعد البيع لدى أنظمة النيل','ar',-0.3,'NEG',13),
  ('Nile Power Systems (competitor)','sudantribune.com','GOOGLE_NEWS','Nile Power expands Omdurman showroom','en',0.4,'POS',22),
  ('Nile Power Systems (competitor)','alrakoba.net','RSS','مقال يذكر أنظمة النيل ضمن الموردين المحليين','ar',0.0,'NEU',30),
  ('Nile Power Systems (competitor)','gdelt','GDELT','Competitor pricing chatter in energy forum digest','en',-0.1,'NEU',41),
  ('Nile Power Systems (competitor)','sudanakhbar.com','RSS','أنظمة النيل ترعى ندوة الطاقة','ar',0.3,'POS',50),
  -- Market context (kept out of SOV, feeds volume/sources)
  ('Sudan solar energy market','dabangasudan.org','GOOGLE_NEWS','Solar import duties clarified for 2026','en',0.2,'NEU',2),
  ('Sudan solar energy market','sudantribune.com','GOOGLE_NEWS','Khartoum factories turn to hybrid solar-diesel power','en',0.3,'POS',10),
  ('Sudan battery & power','gdelt','GDELT','Battery demand rises with grid instability','en',-0.2,'NEU',18)
) as v(topic, source, stype, title, lang, sent, slabel, days)
join osint_topics t on t.label = v.topic;

-- Weekly platform snapshots per account (manual/CSV-style monitoring data) --
insert into social_metrics ("accountId", date, followers, posts, impressions, reach, engagement, source)
select a.id, (now() - (v.days || ' days')::interval)::date, v.f, v.p, v.imp, v.reach, v.eng, 'MANUAL'
from (values
  ('@saria.industrial', 28, 12180, 3, 20100, 15400, 610, 0),
  ('@saria.industrial', 21, 12310, 4, 22800, 17200, 700, 0),
  ('@saria.industrial', 14, 12475, 3, 21500, 16600, 655, 0),
  ('@saria.industrial',  7, 12640, 5, 26300, 20100, 940, 0),
  ('SariaIndustrial',   28, 33400, 4, 40100, 30800, 820, 0),
  ('SariaIndustrial',   21, 33520, 3, 37600, 28900, 760, 0),
  ('SariaIndustrial',   14, 33710, 4, 41900, 32400, 905, 0),
  ('SariaIndustrial',    7, 33880, 4, 43200, 33500, 980, 0),
  ('saria-electronic-systems', 28, 4120, 2, 6900, 5200, 210, 0),
  ('saria-electronic-systems', 21, 4180, 2, 7300, 5600, 235, 0),
  ('saria-electronic-systems', 14, 4230, 1, 6100, 4700, 190, 0),
  ('saria-electronic-systems',  7, 4295, 2, 7800, 6000, 265, 0)
) as v(handle, days, f, p, imp, reach, eng, pad)
join social_accounts a on a.handle = v.handle;

-- ═══ HUB seed (Phase A–C demo) ═══════════════════════════════════════
insert into process_templates (key, name, "nameAr", builtin, tasks) values
('campaign_launch','Campaign launch','إطلاق حملة',true,'[
 {"t":{"ar":"تحديد الهدف ومؤشرات الأداء","en":"Define objective & KPIs"},"offset":0,"priority":"HIGH"},
 {"t":{"ar":"موجز الجمهور والرسالة","en":"Audience & message brief"},"offset":1,"priority":"HIGH"},
 {"t":{"ar":"اعتماد توزيع الميزانية","en":"Budget allocation approved"},"offset":2,"priority":"HIGH"},
 {"t":{"ar":"موجز التصاميم والمواد","en":"Creative assets brief"},"offset":2,"priority":"MEDIUM"},
 {"t":{"ar":"إنتاج المحتوى","en":"Content production"},"offset":5,"priority":"MEDIUM"},
 {"t":{"ar":"تجهيز القنوات والتتبع","en":"Channel setup & tracking"},"offset":7,"priority":"MEDIUM"},
 {"t":{"ar":"مراجعة واعتماد داخلي","en":"Internal review & approval"},"offset":9,"priority":"HIGH"},
 {"t":{"ar":"الإطلاق","en":"Launch"},"offset":10,"priority":"HIGH"},
 {"t":{"ar":"فحص الأداء (اليوم الثالث)","en":"Day-3 performance check"},"offset":13,"priority":"MEDIUM"}]'),
('event_prep','Event preparation','تحضير فعالية',true,'[
 {"t":{"ar":"حجز المكان","en":"Venue booking"},"offset":0,"priority":"HIGH"},
 {"t":{"ar":"المتحدثون وجدول الأعمال","en":"Speakers & agenda"},"offset":3,"priority":"MEDIUM"},
 {"t":{"ar":"الدعوات وصفحة التسجيل","en":"Invitations & registration"},"offset":5,"priority":"HIGH"},
 {"t":{"ar":"تصميم الجناح والمطبوعات","en":"Booth & collateral design"},"offset":7,"priority":"MEDIUM"},
 {"t":{"ar":"خطة الإعلام والتواصل","en":"Media & social plan"},"offset":8,"priority":"MEDIUM"},
 {"t":{"ar":"قائمة اللوجستيات","en":"Logistics checklist"},"offset":10,"priority":"MEDIUM"},
 {"t":{"ar":"برنامج يوم الفعالية","en":"Event-day run sheet"},"offset":12,"priority":"HIGH"},
 {"t":{"ar":"متابعة ما بعد الفعالية واستيراد العملاء","en":"Post-event follow-up & leads import"},"offset":14,"priority":"HIGH"}]'),
('content_sprint','Content sprint','سباق محتوى',true,'[
 {"t":{"ar":"بحث الموضوع والكلمات المفتاحية","en":"Topic research & keywords"},"offset":0,"priority":"MEDIUM"},
 {"t":{"ar":"اعتماد المخطط","en":"Outline approval"},"offset":1,"priority":"MEDIUM"},
 {"t":{"ar":"المسودة","en":"Draft"},"offset":3,"priority":"MEDIUM"},
 {"t":{"ar":"التصميم والمرئيات","en":"Design & visuals"},"offset":5,"priority":"MEDIUM"},
 {"t":{"ar":"مراجعة واعتماد","en":"Review & approve"},"offset":6,"priority":"HIGH"},
 {"t":{"ar":"النشر والتوزيع","en":"Publish & distribute"},"offset":7,"priority":"HIGH"}]'),
('lead_followup','Lead follow-up cadence','متابعة عميل محتمل',true,'[
 {"t":{"ar":"مكالمة التواصل الأولى","en":"First contact call"},"offset":0,"priority":"HIGH"},
 {"t":{"ar":"إرسال ملف الشركة","en":"Send company profile"},"offset":1,"priority":"MEDIUM"},
 {"t":{"ar":"اجتماع التأهيل","en":"Qualification meeting"},"offset":3,"priority":"HIGH"},
 {"t":{"ar":"مسودة العرض","en":"Proposal draft"},"offset":6,"priority":"HIGH"},
 {"t":{"ar":"متابعة وخطة الإغلاق","en":"Follow-up & close plan"},"offset":10,"priority":"MEDIUM"}]');

insert into products (name, "nameAr", "businessUnit", category, "priceMinUsd", "priceMaxUsd") values
 ('NP7 Sealed Battery','بطارية NP7','Batteries','Power', 18, 30),
 ('5kW Hybrid Solar System','نظام شمسي هجين ٥ ك.و','Solar','Energy systems', 2800, 4200),
 ('Odoo ERP Implementation','تطبيق نظام أودو','ICT','Software services', 4000, 15000);

insert into segments (name, "nameAr", "businessUnit", kind, "sizeEstimate") values
 ('Battery distributors','موزعو البطاريات','Batteries','B2B_DISTRIBUTOR','~120 in Sudan'),
 ('Factories needing backup power','مصانع تحتاج طاقة احتياطية','Solar','B2B_ENTERPRISE','~300 Khartoum region');

insert into personas ("segmentId", name, "nameAr", goals, pains, channels, message, "messageAr") values
 ((select id from segments where name='Battery distributors'),'Distributor owner','صاحب محل توزيع',
  'Reliable supply, good margin','Fakes in market, FX volatility','["WHATSAPP","VISIT","EXPO"]',
  'Genuine stock, dealer pricing, fast Khartoum delivery','منتج أصلي وسعر موزع وتوصيل سريع'),
 ((select id from segments where name='Battery distributors'),'Purchasing manager','مدير مشتريات',
  'Total cost & warranty','Downtime risk','["EMAIL","CALL"]','Warranty-backed supply contracts','عقود توريد بضمان'),
 ((select id from segments where name='Factories needing backup power'),'Factory operations manager','مدير عمليات مصنع',
  'Uninterrupted production','Diesel cost, outages','["WHATSAPP","SITE_VISIT"]',
  'Hybrid solar cuts diesel spend 40%','النظام الهجين يخفض الديزل ٤٠٪');

insert into media_contacts (name, outlet, role, phone, beat, tier) values
 ('Mohamed Idris','Sudan Tribune','Business editor','+249912000001','Industry & energy','TIER1'),
 ('Sara Al-Tayeb','Alrakoba','Economy desk','+249912000002','Markets','TIER2');

insert into press_items (title, "contactId", status) values
 ('Saria solar assembly expansion story', (select id from media_contacts where name='Mohamed Idris'), 'PITCHED');

insert into influencers (name, platform, handle, audience, niche, "rateUsd", rating) values
 ('Khalid Tech SD','FACEBOOK','khalid.tech.sd', 85000, 'Tech & energy reviews', 150, 4);

insert into posts ("contentId", platform, "publishedAt", reach, impressions, engagement, clicks) values
 ((select id from content_items limit 1),'FACEBOOK', now() - interval '6 days', 15200, 19800, 640, 210),
 ((select id from content_items limit 1),'INSTAGRAM', now() - interval '5 days', 8900, 11400, 512, 96);
