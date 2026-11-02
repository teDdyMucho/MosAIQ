-- RavMizAI — profile names for Google (OAuth) sign-ups
-- Run in the Supabase SQL editor after 001–005. Idempotent (create or replace).
--
-- handle_new_user() read only first_name / last_name, which the email signup
-- form sends in options.data. Google sends given_name / family_name, or only
-- full_name / name, so a Google member's profile was saved as "Member".
-- Fall back through those.
--
-- Both names are also capped at the 80 characters the profiles check
-- constraint allows. Without the cap, an over-long name fails the insert, and
-- because this runs inside the auth.users insert, the whole sign-up fails with
-- "Database error saving new user".

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_n text  := trim(coalesce(meta->>'full_name', meta->>'name', ''));
  first_ text;
  last_  text;
begin
  first_ := coalesce(
    nullif(trim(meta->>'first_name'), ''),
    nullif(trim(meta->>'given_name'), ''),
    nullif(split_part(full_n, ' ', 1), ''),
    'Member');

  last_ := coalesce(
    nullif(trim(meta->>'last_name'), ''),
    nullif(trim(meta->>'family_name'), ''),
    nullif(trim(substr(full_n, length(split_part(full_n, ' ', 1)) + 1)), ''),
    '');

  insert into public.profiles (id, first_name, last_name)
  values (new.id, trim(left(first_, 80)), trim(left(last_, 80)))
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$fn$;

-- The trigger itself (on_auth_user_created, from 001) is unchanged: it calls
-- this function by name, so replacing the body is enough.
