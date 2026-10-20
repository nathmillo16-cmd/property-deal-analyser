-- Run this in the Supabase SQL editor. Monthly portfolio snapshots for the
-- equity growth chart on Home. The server records at most one row per user
-- per calendar month (month = first day of that month), the first time that
-- month that the user's portfolio is loaded and they own at least one
-- property. Figures are the same server-computed totals the Portfolio page
-- shows, copied at that moment.
--
-- RLS: users can only read and insert their own rows. No update or delete
-- policy: a snapshot is a historical record.
--
-- Safe to re-run: IF NOT EXISTS, and each policy is dropped and recreated.

create table if not exists portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month date not null,
  portfolio_value numeric not null,
  total_equity numeric,
  monthly_cashflow numeric not null,
  property_count integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

alter table portfolio_snapshots enable row level security;

drop policy if exists "select own portfolio snapshots" on portfolio_snapshots;
create policy "select own portfolio snapshots" on portfolio_snapshots
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own portfolio snapshots" on portfolio_snapshots;
create policy "insert own portfolio snapshots" on portfolio_snapshots
  for insert to authenticated with check (auth.uid() = user_id);
