-- HELM — apply latest changes to an EXISTING database. Run once in the Supabase SQL Editor.
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

-- 9) AI CMO conversation persistence
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
