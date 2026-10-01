-- RavMizAI — trial activation (interim, pre-Stripe)
--
-- Run AFTER 002_subscription.sql.
--
-- Grants a 3-day trial. Called ONLY by the activate-trial Edge Function, which
-- holds the service-role key. The browser cannot call this directly -- the
-- grant at the bottom is to service_role alone.
--
-- When Stripe arrives, the webhook calls set_subscription() with the real
-- period end and this function can be dropped.

create or replace function public.start_trial(target_user uuid)
returns table (
  ok          boolean,
  reason      text,
  trial_ends  timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  existing   public.trials%rowtype;
  ends       timestamptz := now() + interval '3 days';
begin
  if target_user is null then
    return query select false, 'no user', null::timestamptz; return;
  end if;

  -- One trial per account, ever. Without this a user could cancel and restart
  -- the free trial indefinitely.
  select * into existing
    from public.trials t
   where t.user_id = target_user
   order by t.created_at desc
   limit 1;

  if found then
    return query select false, 'trial already used', existing.ends_at; return;
  end if;

  -- Already paying? Nothing to do; do not shorten a real membership.
  if exists (
    select 1 from public.profiles p
     where p.id = target_user
       and p.is_member
       and (p.subscribed_until is null or p.subscribed_until > now())
  ) then
    return query select false, 'already a member', null::timestamptz; return;
  end if;

  insert into public.trials (user_id, status, started_at, ends_at)
  values (target_user, 'active', now(), ends);

  update public.profiles p
     set is_member         = true,
         subscribed_at     = now(),
         subscribed_until  = ends,
         subscription_note = '3-day trial (pre-Stripe)'
   where p.id = target_user;

  -- Starting wallet balance for the trial.
  insert into public.wallet_ledger (user_id, kind, minutes, chats, description)
  values (target_user, 'grant', 60, 120, '3-day free trial');

  update public.wallets w
     set minutes_balance = w.minutes_balance + 60,
         chats_balance   = w.chats_balance + 120
   where w.user_id = target_user;

  return query select true, 'activated'::text, ends;
end;
$fn$;

comment on function public.start_trial(uuid) is
  'Grants a one-time 3-day trial. Service-role only; called by the activate-trial Edge Function.';

-- Lock it to the service role. Postgres grants EXECUTE to PUBLIC by default,
-- so PUBLIC must be revoked first or anon/authenticated inherit it.
revoke execute on function public.start_trial(uuid) from public;
revoke execute on function public.start_trial(uuid) from anon, authenticated;
grant  execute on function public.start_trial(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- expire trials whose window has passed
-- ---------------------------------------------------------------------------
-- is_subscribed() already treats a past subscribed_until as not subscribed, so
-- access ends on time without this. This just keeps the trials table tidy; run
-- it from a scheduled job if you want accurate reporting.

create or replace function public.expire_trials()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  update public.trials set status = 'expired'
   where status = 'active' and ends_at <= now();
  get diagnostics n = row_count;

  update public.profiles p
     set is_member = false
   where p.is_member
     and p.subscribed_until is not null
     and p.subscribed_until <= now();

  return n;
end;
$fn$;

revoke execute on function public.expire_trials() from public;
revoke execute on function public.expire_trials() from anon, authenticated;
grant  execute on function public.expire_trials() to service_role;
