-- HELM — AI CMO conversation persistence
-- Adds ai_conversations and ai_messages tables for server-side chat history.
-- Idempotent: safe to run more than once.

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
