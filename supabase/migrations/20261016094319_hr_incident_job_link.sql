-- HR can report an incident against any job in the company.
-- Field employees still have to be assigned to the job.
-- A linked job also stores that job's project on the incident.

CREATE OR REPLACE FUNCTION public.employee_insert_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_description text,
  p_severity text DEFAULT 'low'::text,
  p_job_id uuid DEFAULT NULL::uuid,
  p_site_id uuid DEFAULT NULL::uuid,
  p_assignee_id uuid DEFAULT NULL::uuid,
  p_photo_urls text[] DEFAULT '{}'::text[],
  p_reported_by_name text DEFAULT NULL::text,
  p_title text DEFAULT NULL::text,
  p_category text DEFAULT 'general'::text,
  p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_latitude double precision DEFAULT NULL::double precision,
  p_longitude double precision DEFAULT NULL::double precision,
  p_location_text text DEFAULT NULL::text,
  p_session_token text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
declare
  v_row public.incident_reports%rowtype;
  v_title text;
  v_deal uuid;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if trim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if p_job_id is not null then
    select j.deal_id into v_deal
    from public.jobs j
    where j.id = p_job_id
      and j.company_id = p_company_id;

    if not found then
      raise exception 'invalid job';
    end if;

    if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id)
       and not exists (
         select 1
         from public.employees hr
         where hr.user_id = auth.uid()
           and hr.company_id = p_company_id
           and hr.is_active = true
           and hr.access_level in ('hr', 'owner', 'manager', 'hr_admin', 'admin')
           and public.user_has_permission(p_company_id, 'incidents.create')
       ) then
      raise exception 'NOT_ASSIGNED_TO_JOB';
    end if;
  end if;

  if p_assignee_id is not null and not public._employee_valid(p_company_id, p_assignee_id) then
    raise exception 'invalid assignee';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    v_title := left(trim(p_description), 80);
  end if;

  insert into public.incident_reports (
    company_id, employee_id, job_id, site_id, deal_id, title, description, severity, category,
    status, photo_urls, assignee_id, reported_by_name, is_closed,
    occurred_at, latitude, longitude, location_text, created_at, updated_at
  ) values (
    p_company_id, p_employee_id, p_job_id, p_site_id, v_deal, v_title, trim(p_description),
    coalesce(nullif(trim(p_severity), ''), 'low'),
    coalesce(nullif(trim(p_category), ''), 'general'),
    'open',
    coalesce(p_photo_urls, '{}'), p_assignee_id,
    nullif(trim(coalesce(p_reported_by_name, '')), ''),
    false,
    coalesce(p_occurred_at, now()),
    p_latitude, p_longitude,
    nullif(trim(coalesce(p_location_text, '')), ''),
    now(), now()
  )
  returning * into v_row;

  insert into public.incident_status_history (
    company_id, incident_id, changed_by_employee_id, old_status, new_status, notes
  ) values (
    p_company_id, v_row.id, p_employee_id, null, 'open', 'Incident reported'
  );

  return row_to_json(v_row);
end;
$function$;
