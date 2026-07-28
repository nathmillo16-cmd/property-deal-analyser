-- Run this in the Supabase SQL editor. Backs the Notes section of the
-- pipeline deal detail modal (pipeline.html) and the /api/deals/:dealId/notes
-- + /api/notes/:id endpoints in server.js.
--
-- Personal data, same pattern as portfolio_properties: user_id defaults to
-- auth.uid() so server.js never sets it explicitly. deal_id references the
-- deals table's own id (the same key used by /api/pipeline/:id/stage etc.)
-- with on delete cascade, so a deal's notes disappear if the deal itself is
-- ever deleted — but removing a deal from the pipeline (pipeline_stage set
-- back to null) does not delete the deal row, so notes survive that.
--
-- No update policy — notes are timestamped log entries with no edit
-- endpoint; to change one, delete and re-add (see server.js).
--
-- Safe to re-run: table/column/index all use `if not exists`, and each
-- policy is dropped and recreated so re-running this script doesn't error
-- on policies that already exist.

create table if not exists deal_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  note_text text not null,
  created_at timestamptz not null default now()
);

alter table deal_notes enable row level security;

drop policy if exists "select own deal notes" on deal_notes;
create policy "select own deal notes" on deal_notes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own deal notes" on deal_notes;
create policy "insert own deal notes" on deal_notes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "delete own deal notes" on deal_notes;
create policy "delete own deal notes" on deal_notes
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_notes_deal_id on deal_notes (deal_id);
