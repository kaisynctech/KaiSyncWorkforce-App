-- Allow HR users (company members via user_company_ids) to read telemetry for dashboards.
-- Owner-only read policy remains; this adds member read scoped to their companies.

set search_path = public;
drop policy if exists p_app_events_select_hr on public.app_events;
create policy p_app_events_select_hr on public.app_events
  for select to authenticated
  using (
    app_events.company_id is not null
    and app_events.company_id = any(public.user_company_ids())
  );
