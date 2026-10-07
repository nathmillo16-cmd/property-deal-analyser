-- Run this in the Supabase SQL editor. Backs the "Join the waitlist" form on
-- the Deal Sourcing coming-soon page (deal-sourcing-apply.html, served at
-- /deal-sourcing/apply) and POST /api/sourcing-waitlist in server.js.
--
-- Replaces the old application form for now. sourcing_applications and all
-- of its existing rows are deliberately left untouched by this migration.
--
-- Public page, no login, so RLS allows anonymous INSERT only. There is no
-- select/update/delete policy for anon OR authenticated users, so nobody can
-- read the list back through the API (the team views it in the Supabase
-- dashboard, which uses the service role). server.js inserts with a plain
-- anon-key client and does NOT ask for the inserted row back, since that
-- would need a select policy.
--
-- Emails are lowercased by server.js before insert, and the check
-- constraint below makes sure nothing else can store a mixed-case duplicate
-- that the unique constraint would miss.
--
-- Safe to re-run: table uses `if not exists`, policy is dropped and recreated.

create table if not exists sourcing_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) <= 320),
  created_at timestamptz not null default now()
);

alter table sourcing_waitlist enable row level security;

drop policy if exists "anon can join sourcing waitlist" on sourcing_waitlist;
create policy "anon can join sourcing waitlist" on sourcing_waitlist
  for insert to anon with check (true);
