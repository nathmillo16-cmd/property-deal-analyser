-- Run this in the Supabase SQL editor. In-house tracking, no third parties.
-- Backs server.js's "In-house tracking" block (POST /api/client-errors,
-- POST /api/events, GET /api/admin/tracking) and track.js.
--
-- Additive only: two new tables, nothing existing is changed.
--
-- Writes come from server.js with the service-role client, which bypasses
-- RLS, so there are NO insert/update/delete policies for anyone here. A
-- browser can't write to these tables directly, only through the server's
-- rate-limited endpoints. The only policy is SELECT for superusers
-- (is_superuser(), db/028), which is what the Admin > Tracking page reads with.
--
-- No personal data beyond the user id: no email, no IP address, no browser
-- string. Page addresses are paths only (no query strings).
--
-- Deleting an account: feature_events rows go with the user (on delete
-- cascade); error_log rows stay but lose the user id (on delete set null).
--
-- Safe to re-run: tables and indexes use `if not exists`, policies are
-- dropped and recreated.

create table if not exists public.error_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null check (source in ('server', 'browser')),
  user_id uuid references auth.users(id) on delete set null,
  status int,                                        -- HTTP status (server errors only)
  route text check (length(route) <= 300),           -- server: "POST /api/deals/:id"; browser: script path and line
  page text check (length(page) <= 300),             -- browser: page path, e.g. /index.html
  message text not null check (length(message) <= 1000),
  stack text check (length(stack) <= 4000)
);

create index if not exists error_log_created_at_idx on public.error_log (created_at desc);

create table if not exists public.feature_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,  -- null for logged-out use of the free calculators
  event text not null check (event ~ '^[a-z0-9_:]{1,64}$'),
  created_at timestamptz not null default now()
);

create index if not exists feature_events_created_at_idx on public.feature_events (created_at desc);
create index if not exists feature_events_event_created_at_idx on public.feature_events (event, created_at desc);

alter table public.error_log enable row level security;
alter table public.feature_events enable row level security;

drop policy if exists "superusers read error_log" on public.error_log;
create policy "superusers read error_log" on public.error_log
  for select to authenticated using ( public.is_superuser() );

drop policy if exists "superusers read feature_events" on public.feature_events;
create policy "superusers read feature_events" on public.feature_events
  for select to authenticated using ( public.is_superuser() );
