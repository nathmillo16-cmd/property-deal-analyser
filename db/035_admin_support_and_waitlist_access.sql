-- Run this in the Supabase SQL editor, AFTER db/033 and db/034. Gives
-- superusers (and only superusers) access to the new support_requests and
-- sourcing_waitlist data for the admin area (admin/support.html, and the
-- Waitlist section on admin/tier3.html).
--
-- Same pattern as every other admin table: additive "superuser" policies
-- that call public.is_superuser() (db/028, SECURITY DEFINER, recursion-safe),
-- used by server.js's /api/admin/* routes through the admin's own RLS-scoped
-- client after requireSuperuser() has already checked the role server-side.
-- Postgres ORs permissive policies together, so these only ever ADD access
-- for a superuser. Nothing here touches or loosens the existing normal-user
-- policies from db/033/db/034: a normal user can still only insert/read
-- their own support requests, still cannot update any, and still cannot
-- read the waitlist at all.
--
-- Safe to re-run: every policy is dropped and recreated, and the status
-- constraint is dropped and re-added.

-- ---------- support_requests ----------
-- Pin status to the three values the admin dropdown offers. Every existing
-- row is 'new' (the only value db/033 lets a user insert), so this can't
-- fail on current data.
alter table support_requests drop constraint if exists support_requests_status_check;
alter table support_requests add constraint support_requests_status_check
  check (status in ('new', 'in_progress', 'resolved'));

drop policy if exists "superuser select support_requests" on support_requests;
create policy "superuser select support_requests" on support_requests
  for select to authenticated using ( public.is_superuser() );

drop policy if exists "superuser update support_requests" on support_requests;
create policy "superuser update support_requests" on support_requests
  for update to authenticated using ( public.is_superuser() ) with check ( public.is_superuser() );

-- ---------- support screenshots (storage) ----------
-- Read-only, needed to create a short-lived signed URL for any user's
-- screenshot. No superuser insert/update/delete on the bucket.
drop policy if exists "support screenshots superuser select" on storage.objects;
create policy "support screenshots superuser select" on storage.objects
  for select to authenticated
  using ( bucket_id = 'support-screenshots' and public.is_superuser() );

-- ---------- sourcing_waitlist ----------
-- Read-only for now, per spec: no superuser update/delete.
drop policy if exists "superuser select sourcing_waitlist" on sourcing_waitlist;
create policy "superuser select sourcing_waitlist" on sourcing_waitlist
  for select to authenticated using ( public.is_superuser() );
