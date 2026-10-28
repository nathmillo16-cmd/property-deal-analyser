-- 059: security tidy from Supabase's security advisor (2026-10-23).
-- No data is read, changed or deleted. Nothing about who can see which rows changes.
--
-- 1. Pin the search_path on 10 trigger functions that didn't have one set
--    ("Function Search Path Mutable"). Their bodies only use public tables,
--    auth.uid() and built-ins, so behaviour is identical.
-- 2. Trigger functions can't usefully be called directly, but Supabase exposes
--    every public function at /rest/v1/rpc/<name>. Remove EXECUTE from the API
--    roles. Triggers still fire: Postgres only checks EXECUTE when a trigger is
--    created, not each time it runs.
-- 3. The RLS helper functions (is_superuser, owns_portfolio_property,
--    owns_refurb_estimate) are only used by policies scoped to `authenticated`,
--    so logged-out callers (anon) lose EXECUTE; signed-in users keep it, because
--    their own RLS checks call these functions.

-- 1. search_path
alter function public.touch_deals_updated_at()          set search_path = public, pg_temp;
alter function public.touch_crm_contacts_updated_at()   set search_path = public, pg_temp;
alter function public.touch_deal_contacts_updated_at()  set search_path = public, pg_temp;
alter function public.touch_deal_key_dates_updated_at() set search_path = public, pg_temp;
alter function public.crm_log_contact_changes()         set search_path = public, pg_temp;
alter function public.crm_task_completion()             set search_path = public, pg_temp;
alter function public.crm_log_deal_review()             set search_path = public, pg_temp;
alter function public.crm_auto_task_new_application()   set search_path = public, pg_temp;
alter function public.crm_auto_task_qualified()         set search_path = public, pg_temp;
alter function public.crm_auto_task_deal_review()       set search_path = public, pg_temp;

-- 2. trigger functions: not callable through the API
revoke execute on function public.handle_new_user()              from public, anon, authenticated;
revoke execute on function public.log_deal_key_date_reached()    from public, anon, authenticated;
revoke execute on function public.log_deal_refurb_link_change()  from public, anon, authenticated;
revoke execute on function public.log_deal_stage_change()        from public, anon, authenticated;
revoke execute on function public.touch_parent_deal_updated_at() from public, anon, authenticated;

-- 3. RLS helpers: signed-in users only
revoke execute on function public.is_superuser()                  from public, anon;
revoke execute on function public.owns_portfolio_property(uuid)   from public, anon;
revoke execute on function public.owns_refurb_estimate(uuid)      from public, anon;
grant  execute on function public.is_superuser()                  to authenticated;
grant  execute on function public.owns_portfolio_property(uuid)   to authenticated;
grant  execute on function public.owns_refurb_estimate(uuid)      to authenticated;
