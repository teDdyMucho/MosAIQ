-- RavMizAI — card summary on the billing page
--
-- Run AFTER 004_stripe.sql.
--
-- The billing page shipped with a hardcoded "Card ending in 4242". These
-- columns hold the real values, written by the stripe-webhook function from
-- what Stripe reports.
--
-- Only the brand and last four digits are stored -- never a card number, an
-- expiry or a CVC. Those stay with Stripe.

alter table public.profiles
  add column if not exists card_brand text,
  add column if not exists card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');

comment on column public.profiles.card_last4 is
  'Last four digits only, for display. Never store a full card number.';

-- ---------------------------------------------------------------------------
-- set_card_summary() — called by the webhook
-- ---------------------------------------------------------------------------

create or replace function public.set_card_summary(
  p_customer_id text,
  p_brand       text,
  p_last4       text
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.profiles
     set card_brand = p_brand,
         card_last4 = p_last4
   where stripe_customer_id = p_customer_id;
$fn$;

revoke execute on function public.set_card_summary(text,text,text) from public;
revoke execute on function public.set_card_summary(text,text,text) from anon, authenticated;
grant  execute on function public.set_card_summary(text,text,text) to service_role;
