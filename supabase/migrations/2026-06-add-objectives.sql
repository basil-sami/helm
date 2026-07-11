-- Run once in the Supabase SQL Editor to add the Planning & Strategy
-- (objectives / OKRs) table to an existing HELM database.
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
