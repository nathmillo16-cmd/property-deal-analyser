-- Run this in the Supabase SQL editor. Stage 2 of the crime-rate feature
-- (see db/013_msoa_population.sql for Stage 1) — the precomputed national
-- MSOA crime-rate benchmark. Everything heavy (reading the Police UK bulk
-- archive, counting crimes per LSOA, rolling up to MSOA) happens locally
-- in scripts/compute-crime-benchmark.js; only this small per-MSOA result
-- is ever written to Supabase. No individual crime record is stored here
-- or anywhere else.
--
-- Two tables:
--   msoa_crime_rate — one row per MSOA (~7,000 rows): the crime count and
--     population feeding the rate, the rate itself, and a low/medium/high
--     band. References msoa_population(msoa_code) — every row here should
--     correspond to a real, populated MSOA.
--   crime_benchmark_meta — a deliberate single row (id is pinned to 1 via
--     the check constraint, so there is only ever one) recording which
--     month's data produced the current benchmark and the two percentile
--     thresholds used for banding, so the app can show "as of <month>"
--     rather than silently going stale.
--
-- Public UK government/derived reference data, same pattern as
-- postcodes/sold_prices/msoa_population: RLS enabled, only a public SELECT
-- policy — no insert/update/delete for anon/authenticated, so writes are
-- only possible via the service-role key (scripts/compute-crime-benchmark.js
-- and nothing else).
--
-- Safe to re-run: tables use `if not exists`, and each policy is dropped
-- and recreated so re-running this script doesn't error on a policy that
-- already exists.

create table if not exists msoa_crime_rate (
  msoa_code text primary key references msoa_population(msoa_code),
  crime_count integer not null,
  population integer not null,
  rate_per_1000 numeric not null,
  band text not null check (band in ('low', 'medium', 'high'))
);

alter table msoa_crime_rate enable row level security;

drop policy if exists "msoa_crime_rate is publicly readable" on msoa_crime_rate;
create policy "msoa_crime_rate is publicly readable"
  on msoa_crime_rate for select
  to public
  using (true);

create table if not exists crime_benchmark_meta (
  id integer primary key default 1,
  data_month text not null,
  low_threshold numeric not null,
  high_threshold numeric not null,
  computed_at timestamptz not null default now(),
  constraint crime_benchmark_meta_singleton check (id = 1)
);

alter table crime_benchmark_meta enable row level security;

drop policy if exists "crime_benchmark_meta is publicly readable" on crime_benchmark_meta;
create policy "crime_benchmark_meta is publicly readable"
  on crime_benchmark_meta for select
  to public
  using (true);
