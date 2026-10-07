-- Run this in the Supabase SQL editor. Backs the "Contact us" modal
-- (support.js, opened from the shared nav on every logged-in page) and
-- POST /api/support-requests in server.js.
--
-- Same personal-data pattern as deal_notes/portfolio_properties: user_id
-- defaults to auth.uid() so server.js never sets it explicitly, and RLS
-- scopes every row to its own user. Users can insert and read their own
-- rows only. There is deliberately NO update or delete policy, so a user
-- can never change a request's status or remove it once sent; status is
-- for the team to manage (via the dashboard / service role), and the
-- insert policy pins it to 'new' so a user can't create a row that
-- already claims to be resolved.
--
-- screenshot_url holds the STORAGE PATH inside the private
-- 'support-screenshots' bucket (e.g. "<user_id>/<uuid>.png"), not a public
-- URL. The bucket is private, so viewing one means creating a signed URL
-- (or opening it from the Supabase dashboard's Storage view).
--
-- Safe to re-run: table/index use `if not exists`, the bucket insert uses
-- `on conflict do nothing`, and each policy is dropped and recreated.

create table if not exists support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text not null,
  category text not null check (category in ('Bug', 'Question', 'Feature idea', 'Billing')),
  trying_to_do text not null,
  what_happened text not null,
  page_url text,
  screenshot_url text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table support_requests enable row level security;

drop policy if exists "select own support requests" on support_requests;
create policy "select own support requests" on support_requests
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own support requests" on support_requests;
create policy "insert own support requests" on support_requests
  for insert to authenticated with check (auth.uid() = user_id and status = 'new');

create index if not exists idx_support_requests_user_id on support_requests (user_id);
create index if not exists idx_support_requests_status_created on support_requests (status, created_at desc);

-- ---------- storage: private screenshots bucket ----------
-- 5MB cap and image-only, enforced by Storage itself as well as server.js.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-screenshots', 'support-screenshots', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Every object path starts with the uploader's own user id
-- ("<user_id>/<file>"), and these policies only allow a user to upload
-- into, or read from, their own folder. No update/delete policies, same
-- as the table above.
drop policy if exists "support screenshots insert own folder" on storage.objects;
create policy "support screenshots insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'support-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "support screenshots select own folder" on storage.objects;
create policy "support screenshots select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'support-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
