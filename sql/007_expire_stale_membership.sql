-- RavMizAI — clear membership when the paid period has passed
--
-- Run AFTER 001-006. Idempotent.
--
-- Symptom this fixes: a member whose trial ended weeks ago still had
-- is_member = true and subscription_status = 'trialing' on their profile. The
-- access gate (is_subscribed) checks subscribed_until, so it correctly refused
-- them; create-checkout only compared the status string, so it told them
-- "Your membership is already active". The member could neither use the app
-- nor pay to fix it, and different screens disagreed about whether they were a
-- member at all.
--
-- Two causes, both addressed here:
--   1. expire_trials() from 003 never cleared subscription_status, so the
--      stale string survived even when it did run.
--   2. Nothing ever called it. Stripe's webhook is the normal path, but a
--      trial that lapses with no payment method produces no event we act on,
--      and any webhook missed while the project was paused is gone for good.
--      This adds a safety net that does not depend on a scheduler.

-- ---------------------------------------------------------------------------
-- expire_trials() — now also clears the status string
-- ---------------------------------------------------------------------------

create or replace function public.expire_trials()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  update public.trials t set status = 'expired'
   where t.status = 'active' and t.ends_at <= now();
  get diagnostics n = row_count;

  update public.profiles p
     set is_member = false,
         -- Leave a truthful status behind rather than a stale 'trialing'.
         subscription_status = case
           when p.subscription_status in ('trialing','active') then 'expired'
           else p.subscription_status
         end
   where p.is_member
     and p.subscribed_until is not null
     and p.subscribed_until <= now();

  return n;
end;
$fn$;

revoke execute on function public.expire_trials() from public;
revoke execute on function public.expire_trials() from anon, authenticated;
grant  execute on function public.expire_trials() to service_role;

-- ---------------------------------------------------------------------------
-- is_subscribed() — unchanged rule, stated once
-- ---------------------------------------------------------------------------
-- This is already the single definition of "may this user talk to RavMizAI".
-- Re-declared here only so that anything reading this file sees the rule the
-- rest of the system must agree with: member flag AND period not passed.

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

grant execute on function public.is_subscribed() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- one-off: clean up rows that already went stale
-- ---------------------------------------------------------------------------

update public.profiles p
   set is_member = false,
       subscription_status = case
         when p.subscription_status in ('trialing','active') then 'expired'
         else p.subscription_status
       end
 where p.is_member
   and p.subscribed_until is not null
   and p.subscribed_until <= now();

update public.trials t set status = 'expired'
 where t.status = 'active' and t.ends_at <= now();
