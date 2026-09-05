-- Run this in the Supabase SQL editor. Backs the new in-app onboarding
-- tutorial's "don't auto-trigger again" flag with a real per-user column
-- (not just localStorage), so it doesn't re-trigger on another device or
-- browser but is genuinely resettable from Settings ("Replay Tutorial").
--
-- Not null, defaults false: a brand new signup's profiles row (created by
-- the existing auth.users trigger) gets false automatically, which is what
-- makes home.html auto-trigger the tour for them.
alter table profiles add column if not exists has_completed_tutorial boolean not null default false;

-- Backfill: every profile that exists AT THE TIME THIS MIGRATION RUNS
-- belongs to someone already using the app without a tutorial. The intent
-- ("auto-triggers the first time a user reaches the dashboard after
-- completing signup") is about new signups, not a retroactive nag to
-- existing users, so those rows are marked complete here. Safe to re-run:
-- only ever flips false rows to true, never touches a row already true
-- (including a user who deliberately replayed and skipped again).
update profiles set has_completed_tutorial = true where has_completed_tutorial = false;
