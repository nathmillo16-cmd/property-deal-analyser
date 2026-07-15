-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Permanent cache of EPC floor-area lookups keyed by (postcode, house_number),
-- backing get-comps.js's floorAreaSqM/pricePerSqM enrichment (see that file
-- and epc-floor-area.js). Floor areas don't change once registered, and the
-- gov.uk Energy Certificate Data API rate-limits at 6000 req/5min per IP, so
-- every resolved house number (including "no EPC match found", stored as a
-- row with certificate_number/floor_area_sqm left null) is cached forever
-- rather than re-queried on a later getComps call for the same postcode.
--
-- Same public-read / service-role-write pattern as postcodes and sold_prices
-- in 001_postcodes_and_sold_prices.sql: this is reference data derived from a
-- public government API, not personal data, but only epc-floor-area.js's own
-- service-role client should ever write to it.

create table if not exists epc_floor_area_cache (
  id uuid primary key default gen_random_uuid(),
  postcode text not null,
  house_number text not null,
  uprn bigint,
  floor_area_sqm numeric,
  certificate_number text,
  fetched_at timestamptz not null default now()
);

alter table epc_floor_area_cache enable row level security;

create policy "epc_floor_area_cache is publicly readable"
  on epc_floor_area_cache for select
  to public
  using (true);

create unique index if not exists idx_epc_floor_area_cache_postcode_house_number
  on epc_floor_area_cache (postcode, house_number);
