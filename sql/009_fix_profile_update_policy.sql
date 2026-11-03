-- RavMizAI — close the self-grant hole on profiles
--
-- Run AFTER 001-008. Idempotent.
--
-- SECURITY FIX. Any signed-in member could grant themselves free access from
-- the browser console:
--
--   PATCH /rest/v1/profiles?id=eq.<their id>
--   { "is_member": true, "subscribed_until": "2030-01-01T00:00:00Z" }
--   -> 204, and is_subscribed() then returned true
--
-- Cause: two permissive UPDATE policies were in force at once.
--   * "profiles: update own"                      — any column
--   * "profiles: update own (non-billing fields)" — billing columns frozen
--
-- Postgres ORs permissive policies together, so a row passing EITHER is
-- allowed. The strict policy from 002 was therefore dead weight: the
-- permissive one from 001 always let the write through. 002 does drop the old
-- policy, but a later re-run of 001 recreated it, and from then on the hole
-- was open again.
--
-- Fix: drop every UPDATE policy on profiles, then create exactly one. Running
-- 001 again now re-adds the loose policy, so 009 must be the last migration
-- applied -- or better, treat 001's policy as superseded and do not re-run it.

-- ---------------------------------------------------------------------------
-- one UPDATE policy, not two
-- ---------------------------------------------------------------------------

drop policy if exists "profiles: update own"                      on public.profiles;
drop policy if exists "profiles: update own (non-billing fields)" on public.profiles;

-- Members may edit their own name and preferences. Billing columns are
-- server-side only: they are written by the Stripe webhook and the trial
-- functions, which run with the service role and bypass RLS entirely.
create policy "profiles: update own (non-billing fields)"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_member           is not distinct from (select p.is_member           from public.profiles p where p.id = auth.uid())
    and subscribed_at       is not distinct from (select p.subscribed_at       from public.profiles p where p.id = auth.uid())
    and subscribed_until    is not distinct from (select p.subscribed_until    from public.profiles p where p.id = auth.uid())
    and subscription_status is not distinct from (select p.subscription_status from public.profiles p where p.id = auth.uid())
    and stripe_customer_id  is not distinct from (select p.stripe_customer_id  from public.profiles p where p.id = auth.uid())
    and stripe_subscription_id is not distinct from (select p.stripe_subscription_id from public.profiles p where p.id = auth.uid())
    and card_brand          is not distinct from (select p.card_brand          from public.profiles p where p.id = auth.uid())
    and card_last4          is not distinct from (select p.card_last4          from public.profiles p where p.id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- repair anything already self-granted
-- ---------------------------------------------------------------------------
-- A membership written from the browser leaves no Stripe subscription behind,
-- so a profile claiming membership with no stripe_subscription_id and no
-- matching trial row was not paid for. Clear those.

update public.profiles p
   set is_member = false,
       subscription_status = case
         when p.subscription_status in ('trialing','active') then 'expired'
         else p.subscription_status
       end
 where p.is_member
   and p.stripe_subscription_id is null
   and not exists (
     select 1 from public.trials t
      where t.user_id = p.id and t.status = 'active' and t.ends_at > now()
   );
