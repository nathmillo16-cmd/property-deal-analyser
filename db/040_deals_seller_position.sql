-- Run this in the Supabase SQL editor. Deal Workspace Phase 1: a per-deal
-- seller position (chain status, motivation, timescale, free-text notes),
-- shown alongside the new Activity Timeline (saved-deals.html). One record
-- per deal, not a list, so a single nullable jsonb column on deals — same
-- shape decision already made for comps_snapshot (db exists via the
-- original deals table) and refurb-related columns: a structured snapshot
-- living directly on the deal, not a separate table.
--
-- null means nothing's been recorded yet, a normal state for every deal
-- before this feature existed and for any deal where the user hasn't
-- filled it in. Written via a narrow POST /api/deals/:id/seller-position
-- endpoint that only ever touches this one column, same pattern as
-- /name, /viewing-date and /refurb-estimate.
--
-- Safe to re-run: IF NOT EXISTS.

alter table deals add column if not exists seller_position jsonb;
