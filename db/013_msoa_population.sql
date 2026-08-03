-- Run this in the Supabase SQL editor. Reference data for the crime-rate
-- feature (see CLAUDE.md's Crime rate feature idea) — ONS mid-year MSOA
-- population estimates, used to turn Police UK's raw per-MSOA incident
-- counts into a per-capita rate rather than a raw, population-size-biased
-- count.
--
-- Public UK government reference data, same pattern as postcodes/sold_prices
-- (see db/001_postcodes_and_sold_prices.sql): RLS enabled, but the only
-- policy is public SELECT — no insert/update/delete policy for anon/
-- authenticated roles, so writes are only possible via the service-role key
-- (scripts/ingest-msoa-population.js and nothing else).
--
-- Safe to re-run: `create table if not exists`, and the policy is dropped
-- and recreated each time, so re-running this script doesn't error on a
-- policy that already exists.

create table if not exists msoa_population (
  msoa_code text primary key,
  population integer not null
);

alter table msoa_population enable row level security;

drop policy if exists "msoa_population is publicly readable" on msoa_population;
create policy "msoa_population is publicly readable"
  on msoa_population for select
  to public
  using (true);
