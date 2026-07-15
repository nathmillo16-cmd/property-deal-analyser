-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Creates the reference-data tables behind the future valuation/comps engine
-- (see CLAUDE.md "Planned — not yet built"). This is a schema change on a
-- shared project, so it's written here for you to review and run yourself
-- rather than applied automatically.
--
-- Design note: unlike every other table in this app (deals, profiles —
-- per-user, RLS-scoped to auth.uid()), postcodes and sold_prices are public
-- UK government reference data (ONS postcode geography; HM Land Registry
-- Price Paid Data), not personal data. RLS is still enabled on both, but
-- the policy allows anyone to SELECT — there's no INSERT/UPDATE/DELETE
-- policy for anon/authenticated roles at all, so writes are only possible
-- via the service-role key (which bypasses RLS), i.e. the ingest script
-- below and nothing else. If you'd rather restrict reads to logged-in
-- users only, swap `to public` for `to authenticated` in both policies.

create table if not exists postcodes (
  postcode text primary key,
  lat double precision,
  lng double precision
);

alter table postcodes enable row level security;

create policy "postcodes are publicly readable"
  on postcodes for select
  to public
  using (true);

create table if not exists sold_prices (
  id uuid primary key default gen_random_uuid(),
  price integer not null,
  date date not null,
  postcode text not null,
  paon text,
  saon text,
  street text,
  town text,
  property_type text,
  new_build boolean,
  tenure text
);

alter table sold_prices enable row level security;

create policy "sold_prices are publicly readable"
  on sold_prices for select
  to public
  using (true);

create index if not exists idx_sold_prices_postcode on sold_prices (postcode);
create index if not exists idx_sold_prices_date on sold_prices (date);
