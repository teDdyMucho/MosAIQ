-- RavMizAI — Supabase / Postgres schema
-- Run in the Supabase SQL editor, or: psql "$DATABASE_URL" -f sql/001_schema.sql
--
-- Scope: the login / signup / verify flow.
--
-- IMPORTANT: Supabase Auth owns the credential tables. Email, password hash,
-- email-confirmation state and sessions all live in the `auth` schema and are
-- managed for you. Do NOT create a users table with a password column here --
-- that would duplicate auth.users and leave you with two sources of truth.
--
-- What this file adds is the *application* data that hangs off an auth user:
-- profile fields, trial state and wallet balances.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users
-- ---------------------------------------------------------------------------
-- Holds the first/last name the signup form collects. Keyed by the auth user's
-- id so the row disappears with its user (on delete cascade).

create table if not exists public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  first_name  text        not null check (length(trim(first_name)) between 1 and 80),
  last_name   text        not null check (length(trim(last_name)) <= 80),
  call_me     text,                 -- preferred form of address (preferences page)
  is_member   boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.profiles is 'Application profile, one row per auth.users row.';
comment on column public.profiles.is_member is 'True once a paid/trial subscription is active.';

-- ---------------------------------------------------------------------------
-- trials — 3-day free trial
-- ---------------------------------------------------------------------------
-- One *active* trial per user is enforced by the partial unique index below.
-- Expired/converted rows are kept so the funnel stays auditable.

create table if not exists public.trials (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  status      text        not null default 'active'
                          check (status in ('active','converted','expired','canceled')),
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint trials_window_valid check (ends_at > started_at)
);

create index if not exists trials_user_idx on public.trials(user_id);

-- A user may hold at most one active trial at a time.
create unique index if not exists trials_one_active_per_user
  on public.trials(user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- wallets — metered voice minutes / chat messages
-- ---------------------------------------------------------------------------

create table if not exists public.wallets (
  user_id          uuid        primary key references auth.users(id) on delete cascade,
  minutes_balance  integer     not null default 0 check (minutes_balance >= 0),
  chats_balance    integer     not null default 0 check (chats_balance   >= 0),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- wallet_ledger — append-only record behind every balance change
-- ---------------------------------------------------------------------------
-- Balances are derived state; this is the audit trail. Never UPDATE these rows.

create table if not exists public.wallet_ledger (
  id          bigserial   primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  kind        text        not null check (kind in ('grant','debit','refund','adjustment')),
  minutes     integer     not null default 0,
  chats       integer     not null default 0,
  description text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists wallet_ledger_user_idx
  on public.wallet_ledger(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists wallets_touch on public.wallets;
create trigger wallets_touch before update on public.wallets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- provision a profile + wallet whenever an auth user is created
-- ---------------------------------------------------------------------------
-- signUp() passes first/last through `options.data`, which lands in
-- raw_user_meta_data. SECURITY DEFINER is required: the trigger runs in the
-- auth context, which has no rights on public tables by default.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'first_name'), ''), 'Member'),
    coalesce(nullif(trim(new.raw_user_meta_data->>'last_name'),  ''), '')
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Each table is deny-by-default once RLS is enabled; the policies below grant a
-- user access to their own row and nothing else. WITHOUT THESE, the anon key
-- shipped in the browser would expose every row to everyone.

alter table public.profiles      enable row level security;
alter table public.trials        enable row level security;
alter table public.wallets       enable row level security;
alter table public.wallet_ledger enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Note: no INSERT policy on profiles. Rows are created only by the
-- handle_new_user trigger, so a client can never forge one.

drop policy if exists "trials: read own" on public.trials;
create policy "trials: read own" on public.trials
  for select using (auth.uid() = user_id);

drop policy if exists "wallets: read own" on public.wallets;
create policy "wallets: read own" on public.wallets
  for select using (auth.uid() = user_id);

drop policy if exists "ledger: read own" on public.wallet_ledger;
create policy "ledger: read own" on public.wallet_ledger
  for select using (auth.uid() = user_id);

-- Deliberately no client-side INSERT/UPDATE on trials, wallets or the ledger.
-- Money and entitlements are written server-side only (service-role key, from
-- the Stripe webhook / usage metering), never from the browser.
