-- Run this in the Supabase SQL editor. Adds a display name to profiles,
-- for the new Settings page's Account section — profiles previously had no
-- name column at all (only user_id, target_yield, target_roi,
-- default_mortgage_rate, standard_fees, created_at, plan).
--
-- Nullable, no default: existing users simply have name=null until they
-- set one in Settings. Safe to re-run (IF NOT EXISTS).

alter table profiles add column if not exists name text;
