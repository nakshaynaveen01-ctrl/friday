-- Friday's memory tables (applied to the eve-desk Supabase project on 2026-11-23).
-- RLS is on with no policies: only the service key on Render can read or write.
create table if not exists public.friday_messages (
  id bigserial primary key,
  channel text not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  summarized boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists friday_messages_channel_idx on public.friday_messages (channel, id desc);
create table if not exists public.friday_facts (
  id bigserial primary key,
  kind text not null default 'fact' check (kind in ('fact','rule')),
  fact text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists friday_facts_unique on public.friday_facts (kind, lower(fact));
create table if not exists public.friday_summaries (channel text primary key, summary text not null, updated_at timestamptz not null default now());
create table if not exists public.friday_seen (id text primary key, created_at timestamptz not null default now());
create table if not exists public.friday_kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.friday_messages enable row level security;
alter table public.friday_facts enable row level security;
alter table public.friday_summaries enable row level security;
alter table public.friday_seen enable row level security;
alter table public.friday_kv enable row level security;
