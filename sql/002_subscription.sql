-- RavMizAI — subscription gating (interim, pre-Stripe)
--
-- Run AFTER 001_schema.sql.
--
-- `profiles.is_member` already exists from 001. This file adds what is needed
-- to use it as the access gate for Call / Text, plus a manual way to mark an
-- account Subscribed / Unsubscribed while there is no payment processor.
--
-- When Stripe is added, the webhook writes the same column with the
-- service-role key and `subscribed_until` starts carrying the period end. The
-- front end does not change.

-- ---------------------------------------------------------------------------
-- extra subscription columns on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists subscribed_at    timestamptz,
  add column if not exists subscribed_until timestamptz,
  add column if not exists subscription_note text;

comment on column public.profiles.subscribed_until is
  'NULL = no expiry (manual/comped). Stripe will set the period end here.';
comment on column public.profiles.subscription_note is
  'Why this account was marked, e.g. "manual grant — pre-Stripe".';

-- ---------------------------------------------------------------------------
-- is_subscribed() — the single definition of "may this user talk to RavMizAI"
-- ---------------------------------------------------------------------------
-- Both the app and any future server code ask this one function, so the rule
-- lives in exactly one place.

-- Takes no argument on purpose. An earlier version accepted a uid, but since
-- this is SECURITY DEFINER (it must bypass RLS to read the row) that would let
-- any signed-in user ask about anybody else's membership. It now answers only
-- for the caller.
drop function if exists public.is_subscribed(uuid);

create or replace function public.is_subscribed()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (
      select p.is_member
         and (p.subscribed_until is null or p.subscribed_until > now())
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$fn$;

comment on function public.is_subscribed() is
  'True when the user holds an unexpired membership. Used to gate Call/Text.';

grant execute on function public.is_subscribed() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- keep clients from granting themselves a membership
-- ---------------------------------------------------------------------------
-- 001 gave users "update own profile", which is right for name/call_me but
-- would also let a browser flip its own is_member to true. This replaces that
-- policy with one that allows the edit only when the subscription columns are
-- unchanged. Entitlements stay server-side (service-role key / Stripe webhook).

create or replace function public.subscription_unchanged()
returns boolean
language sql
stable
as $fn$
  select true;  -- placeholder; real check is in the policy below
$fn$;

drop policy if exists "profiles: update own" on public.profiles;
drop policy if exists "profiles: update own (non-billing fields)" on public.profiles;
create policy "profiles: update own (non-billing fields)"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- the row as submitted must keep whatever the stored row already has
    and is_member       is not distinct from (select p.is_member       from public.profiles p where p.id = auth.uid())
    and subscribed_at   is not distinct from (select p.subscribed_at   from public.profiles p where p.id = auth.uid())
    and subscribed_until is not distinct from (select p.subscribed_until from public.profiles p where p.id = auth.uid())
  );

drop function if exists public.subscription_unchanged();

-- ---------------------------------------------------------------------------
-- MANUAL CONTROL — run these in the SQL editor while there is no Stripe
-- ---------------------------------------------------------------------------
-- The SQL editor runs as a superuser, so it bypasses the policy above.

-- Mark an account SUBSCRIBED:
--
--   update public.profiles
--      set is_member = true,
--          subscribed_at = now(),
--          subscribed_until = null,          -- or now() + interval '30 days'
--          subscription_note = 'manual grant — pre-Stripe'
--    where id = (select id from auth.users where email = 'person@example.com');

-- Mark an account UNSUBSCRIBED:
--
--   update public.profiles
--      set is_member = false,
--          subscribed_until = null,
--          subscription_note = 'manually revoked'
--    where id = (select id from auth.users where email = 'person@example.com');

-- See who is subscribed:
--
--   select u.email, p.is_member, p.subscribed_at, p.subscribed_until, p.subscription_note
--     from public.profiles p
--     join auth.users u on u.id = p.id
--    order by p.created_at desc;

-- ---------------------------------------------------------------------------
-- convenience helpers for the two commands above
-- ---------------------------------------------------------------------------
-- Same updates, by email, so day-to-day use is one short call:
--
--   select public.set_subscription('person@example.com', true);
--   select public.set_subscription('person@example.com', false);
--
-- Callable only by the service role / SQL editor, never from the browser.

create or replace function public.set_subscription(
  user_email text,
  subscribed  boolean,
  until       timestamptz default null,
  note        text default 'manual — pre-Stripe'
)
returns table (email text, is_member boolean, subscribed_until timestamptz)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid;
begin
  select id into uid from auth.users u where lower(u.email) = lower(user_email);
  if uid is null then
    raise exception 'No user with email %', user_email;
  end if;

  update public.profiles p
     set is_member        = subscribed,
         subscribed_at    = case when subscribed then coalesce(p.subscribed_at, now()) else p.subscribed_at end,
         subscribed_until = case when subscribed then until else null end,
         subscription_note = note
   where p.id = uid;

  return query
    select u.email::text, p.is_member, p.subscribed_until
      from public.profiles p join auth.users u on u.id = p.id
     where p.id = uid;
end;
$fn$;

-- Lock this down. Postgres grants EXECUTE to PUBLIC on every new function, so
-- revoking from anon/authenticated alone is not enough — they would still
-- inherit it through PUBLIC. Revoke from PUBLIC first, then grant it back to
-- nobody but the service role.
revoke execute on function public.set_subscription(text, boolean, timestamptz, text) from public;
revoke execute on function public.set_subscription(text, boolean, timestamptz, text) from anon, authenticated;
grant  execute on function public.set_subscription(text, boolean, timestamptz, text) to service_role;
