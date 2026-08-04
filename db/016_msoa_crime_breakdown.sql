-- Run this in the Supabase SQL editor. Crime Stage 4 — crime-type breakdown
-- per MSOA, alongside the existing overall rate (db/014_msoa_crime_rate.sql).
-- Same shape/purpose: computed locally by scripts/compute-crime-benchmark.js
-- from the same Police UK bulk archive pass that already produces
-- msoa_crime_rate, then only this small per-MSOA summary is written here.
-- No individual crime record is stored anywhere.
--
-- 6 grouped counts (see scripts/compute-crime-benchmark.js's
-- CRIME_TYPE_GROUPS for the exact "Crime type" -> group mapping, confirmed
-- against the real archive) plus total, which should always equal the sum
-- of the 6 and match msoa_crime_rate.crime_count for the same msoa_code —
-- both come from the same single pass over the CSVs, not two separate
-- recomputations that could drift apart.
--
-- Public UK-derived reference data, same pattern as msoa_population/
-- msoa_crime_rate: RLS enabled, only a public SELECT policy — writes only
-- via the service-role key (scripts/compute-crime-benchmark.js and nothing
-- else).
--
-- Safe to re-run: `if not exists`, and the policy is dropped and recreated
-- each time.

create table if not exists msoa_crime_breakdown (
  msoa_code text primary key references msoa_population(msoa_code),
  violence integer not null,
  asb integer not null,
  shoplifting integer not null,
  burglary integer not null,
  vehicle integer not null,
  other integer not null,
  total integer not null
);

alter table msoa_crime_breakdown enable row level security;

drop policy if exists "msoa_crime_breakdown is publicly readable" on msoa_crime_breakdown;
create policy "msoa_crime_breakdown is publicly readable"
  on msoa_crime_breakdown for select
  to public
  using (true);
