-- RavMizAI — Stripe integration
--
-- Run AFTER 003_trial_activation.sql.
--
-- Plan: RavMizAI Monthly Membership — 7-day free trial, then $18/month.
--
-- Stripe becomes the source of truth for membership. The webhook writes
-- is_member / subscribed_until with the service-role key; the browser still
-- cannot write them (the RLS policy from 002 blocks that).

-- ---------------------------------------------------------------------------
-- Stripe identifiers on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status    text;

comment on column public.profiles.stripe_customer_id is
  'Stripe customer. One per user, reused across checkouts so cards and history stay together.';
comment on column public.profiles.subscription_status is
  'Mirrors Stripe: trialing, active, past_due, canceled, incomplete, unpaid.';

-- A Stripe customer maps to exactly one user.
create unique index if not exists profiles_stripe_customer_idx
  on public.profiles(stripe_customer_id) where stripe_customer_id is not null;

create index if not exists profiles_stripe_subscription_idx
  on public.profiles(stripe_subscription_id) where stripe_subscription_id is not null;

-- ---------------------------------------------------------------------------
-- stripe_events — webhook idempotency
-- ---------------------------------------------------------------------------
-- Stripe retries webhooks and can deliver the same event more than once.
-- Inserting the event id first means a duplicate delivery is a no-op rather
-- than a second grant of access.

create table if not exists public.stripe_events (
  id           text        primary key,          -- Stripe event id (evt_...)
  type         text        not null,
  received_at  timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies: the browser has no business reading webhook history. The
-- service role bypasses RLS.

-- ---------------------------------------------------------------------------
-- apply_stripe_subscription() — the one place membership is written
-- ---------------------------------------------------------------------------
-- Called by the stripe-webhook Edge Function. Takes the subscription state as
-- Stripe reports it and mirrors it onto the profile.
--
-- `trialing` and `active` both grant access; everything else revokes it. A
-- past_due subscription loses access immediately, which is the conservative
-- choice -- adjust if you would rather allow a grace period.

-- The OUT column names changed, which create-or-replace cannot do.
drop function if exists public.apply_stripe_subscription(text,text,text,timestamptz,uuid);

create or replace function public.apply_stripe_subscription(
  p_customer_id     text,
  p_subscription_id text,
  p_status          text,
  p_period_end      timestamptz,
  p_user_id         uuid default null
)
-- The OUT column names are prefixed. Naming them `user_id` / `is_member` would
-- make those identifiers ambiguous inside the body wherever a table has a
-- column of the same name -- which silently broke the cancel path, because the
-- `update trials ... where user_id = uid` raised 42702 and the whole call
-- aborted, leaving a cancelled member with access.
returns table (out_user_id uuid, out_is_member boolean)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid;
  grants boolean := p_status in ('trialing','active');
begin
  -- Prefer the explicit user id (present on the first checkout), otherwise
  -- look the user up by the Stripe customer they already own.
  uid := p_user_id;
  if uid is null then
    select p.id into uid from public.profiles p
     where p.stripe_customer_id = p_customer_id;
  end if;

  if uid is null then
    raise exception 'No profile for Stripe customer %', p_customer_id;
  end if;

  update public.profiles p
     set stripe_customer_id     = coalesce(p_customer_id, p.stripe_customer_id),
         stripe_subscription_id = p_subscription_id,
         subscription_status    = p_status,
         is_member              = grants,
         subscribed_at          = case when grants then coalesce(p.subscribed_at, now()) else p.subscribed_at end,
         subscribed_until       = case when grants then p_period_end else null end,
         subscription_note      = 'stripe: ' || p_status
   where p.id = uid;

  -- Keep the trials table in step so the funnel stays readable.
  if p_status = 'trialing' then
    insert into public.trials as t (user_id, status, started_at, ends_at)
    values (uid, 'active', now(), coalesce(p_period_end, now() + interval '7 days'))
    on conflict do nothing;
  elsif p_status = 'active' then
    update public.trials t set status = 'converted'
     where t.user_id = uid and t.status = 'active';
  elsif p_status in ('canceled','unpaid','incomplete_expired') then
    update public.trials t set status = 'canceled'
     where t.user_id = uid and t.status = 'active';
  end if;

  return query select uid, grants;
end;
$fn$;

comment on function public.apply_stripe_subscription(text,text,text,timestamptz,uuid) is
  'Mirrors a Stripe subscription onto the profile. Service-role only; called by the stripe-webhook function.';

-- Postgres grants EXECUTE to PUBLIC on every new function, so PUBLIC must be
-- revoked first or anon/authenticated inherit it.
revoke execute on function public.apply_stripe_subscription(text,text,text,timestamptz,uuid) from public;
revoke execute on function public.apply_stripe_subscription(text,text,text,timestamptz,uuid) from anon, authenticated;
grant  execute on function public.apply_stripe_subscription(text,text,text,timestamptz,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- link_stripe_customer() — remember the customer before checkout completes
-- ---------------------------------------------------------------------------

create or replace function public.link_stripe_customer(p_user_id uuid, p_customer_id text)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.profiles set stripe_customer_id = p_customer_id
   where id = p_user_id and stripe_customer_id is distinct from p_customer_id;
$fn$;

revoke execute on function public.link_stripe_customer(uuid,text) from public;
revoke execute on function public.link_stripe_customer(uuid,text) from anon, authenticated;
grant  execute on function public.link_stripe_customer(uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- Note on start_trial()
-- ---------------------------------------------------------------------------
-- 003's start_trial() granted a trial with no payment method, which existed
-- only because there was no processor. Stripe now runs the trial, so that path
-- must not stay reachable -- otherwise anyone could skip checkout entirely.
-- The activate-trial Edge Function is removed as part of this change; this
-- revoke makes the database refuse it even if an old copy is still deployed.

revoke execute on function public.start_trial(uuid) from service_role;
