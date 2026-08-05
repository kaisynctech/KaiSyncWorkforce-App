-- Phase 3: worker telemetry + remaining code-login RPC parity (scheduling, contractor, paperless, punch address).

set search_path = public;
-- ─── Telemetry (code-login) ───────────────────────────────────────────────────

create or replace function public.employee_log_app_event(
  p_company_id   uuid,
  p_employee_id  uuid,
  p_screen       text,
  p_action       text,
  p_level        text default 'info',
  p_error_text   text default null,
  p_meta         jsonb default null,
  p_user_agent   text default null,
  p_app_version  text default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if not public._employee_valid(p_company_id, p_employee_id) then
    return;
  end if;

  insert into public.app_events (
    company_id, auth_user_id, screen, action, level,
    error_text, meta, user_agent, app_version
  ) values (
    p_company_id,
    null,
    coalesce(nullif(trim(p_screen), ''), 'unknown'),
    coalesce(nullif(trim(p_action), ''), 'unknown'),
    case when p_level in ('info', 'warning', 'error') then p_level else 'info' end,
    p_error_text,
    p_meta,
    p_user_agent,
    p_app_version
  );
end;
$$;
grant execute on function public.employee_log_app_event(
  uuid, uuid, text, text, text, text, jsonb, text, text
) to anon, authenticated;
-- ─── Punch address (code-login geocode backfill) ──────────────────────────────

create or replace function public.employee_update_punch_address(
  p_company_id  uuid,
  p_employee_id uuid,
  p_punch_id    uuid,
  p_address     text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if trim(coalesce(p_address, '')) = '' then
    return;
  end if;

  update public.time_punches tp
  set address = trim(p_address)
  where tp.id = p_punch_id
    and tp.company_id = p_company_id
    and tp.employee_id = p_employee_id
    and public._employee_valid(p_company_id, p_employee_id);

  if not found then
    raise exception 'punch not found or not allowed';
  end if;
end;
$$;
grant execute on function public.employee_update_punch_address(uuid, uuid, uuid, text)
  to anon, authenticated;
-- ─── Scheduling ───────────────────────────────────────────────────────────────

create or replace function public.employee_get_calendar_events_for_worker(
  p_company_id  uuid,
  p_employee_id uuid,
  p_from        date,
  p_to          date
)
returns setof public.calendar_events
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select e.*
  from public.calendar_events e
  where e.company_id = p_company_id
    and p_employee_id = any(e.attendee_ids)
    and e.start_time >= p_from::timestamptz
    and e.start_time <= (p_to + 1)::timestamptz
    and public._employee_valid(p_company_id, p_employee_id)
  order by e.start_time asc;
$$;
create or replace function public.employee_update_calendar_event_attendance(
  p_company_id  uuid,
  p_employee_id uuid,
  p_event_id    uuid,
  p_response    text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if p_response not in ('accepted', 'declined', 'pending') then
    raise exception 'invalid attendance response';
  end if;

  update public.calendar_events e
  set attendance_responses =
    coalesce(e.attendance_responses, '{}'::jsonb)
    || jsonb_build_object(p_employee_id::text, p_response)
  where e.id = p_event_id
    and e.company_id = p_company_id
    and p_employee_id = any(e.attendee_ids)
    and public._employee_valid(p_company_id, p_employee_id);

  if not found then
    raise exception 'event not found or not an attendee';
  end if;
end;
$$;
grant execute on function public.employee_get_calendar_events_for_worker(uuid, uuid, date, date)
  to anon, authenticated;
grant execute on function public.employee_update_calendar_event_attendance(uuid, uuid, uuid, text)
  to anon, authenticated;
-- ─── Contractor profile (employee app) ──────────────────────────────────────

create or replace function public.employee_get_linked_contractors(
  p_company_id  uuid,
  p_employee_id uuid
)
returns setof public.contractors
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select distinct c.*
  from public.contractors c
  inner join public.contractor_member_links l
    on l.contractor_id = c.id
   and l.company_id = c.company_id
  where c.company_id = p_company_id
    and l.employee_id = p_employee_id
    and public._employee_valid(p_company_id, p_employee_id)
  order by c.name;
$$;
grant execute on function public.employee_get_linked_contractors(uuid, uuid)
  to anon, authenticated;
-- ─── Paperless / workflow forms ───────────────────────────────────────────────

create or replace function public.employee_get_workflow_form_templates(
  p_company_id  uuid,
  p_employee_id uuid
)
returns setof public.workflow_form_templates
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select t.*
  from public.workflow_form_templates t
  where t.company_id = p_company_id
    and coalesce(t.is_active, true)
    and public._employee_valid(p_company_id, p_employee_id)
  order by t.name;
$$;
create or replace function public.employee_get_workflow_form_submissions(
  p_company_id   uuid,
  p_employee_id  uuid,
  p_template_id  uuid default null
)
returns setof public.workflow_form_submissions
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select s.*
  from public.workflow_form_submissions s
  where s.company_id = p_company_id
    and s.submitted_by = p_employee_id
    and (p_template_id is null or s.template_id = p_template_id)
    and public._employee_valid(p_company_id, p_employee_id)
  order by s.submitted_at desc;
$$;
create or replace function public.employee_submit_workflow_form(
  p_company_id   uuid,
  p_employee_id  uuid,
  p_template_id  uuid,
  p_data         jsonb,
  p_job_id       uuid default null,
  p_site_id      uuid default null
)
returns public.workflow_form_submissions
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.workflow_form_submissions;
begin
  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if not exists (
    select 1 from public.workflow_form_templates t
    where t.id = p_template_id and t.company_id = p_company_id and coalesce(t.is_active, true)
  ) then
    raise exception 'template not found';
  end if;

  insert into public.workflow_form_submissions (
    company_id, template_id, submitted_by, job_id, site_id, data, submitted_at
  ) values (
    p_company_id, p_template_id, p_employee_id, p_job_id, p_site_id,
    coalesce(p_data, '{}'::jsonb), now()
  )
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.employee_get_workflow_form_templates(uuid, uuid)
  to anon, authenticated;
grant execute on function public.employee_get_workflow_form_submissions(uuid, uuid, uuid)
  to anon, authenticated;
grant execute on function public.employee_submit_workflow_form(uuid, uuid, uuid, jsonb, uuid, uuid)
  to anon, authenticated;
