-- Run once in the Supabase SQL Editor to add the lead → campaign link
-- to an existing HELM database (completes the signal → lead → campaign loop).
alter table leads
  add column if not exists "campaignId" uuid references campaigns(id) on delete set null;
