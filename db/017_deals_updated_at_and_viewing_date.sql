-- Run this in the Supabase SQL editor. Adds the two schema pieces the
-- "Needs attention" home panel needs on deals (see CLAUDE.md) — a real
-- last-touched timestamp and a place to record a viewing date, neither of
-- which existed before (deals previously had only created_at).
--
-- Provenance note: this file is a version-controlled record of a migration
-- that was already run directly in the Supabase SQL editor, not applied via
-- this file. The ALTER TABLE statements are safe to re-run (IF NOT EXISTS
-- everywhere), but the backfill UPDATE below is a one-time historical step
-- only — it aligned updated_at back to created_at for rows that existed
-- BEFORE this column existed (Postgres' own ALTER ... DEFAULT now() would
-- otherwise stamp every pre-existing row with the migration's own run time,
-- not each row's real created_at). Re-running that UPDATE today, after
-- 018_deals_touch_triggers.sql is live and deals have genuinely been
-- touched since, would incorrectly clobber those real bumps back to
-- created_at. Do not re-run the backfill against a live database.

alter table deals add column if not exists updated_at timestamptz not null default now();
alter table deals add column if not exists viewing_date date;

-- One-time backfill — see the provenance note above. Only correct to run
-- once, immediately after the column is first added.
update deals set updated_at = created_at;
