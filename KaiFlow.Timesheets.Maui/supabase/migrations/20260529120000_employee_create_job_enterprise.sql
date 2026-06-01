-- Enterprise employee job creation: worker-safe RPC, audit trail, assignments, calendar, messaging.

set search_path = public;

alter table public.jobs
  add column if not exists created_by_employee_id uuid references public.employees(id) on delete set null;

create index if not exists idx_jobs_created_by_employee
  on public.jobs(company_id, created_by_employee_id, created_at desc);

-- Drop legacy bigint overload if present (PGRST203 prevention).
drop function if exists public.employee_create_job(
  bigint, bigint, text, text, text, timestamptz, timestamptz, bigint, bigint, bigint[], bigint
);

create or replace function public._next_job_code(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_n bigint;
begin
  select upper(coalesce(nullif(trim(c.code), ''), 'JOB'))
  into v_prefix
  from public.companies c
  where c.id = p_company_id;

  select count(*) + 1 into v_n
  from public.jobs j
  where j.company_id = p_company_id;

  return v_prefix || '-J' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function public.employee_create_job(
  p_company_id              uuid,
  p_creator_employee_id     uuid,
  p_title                   text,
  p_description             text default null,
  p_priority                text default 'medium',
  p_scheduled_start         timestamptz default null,
  p_scheduled_end           timestamptz default null,
  p_site_id                 uuid default null,
  p_client_id               uuid default null,
  p_assignee_employee_id    uuid default null,
  p_assigned_employee_ids   uuid[] default '{}',
  p_notify_manager_employee_id uuid default null,
  p_visibility              text default 'inherit'
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.jobs%rowtype;
  v_ids uuid[];
  v_assignee uuid;
  v_mgr_user uuid;
  v_employee_name text;
begin
  if trim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED';
  end if;

  if not public._employee_valid(p_company_id, p_creator_employee_id) then
    raise exception 'invalid employee';
  end if;

  v_ids := coalesce(p_assigned_employee_ids, '{}'::uuid[]);
  if not (p_creator_employee_id = any(v_ids)) then
    v_ids := array_prepend(p_creator_employee_id, v_ids);
  end if;

  foreach v_assignee in array v_ids loop
    if not public._employee_valid(p_company_id, v_assignee) then
      raise exception 'invalid assignee %', v_assignee;
    end if;
  end loop;

  v_assignee := coalesce(p_assignee_employee_id, p_creator_employee_id);
  if not (v_assignee = any(v_ids)) then
    v_ids := array_prepend(v_assignee, v_ids);
  end if;

  if p_site_id is not null and not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.company_id = p_company_id
  ) then
    raise exception 'invalid site';
  end if;

  if p_client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = p_client_id and c.company_id = p_company_id
  ) then
    raise exception 'invalid client';
  end if;

  insert into public.jobs (
    company_id, title, description, priority,
    scheduled_start, scheduled_end, site_id, client_id,
    status, opened_at, visibility, job_code,
    created_by_employee_id, assignee_employee_id, assigned_employee_ids,
    created_at, updated_at
  ) values (
    p_company_id,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(p_priority), ''), 'medium'),
    p_scheduled_start,
    coalesce(p_scheduled_end, p_scheduled_start + interval '8 hours'),
    p_site_id,
    p_client_id,
    'scheduled',
    now(),
    coalesce(nullif(trim(p_visibility), ''), 'inherit'),
    public._next_job_code(p_company_id),
    p_creator_employee_id,
    v_assignee,
    v_ids,
    now(),
    now()
  )
  returning * into v_row;

  perform public.ensure_job_team_message_thread(p_company_id, v_row.id);

  if p_scheduled_start is not null then
    insert into public.calendar_events (
      company_id, title, description, start_time, end_time,
      attendee_ids, event_type, linked_job_id, created_by, created_at
    ) values (
      p_company_id,
      v_row.title,
      v_row.description,
      p_scheduled_start,
      coalesce(p_scheduled_end, p_scheduled_start + interval '8 hours'),
      v_ids,
      'job',
      v_row.id,
      p_creator_employee_id,
      now()
    );
  end if;

  if p_notify_manager_employee_id is not null then
    select e.user_id,
           trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, ''))
    into v_mgr_user, v_employee_name
    from public.employees e
    where e.id = p_notify_manager_employee_id
      and e.company_id = p_company_id
      and e.is_active = true;

    if v_mgr_user is not null then
      perform public.employee_notify_manager_job_created(
        p_company_id,
        v_mgr_user,
        v_row.id,
        p_creator_employee_id,
        v_row.title
      );
    end if;
  end if;

  return row_to_json(v_row);
end;
$$;

revoke all on function public.employee_create_job(
  uuid, uuid, text, text, text, timestamptz, timestamptz, uuid, uuid, uuid, uuid[], uuid, text
) from public;
grant execute on function public.employee_create_job(
  uuid, uuid, text, text, text, timestamptz, timestamptz, uuid, uuid, uuid, uuid[], uuid, text
) to anon, authenticated;

-- Creators always see jobs they created even before assignment sync edge cases.
create or replace function public.employee_get_jobs_for_employee(
  p_company_id uuid,
  p_employee_id uuid
)
returns setof public.jobs
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select j.*
  from public.jobs j
  where j.company_id = p_company_id
    and (
      j.created_by_employee_id = p_employee_id
      or j.assigned_employee_ids @> array[p_employee_id]
      or j.assignee_employee_id = p_employee_id
      or j.contractor_employee_id = p_employee_id
      or (
        j.contractor_id is not null
        and exists (
          select 1
          from public.contractor_member_links cml
          where cml.company_id = p_company_id
            and cml.employee_id = p_employee_id
            and cml.contractor_id = j.contractor_id
        )
      )
    )
  order by j.created_at desc;
$$;

grant execute on function public.employee_get_jobs_for_employee(uuid, uuid) to anon, authenticated;
