-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Backs the Portfolio tab (owned-property tracking) in index.html and the
-- /api/portfolio endpoints in server.js.
--
-- Unlike postcodes/sold_prices/epc_floor_area_cache (public reference data,
-- see 001/004), this IS personal data — same pattern as the existing `deals`
-- table: one row per property, owned by whoever added it, RLS-scoped to
-- auth.uid(). user_id defaults to auth.uid() so server.js can insert
-- without setting it explicitly, exactly like `deals` already does.
--
-- Safe to re-run: table/column/index all use `if not exists`, and each
-- policy is dropped and recreated so re-running this script doesn't error
-- on policies that already exist (plain `create policy` has no `if not
-- exists` form in Postgres).

create table if not exists portfolio_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  address text not null,
  price_paid numeric not null,
  property_type text not null check (property_type in ('BTL','HMO','SA','Flip')),
  monthly_rent numeric not null,
  monthly_running_costs numeric not null,
  monthly_mortgage numeric,
  created_at timestamptz not null default now()
);

alter table portfolio_properties enable row level security;

drop policy if exists "select own portfolio properties" on portfolio_properties;
create policy "select own portfolio properties" on portfolio_properties
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own portfolio properties" on portfolio_properties;
create policy "insert own portfolio properties" on portfolio_properties
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "delete own portfolio properties" on portfolio_properties;
create policy "delete own portfolio properties" on portfolio_properties
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_portfolio_properties_user_id on portfolio_properties (user_id);
