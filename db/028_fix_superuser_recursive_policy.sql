-- Run this in the Supabase SQL editor. Fixes a real bug in every
-- "superuser can see/write everything" RLS policy added by db/021 through
-- db/026: each one's USING/WITH CHECK clause runs
--   exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
-- directly against profiles. db/021's own comment claimed this was safe
-- because Postgres ORs permissive policies together and the existing
-- "select own profile" policy would let the subquery resolve first. That
-- reasoning was wrong: confirmed live against the real database, a
-- superuser hitting GET /api/profile got back
--   {"code":"42P17","message":"infinite recursion detected in policy for
--   relation \"profiles\""}
-- Any policy on profiles that queries profiles again inside its own USING
-- clause makes Postgres re-evaluate that same policy for the subquery's
-- rows, which queries profiles again, forever — regardless of what any
-- OTHER policy on the table would separately allow. Every crm_* table's
-- policies (db/022-026) reference profiles the same way, so they were all
-- failing too, as a direct downstream effect of profiles' own broken
-- policy, not a separate bug of their own.
--
-- Fix: a SECURITY DEFINER helper function. Run with the privileges of its
-- owner (postgres, when created via the Supabase SQL editor) rather than
-- the calling user, a SECURITY DEFINER function's own internal queries
-- bypass RLS entirely — so is_superuser()'s lookup against profiles never
-- triggers profiles' RLS policies again, and the recursion never starts.
-- This is Postgres/Supabase's standard documented pattern for "is the
-- caller an admin" checks; not something invented here.
--
-- Every policy below is dropped and recreated identically to its original
-- (same name, same table, same for/to clause) with only the USING/WITH
-- CHECK body swapped from the raw subquery to is_superuser() — so this is
-- a pure bugfix, no access-rule changes. Safe to re-run: create-or-replace
-- and drop-then-create are both idempotent, same convention as every other
-- migration in this repo.

create or replace function public.is_superuser()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where user_id = auth.uid() and role = 'superuser'
  );
$$;

grant execute on function public.is_superuser() to authenticated;

-- profiles (db/021)
drop policy if exists "superuser select all profiles" on profiles;
create policy "superuser select all profiles" on profiles
  for select to authenticated using ( public.is_superuser() );

-- crm_contacts (db/022)
drop policy if exists "superuser select crm_contacts" on crm_contacts;
create policy "superuser select crm_contacts" on crm_contacts
  for select to authenticated using ( public.is_superuser() );

drop policy if exists "superuser insert crm_contacts" on crm_contacts;
create policy "superuser insert crm_contacts" on crm_contacts
  for insert to authenticated with check ( public.is_superuser() );

drop policy if exists "superuser update crm_contacts" on crm_contacts;
create policy "superuser update crm_contacts" on crm_contacts
  for update to authenticated
  using ( public.is_superuser() )
  with check ( public.is_superuser() );

-- crm_activity_log (db/023)
drop policy if exists "superuser select crm_activity_log" on crm_activity_log;
create policy "superuser select crm_activity_log" on crm_activity_log
  for select to authenticated using ( public.is_superuser() );

drop policy if exists "superuser insert crm_activity_log" on crm_activity_log;
create policy "superuser insert crm_activity_log" on crm_activity_log
  for insert to authenticated with check ( public.is_superuser() );

-- crm_tasks (db/024)
drop policy if exists "superuser select crm_tasks" on crm_tasks;
create policy "superuser select crm_tasks" on crm_tasks
  for select to authenticated using ( public.is_superuser() );

drop policy if exists "superuser insert crm_tasks" on crm_tasks;
create policy "superuser insert crm_tasks" on crm_tasks
  for insert to authenticated with check ( public.is_superuser() );

drop policy if exists "superuser update crm_tasks" on crm_tasks;
create policy "superuser update crm_tasks" on crm_tasks
  for update to authenticated
  using ( public.is_superuser() )
  with check ( public.is_superuser() );

-- crm_deal_reviews (db/025)
drop policy if exists "superuser select crm_deal_reviews" on crm_deal_reviews;
create policy "superuser select crm_deal_reviews" on crm_deal_reviews
  for select to authenticated using ( public.is_superuser() );

drop policy if exists "superuser insert crm_deal_reviews" on crm_deal_reviews;
create policy "superuser insert crm_deal_reviews" on crm_deal_reviews
  for insert to authenticated with check ( public.is_superuser() );

-- crm_partner_referrals (db/026)
drop policy if exists "superuser select crm_partner_referrals" on crm_partner_referrals;
create policy "superuser select crm_partner_referrals" on crm_partner_referrals
  for select to authenticated using ( public.is_superuser() );

drop policy if exists "superuser insert crm_partner_referrals" on crm_partner_referrals;
create policy "superuser insert crm_partner_referrals" on crm_partner_referrals
  for insert to authenticated with check ( public.is_superuser() );
