-- Run this in the Supabase SQL editor. Letter Templates overhaul
-- (letters.html). Additive only: two new nullable columns, nothing renamed
-- or dropped, no existing row changed.
--
-- Safe to re-run: columns use IF NOT EXISTS and the check constraint is
-- dropped and recreated.
--
-- The app keeps working before this is run: letters.html keeps "From you"
-- on the device instead of the account, and the follow-up reminder is
-- still created, it just opens the deal rather than the letter.

-- ---------- profiles.letter_sender ----------
-- The "From you" block on the Letter Templates page, saved to the account
-- so it follows the user across devices:
-- { name, area, phone, email, address, buying_direct, cash_buyer }, all
-- optional.
-- Covered by the existing profiles RLS (own row only).
alter table profiles add column if not exists letter_sender jsonb;

-- ---------- deal_reminders.action ----------
-- What a reminder opens when clicked. null = the deal (every existing
-- reminder). 'followup_letter' = the Letter Templates page with the
-- Follow-up letter and that deal picked, set by "Log as sent?" on
-- letters.html. A fixed list rather than a free URL, so a reminder can
-- never point anywhere unexpected. Covered by the existing deal_reminders
-- RLS from db/045.
alter table deal_reminders add column if not exists action text;

alter table deal_reminders drop constraint if exists deal_reminders_action_check;
alter table deal_reminders add constraint deal_reminders_action_check
  check (action is null or action in ('followup_letter'));
