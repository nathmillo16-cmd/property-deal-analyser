-- Run this in the Supabase SQL editor. Part of the comps re-architecture
-- (see postcodes-io.js, get-comps-v2.js, scripts/backfill-sold-prices-lat-lng.js)
-- that resolves the subject postcode live via postcodes.io instead of the
-- `postcodes` table, and filters sold_prices directly by its own lat/lng
-- instead of joining through a postcode list. This migration only adds the
-- columns and the supporting index — it does NOT touch or drop the
-- `postcodes` table, which stays in place until the switchover is verified
-- working (see the plan this was written against).
--
-- lat/lng start out null on every existing row until
-- scripts/backfill-sold-prices-lat-lng.js is run against this migration.
--
-- Same idempotent pattern as db/002_postcodes_lat_lng_index.sql (the
-- equivalent index on the old `postcodes` table): the bounding-box
-- pre-filter get-comps-v2.js runs before the exact haversine distance
-- check needs this index to avoid scanning the full sold_prices table for
-- every comps lookup.
--
-- Safe to re-run: `add column if not exists` / `create index if not
-- exists` both error on nothing if already applied.

alter table sold_prices add column if not exists lat double precision;
alter table sold_prices add column if not exists lng double precision;

create index if not exists idx_sold_prices_lat_lng on sold_prices (lat, lng);
