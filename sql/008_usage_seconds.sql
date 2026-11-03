-- RavMizAI — track voice usage to the second
--
-- Run AFTER 001-007. Idempotent.
--
-- Until now nothing debited the wallet at all: balances only ever went up from
-- a trial grant. This adds the write side, and moves voice from whole minutes
-- to seconds so a 40-second call is charged as 40 seconds rather than rounded
-- away or rounded up to a minute.
--
-- Minutes columns are kept and backfilled so nothing that still reads them
-- breaks; seconds are the source of truth from here on.

-- ---------------------------------------------------------------------------
-- seconds alongside the existing minutes
-- ---------------------------------------------------------------------------

alter table public.wallets
  add column if not exists seconds_balance integer not null default 0
    check (seconds_balance >= 0);

alter table public.wallet_ledger
  add column if not exists seconds integer not null default 0;

comment on column public.wallets.seconds_balance is
  'Voice balance in seconds. The source of truth; minutes_balance is derived.';
comment on column public.wallet_ledger.seconds is
  'Voice amount in seconds, always a magnitude. The sign comes from kind.';

-- Backfill from the minutes that already exist, once.
update public.wallets
   set seconds_balance = minutes_balance * 60
 where seconds_balance = 0 and minutes_balance > 0;

update public.wallet_ledger
   set seconds = minutes * 60
 where seconds = 0 and minutes > 0;

-- ---------------------------------------------------------------------------
-- record_usage() — the only way a balance is spent
-- ---------------------------------------------------------------------------
-- Called by the record-usage Edge Function with the service-role key, never
-- from the browser: a page that could debit its own wallet could also credit
-- it. Writes the ledger row and the new balance in one statement each, so a
-- balance never drifts from its history.
--
-- Clamps at zero rather than failing: a call that overruns the remaining
-- balance should still be recorded, not lost.

create or replace function public.record_usage(
  p_user_id     uuid,
  p_seconds     integer default 0,
  p_chats       integer default 0,
  p_description text    default 'Usage'
)
returns table (seconds_left integer, chats_left integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  secs  integer := greatest(coalesce(p_seconds, 0), 0);
  msgs  integer := greatest(coalesce(p_chats, 0), 0);
begin
  if p_user_id is null then
    raise exception 'record_usage: no user';
  end if;
  if secs = 0 and msgs = 0 then
    -- Nothing to charge; return the current balance unchanged.
    return query
      select w.seconds_balance, w.chats_balance
        from public.wallets w where w.user_id = p_user_id;
    return;
  end if;

  insert into public.wallet_ledger (user_id, kind, seconds, minutes, chats, description)
  values (p_user_id, 'debit', secs, secs / 60, msgs, p_description);

  update public.wallets w
     set seconds_balance = greatest(w.seconds_balance - secs, 0),
         minutes_balance = greatest(w.seconds_balance - secs, 0) / 60,
         chats_balance   = greatest(w.chats_balance - msgs, 0),
         updated_at      = now()
   where w.user_id = p_user_id;

  return query
    select w.seconds_balance, w.chats_balance
      from public.wallets w where w.user_id = p_user_id;
end;
$fn$;

comment on function public.record_usage(uuid,integer,integer,text) is
  'Debits a wallet and writes the matching ledger row. Service-role only.';

-- Postgres grants EXECUTE to PUBLIC on every new function, so PUBLIC must be
-- revoked first or anon/authenticated inherit it.
revoke execute on function public.record_usage(uuid,integer,integer,text) from public;
revoke execute on function public.record_usage(uuid,integer,integer,text) from anon, authenticated;
grant  execute on function public.record_usage(uuid,integer,integer,text) to service_role;

-- ---------------------------------------------------------------------------
-- grant_credit() — the matching credit side
-- ---------------------------------------------------------------------------
-- Used by trial activation and by the Stripe webhook on renewal, so grants go
-- through the same path as debits and always leave a ledger row behind.

create or replace function public.grant_credit(
  p_user_id     uuid,
  p_seconds     integer default 0,
  p_chats       integer default 0,
  p_description text    default 'Credit'
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  secs integer := greatest(coalesce(p_seconds, 0), 0);
  msgs integer := greatest(coalesce(p_chats, 0), 0);
begin
  if p_user_id is null or (secs = 0 and msgs = 0) then return; end if;

  insert into public.wallet_ledger (user_id, kind, seconds, minutes, chats, description)
  values (p_user_id, 'grant', secs, secs / 60, msgs, p_description);

  update public.wallets w
     set seconds_balance = w.seconds_balance + secs,
         minutes_balance = (w.seconds_balance + secs) / 60,
         chats_balance   = w.chats_balance + msgs,
         updated_at      = now()
   where w.user_id = p_user_id;
end;
$fn$;

revoke execute on function public.grant_credit(uuid,integer,integer,text) from public;
revoke execute on function public.grant_credit(uuid,integer,integer,text) from anon, authenticated;
grant  execute on function public.grant_credit(uuid,integer,integer,text) to service_role;
