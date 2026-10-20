-- Run this in the Supabase SQL editor. Home page progress that used to live
-- only in each browser's localStorage, moved onto the account so it is the
-- same on every device (website and iOS app):
--   setup_dismissed_at   -- "Get the most out of PROPulsion" checklist dismissed
--   setup_completed_at   -- every checklist item done once (hidden for good)
--   milestone_dates      -- { "<milestone id>": "<ISO time earned>" }
--   milestones_seen      -- [ "<milestone id>", ... ] celebrations already shown.
--                           null means "never recorded" (first visit), which
--                           Home treats differently from an empty list.
--   last_analysed_at     -- last time Analyse was pressed in the calculator
--   brrr_analysed_at     -- first time Analyse was pressed on the BRRR tab
--
-- All nullable, no defaults. Existing RLS on profiles (own row, plus the
-- superuser read policy) already covers these. Written only by
-- POST /api/profile/progress, which touches only these six columns.
-- Until this is run, Home keeps using localStorage exactly as before.
--
-- Safe to re-run: IF NOT EXISTS, and the check constraints are dropped first.

alter table profiles add column if not exists setup_dismissed_at timestamptz;
alter table profiles add column if not exists setup_completed_at timestamptz;
alter table profiles add column if not exists milestone_dates jsonb;
alter table profiles add column if not exists milestones_seen jsonb;
alter table profiles add column if not exists last_analysed_at timestamptz;
alter table profiles add column if not exists brrr_analysed_at timestamptz;

alter table profiles drop constraint if exists profiles_milestone_dates_object;
alter table profiles add constraint profiles_milestone_dates_object
  check (milestone_dates is null or jsonb_typeof(milestone_dates) = 'object');

alter table profiles drop constraint if exists profiles_milestones_seen_array;
alter table profiles add constraint profiles_milestones_seen_array
  check (milestones_seen is null or jsonb_typeof(milestones_seen) = 'array');
