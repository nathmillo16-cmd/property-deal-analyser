-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Adds a btree index on postcodes(lat, lng) to speed up the bounding-box
-- pre-filter used by nearby-postcodes.js's nearbyPostcodes() (see that file).
-- Without it, that bounding-box query still has to scan the full ~2.7M-row
-- table to find the rows inside the box; with it, Postgres can seek
-- straight to the relevant range instead.
--
-- `if not exists` makes this safe to re-run.

create index if not exists idx_postcodes_lat_lng on postcodes (lat, lng);
