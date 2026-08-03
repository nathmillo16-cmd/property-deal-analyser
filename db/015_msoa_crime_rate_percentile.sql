-- Run this in the Supabase SQL editor. Adds a national percentile rank to
-- msoa_crime_rate, alongside the existing low/medium/high band — the band
-- alone is too coarse (a moderately-high area and a very-high area both
-- read as "High"), so this gives the crime signal a finer, honest number:
-- what % of MSOAs nationally have a lower rate_per_1000 than this one.
-- Computed and written by scripts/compute-crime-benchmark.js
-- (percentileRankOf()) — this migration only adds the column.
--
-- Nullable, not `not null` — this table already has ~7,264 real rows from
-- the last run, and a `not null` column added to populated rows needs a
-- default or backfill in the same statement. Simpler to add it nullable
-- and let the next full re-run of compute-crime-benchmark.js (which
-- upserts every row every time) populate it in one pass, same as how the
-- real values get there regardless.
--
-- Safe to re-run: `add column if not exists` errors on nothing if it's
-- already there.

alter table msoa_crime_rate add column if not exists percentile numeric;
