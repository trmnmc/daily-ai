-- daily-ai-updates: initial schema migration
--
-- Implements the data model from:
--   ~/.gstack/projects/daily-ai-updates/truman-nobranch-design-20260507-142511.md
--   → "Recommended Approach → Data model" section.
--
-- Tables: sources, stories, story_scores, users, user_repos, card_actions,
--         artifacts, usage_meter, cost_ledger, ingestion_log, patch_log,
--         scoring_retry_queue, invites
--
-- Plus: indexes, RLS policies, pgcrypto encryption helpers, atomic budget
--       function (race-safe), and the user-bootstrap trigger.

-- ─────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- ─────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────

create type card_action as enum ('ignore', 'try', 'patch');
create type artifact_type as enum ('try', 'patch');
create type source_type as enum ('rss', 'github_trending', 'hn_algolia');
create type ingestion_status as enum ('success', 'failure', 'partial');
create type patch_status as enum ('success', 'overflow', 'error');

-- ─────────────────────────────────────────────────────────────────────
-- public.users  (joined to auth.users via id FK; auto-bootstrapped on signup)
-- ─────────────────────────────────────────────────────────────────────

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  profile_md text default '',
  github_pat_encrypted bytea,  -- nullable; only present if user pasted a PAT
  created_at timestamptz not null default now()
);

-- Bootstrap a public.users row when a new auth.users row is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────
-- Sources & stories  (global; no user FK)
-- ─────────────────────────────────────────────────────────────────────

create table public.sources (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,                -- e.g. 'anthropic-blog', 'gh-trending', 'hn-algolia'
  type source_type not null,
  url text,                                  -- RSS feed URL or scrape root
  last_run_at timestamptz,
  last_status ingestion_status
);

create table public.stories (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.sources(id) on delete cascade,
  title text not null,
  url text not null unique,                  -- dedupe key across sources
  body text,                                  -- truncated to 10KB before insert
  fetched_at timestamptz not null default now()
);

create index idx_stories_fetched_at on public.stories (fetched_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Story scores  (per (user, story); the feed read uses this)
-- ─────────────────────────────────────────────────────────────────────

create table public.story_scores (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  why_i_care text not null,
  tags text[] not null default array[]::text[],
  scored_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

-- Feed query: WHERE user_id = ? AND score >= 60 ORDER BY score DESC
create index idx_story_scores_user_score on public.story_scores (user_id, score desc);

-- ─────────────────────────────────────────────────────────────────────
-- User repos  (cached read of public GitHub repo metadata)
-- ─────────────────────────────────────────────────────────────────────

create table public.user_repos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  repo_url text not null,
  readme text,
  manifest_json jsonb,                       -- merged package.json / requirements.txt / pyproject.toml
  fetched_at timestamptz not null default now(),
  unique (user_id, repo_url)
);

-- 7-day refresh sweep: WHERE fetched_at < now() - interval '7 days'
create index idx_user_repos_fetched_at on public.user_repos (fetched_at);

-- ─────────────────────────────────────────────────────────────────────
-- Card actions  (Ignore/Try/Patch button clicks)
-- ─────────────────────────────────────────────────────────────────────

create table public.card_actions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  action card_action not null,
  created_at timestamptz not null default now()
);

-- Ignore-history fetch: WHERE user_id = ? AND action = 'ignore' ORDER BY created_at DESC LIMIT 100
create index idx_card_actions_user_created on public.card_actions (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Artifacts  (Try scripts and Patch .patch files)
-- ─────────────────────────────────────────────────────────────────────

create table public.artifacts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  type artifact_type not null,
  content text not null,                     -- the script body or unified diff text
  run_command text,                          -- e.g. 'uv run script.py' or 'git apply story-N.patch'
  created_at timestamptz not null default now()
);

create index idx_artifacts_user_created on public.artifacts (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Usage meter  (per-user soft caps: 10 Try + 5 Patch per day)
-- ─────────────────────────────────────────────────────────────────────

create table public.usage_meter (
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  tries_used integer not null default 0,
  patches_used integer not null default 0,
  primary key (user_id, date)
);

-- ─────────────────────────────────────────────────────────────────────
-- Cost ledger  (global daily spend; race-safe via try_charge_budget below)
-- ─────────────────────────────────────────────────────────────────────

create table public.cost_ledger (
  date date primary key,
  usd_spent numeric(10, 4) not null default 0,
  daily_cap numeric(10, 4) not null default 5.00
);

-- ─────────────────────────────────────────────────────────────────────
-- Ingestion + Patch logs  (operational telemetry)
-- ─────────────────────────────────────────────────────────────────────

create table public.ingestion_log (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid references public.sources(id) on delete set null,
  run_at timestamptz not null default now(),
  status ingestion_status not null,
  error_text text
);

create table public.patch_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  status patch_status not null,
  iterations_used smallint,
  partial_diff text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- Scoring retry queue  (transient failures during scoring loop)
-- ─────────────────────────────────────────────────────────────────────

create table public.scoring_retry_queue (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  failure_reason text,
  enqueued_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- Invites  (one-shot magic-link tokens for friend signups in v1.5+)
-- ─────────────────────────────────────────────────────────────────────

create table public.invites (
  token text primary key,
  redeemed_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

-- ─────────────────────────────────────────────────────────────────────
-- Atomic budget function  (closes the cost-cap race condition)
-- ─────────────────────────────────────────────────────────────────────
--
-- Two simultaneous Try requests both check `usd_spent < cap`, both pass, both
-- increment, exceed cap. Fix: SELECT FOR UPDATE row lock + atomic increment.
-- Returns true if the charge succeeded, false if it would exceed the cap.

create or replace function public.try_charge_budget(p_amount numeric)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  today date := current_date;
  current_spent numeric;
  current_cap numeric;
begin
  -- Insert today's row if it doesn't exist (idempotent).
  insert into public.cost_ledger (date, usd_spent, daily_cap)
  values (today, 0, 5.00)
  on conflict (date) do nothing;

  -- Lock the row for the duration of the transaction.
  select usd_spent, daily_cap
    into current_spent, current_cap
    from public.cost_ledger
    where date = today
    for update;

  if current_spent + p_amount > current_cap then
    return false;
  end if;

  update public.cost_ledger
    set usd_spent = current_spent + p_amount
    where date = today;

  return true;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Encryption helpers  (PAT encryption via pgcrypto)
-- ─────────────────────────────────────────────────────────────────────
--
-- The encryption key lives in app.encryption_key, set per-connection from
-- the ENCRYPTION_KEY env var. Wrapping in functions removes the silent-failure
-- mode where a forgotten set_encryption_key() returns garbage.

create or replace function public.set_encryption_key(p_key text)
returns void
language plpgsql
security definer
as $$
begin
  perform set_config('app.encryption_key', p_key, false);
end;
$$;

create or replace function public.encrypt_pat(p_user_id uuid, p_pat text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  k text;
begin
  k := current_setting('app.encryption_key', true);
  if k is null or k = '' then
    raise exception 'encryption_key not set; call set_encryption_key() first';
  end if;
  update public.users
    set github_pat_encrypted = pgp_sym_encrypt(p_pat, k)
    where id = p_user_id;
end;
$$;

create or replace function public.decrypt_pat(p_user_id uuid)
returns text
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  k text;
  ciphertext bytea;
begin
  k := current_setting('app.encryption_key', true);
  if k is null or k = '' then
    raise exception 'encryption_key not set; call set_encryption_key() first';
  end if;
  select github_pat_encrypted into ciphertext
    from public.users
    where id = p_user_id;
  if ciphertext is null then
    return null;
  end if;
  return pgp_sym_decrypt(ciphertext, k);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────
--
-- Policy: auth.uid() = user_id for all reads/writes on per-user tables.
-- sources and stories are global (read-only via API; writes only via
-- service role from cron).

alter table public.users enable row level security;
alter table public.user_repos enable row level security;
alter table public.story_scores enable row level security;
alter table public.card_actions enable row level security;
alter table public.artifacts enable row level security;
alter table public.usage_meter enable row level security;
alter table public.patch_log enable row level security;
alter table public.scoring_retry_queue enable row level security;
alter table public.invites enable row level security;

-- public.users: a user can read and update their own row only.
create policy users_self_read on public.users
  for select using (auth.uid() = id);
create policy users_self_update on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Per-user tables: standard auth.uid() = user_id policy.
create policy user_repos_self on public.user_repos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy story_scores_self_read on public.story_scores
  for select using (auth.uid() = user_id);

create policy card_actions_self on public.card_actions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy artifacts_self on public.artifacts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy usage_meter_self on public.usage_meter
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy patch_log_self_read on public.patch_log
  for select using (auth.uid() = user_id);

create policy scoring_retry_queue_self_read on public.scoring_retry_queue
  for select using (auth.uid() = user_id);

-- Invites: only the redeemer can read their own redemption row; everyone
-- else sees nothing. New tokens are inserted via service role.
create policy invites_self_read on public.invites
  for select using (auth.uid() = redeemed_by_user_id or redeemed_by_user_id is null);

-- sources, stories, cost_ledger, ingestion_log: NO row-level security.
-- Writes happen via service role only; reads are controlled at the API layer
-- (server actions / route handlers do not expose these directly to clients).

-- ─────────────────────────────────────────────────────────────────────
-- Seed sources  (the 3 v1 sources)
-- ─────────────────────────────────────────────────────────────────────

insert into public.sources (name, type, url) values
  ('anthropic-blog', 'rss', 'https://www.anthropic.com/news/rss.xml'),
  ('github-trending-ai', 'github_trending', 'https://github.com/trending'),
  ('hn-algolia-ai', 'hn_algolia', 'https://hn.algolia.com/api/v1/search_by_date');
