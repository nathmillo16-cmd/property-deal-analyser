-- Run this in the Supabase SQL editor. Adds a role column to profiles,
-- backing the new superuser-only internal CRM (see db/022 onward).
--
-- Every existing user defaults to 'user' — nobody is superuser until you
-- manually flip your own row (and Nathan's) in Supabase, as planned.
--
-- The existing "select own profile" policy already lets a user read their
-- own role (needed so the app can show/hide the CRM nav link and redirect
-- non-superusers away from /admin/crm) — no change needed for that.
--
-- One NEW policy is added below: a superuser can also see every OTHER
-- profile row (name + role only matters in practice), needed for the CRM's
-- owner dropdown (Cameron/Nathan) and for showing owner/linked-user names
-- on a contact rather than a bare id.
--
-- Recursion note: this policy's own USING clause queries profiles again
-- (to check the CALLER's role), which sounds like it could recurse
-- forever, but it doesn't — Postgres ORs all permissive policies on a
-- table together, and the existing "select own profile" policy already,
-- non-recursively, grants the caller visibility of their OWN row inside
-- that inner subquery. So the subquery resolves in one step and the outer
-- check completes. This is the standard Supabase "admin can see all rows"
-- pattern, and the exact same shape already used by every crm_* table's
-- own RLS policies (db/022 onward) to check "is this caller a superuser".
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent; the check
-- constraint is added via a DO block since Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS; the policy is dropped and recreated.

alter table profiles add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table profiles add constraint profiles_role_check check (role in ('user', 'superuser'));
  end if;
end $$;

drop policy if exists "superuser select all profiles" on profiles;
create policy "superuser select all profiles" on profiles
  for select to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );
