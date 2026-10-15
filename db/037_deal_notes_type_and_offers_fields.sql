-- Run this in the Supabase SQL editor. Deal Workspace Phase 1 (saved-
-- deals.html): extends deal_notes and deal_offers to support the unified
-- Activity Timeline and the richer Offers upgrade. Purely additive —
-- every new column has a default or is nullable, so existing rows and
-- every existing caller (including pipeline.html's own separate Notes &
-- Offers modal, which reads these same two tables) keep working unchanged.
--
-- deal_notes: note_type distinguishes the three quick-add chip types
-- (Note/Call/Viewing) the Activity Timeline supports. Existing rows (and
-- every insert that doesn't pass note_type, e.g. pipeline.html's own
-- add-note call) default to 'note' — behaviourally identical to today.
--
-- deal_offers: agent_feedback (free text) and conditions (a fixed small
-- vocabulary, stored as a Postgres array rather than jsonb since it's a
-- flat multi-select with no nested structure) plus conditions_other for
-- the free-text addition the offer form also takes. outcome's check
-- constraint widens to add 'Countered' — a seller counter-offer, distinct
-- from Rejected/Withdrawn. No counter-amount field: not asked for, not
-- building it speculatively.
--
-- Constraint names below assume Postgres' default <table>_<column>_check
-- naming for the original inline check() in db/008 — "drop if exists" so
-- this is safe to run even if that assumption is ever wrong (it would just
-- leave the old constraint in place alongside the new one, not error).
--
-- Safe to re-run: every ALTER uses IF NOT EXISTS / DROP ... IF EXISTS.

alter table deal_notes add column if not exists note_type text not null default 'note';

alter table deal_notes drop constraint if exists deal_notes_note_type_check;
alter table deal_notes add constraint deal_notes_note_type_check
  check (note_type in ('note', 'call', 'viewing'));

alter table deal_offers add column if not exists agent_feedback text;
alter table deal_offers add column if not exists conditions text[] not null default '{}';
alter table deal_offers add column if not exists conditions_other text;

alter table deal_offers drop constraint if exists deal_offers_outcome_check;
alter table deal_offers add constraint deal_offers_outcome_check
  check (outcome in ('Pending', 'Rejected', 'Countered', 'Accepted', 'Withdrawn'));
