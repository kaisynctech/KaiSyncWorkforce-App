-- Enterprise Incident Management Module: unified schema, comments, status history, worker RPCs.

set search_path = public;

-- ─── Extend incident_reports ───────────────────────────────────────────────────

alter table public.incident_reports
  add column if not exists title text,
  add column if not exists category text not null default 'general',
  add column if not exists status text not null default 'open',
  add column if not exists occurred_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_text text;

create index if not exists idx_incident_reports_company_status
  on public.incident_reports(company_id, status, created_at desc);

create index if not exists idx_incident_reports_job
  on public.incident_reports(company_id, job_id, created_at desc)
  where job_id is not null;

-- Backfill status from legacy is_closed flag
update public.incident_reports
set status = case when is_closed then 'closed' else 'open' end,
    updated_at = coalesce(updated_at, created_at)
where status is null or status = 'open' and is_closed = true;

-- ─── Comments & status history ─────────────────────────────────────────────────

create table if not exists public.incident_comments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  incident_id         uuid not null references public.incident_reports(id) on delete cascade,
  author_employee_id  uuid references public.employees(id) on delete set null,
  author_name         text,
  body                text not null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_incident_comments_incident
  on public.incident_comments(incident_id, created_at asc);

create table if not exists public.incident_status_history (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  incident_id             uuid not null references public.incident_reports(id) on delete cascade,
  changed_by_employee_id  uuid references public.employees(id) on delete set null,
  old_status              text,
  new_status              text not null,
  notes                   text,
  created_at              timestamptz not null default now()
);

create index if not exists idx_incident_status_history_incident
  on public.incident_status_history(incident_id, created_at desc);

alter table public.incident_comments enable row level security;
alter table public.incident_status_history enable row level security;

drop policy if exists incident_comments_all on public.incident_comments;
create policy incident_comments_all on public.incident_comments for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));

drop policy if exists incident_status_history_all on public.incident_status_history;
create policy incident_status_history_all on public.incident_status_history for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));

-- ─── Access helpers ────────────────────────────────────────────────────────────

create or replace function public._employee_can_view_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.incident_reports i
    where i.id = p_incident_id
      and i.company_id = p_company_id
      and public._employee_valid(p_company_id, p_employee_id)
      and (
        i.employee_id = p_employee_id
        or i.assignee_id = p_employee_id
        or (
          i.job_id is not null
          and public._employee_assigned_to_job(p_company_id, p_employee_id, i.job_id)
        )
      )
  );
$$;

create or replace function public._employee_can_manage_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.company_id = p_company_id
      and e.is_active = true
      and e.access_level in ('owner', 'admin', 'hr_admin', 'hr', 'manager')
  )
  or exists (
    select 1 from public.incident_reports i
    where i.id = p_incident_id
      and i.company_id = p_company_id
      and i.assignee_id = p_employee_id
  );
$$;

create or replace function public._incident_apply_status(
  p_incident_id uuid,
  p_new_status text,
  p_changed_by uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_old text;
  v_company uuid;
begin
  select status, company_id into v_old, v_company
  from public.incident_reports
  where id = p_incident_id
  for update;

  if v_old is null then
    raise exception 'incident not found';
  end if;

  if v_old = p_new_status then
    return;
  end if;

  update public.incident_reports
  set status = p_new_status,
      is_closed = (p_new_status in ('closed', 'resolved')),
      resolution_notes = case
        when p_new_status in ('closed', 'resolved') and p_notes is not null then p_notes
        else resolution_notes
      end,
      updated_at = now()
  where id = p_incident_id;

  insert into public.incident_status_history (
    company_id, incident_id, changed_by_employee_id, old_status, new_status, notes
  ) values (
    v_company, p_incident_id, p_changed_by, v_old, p_new_status, p_notes
  );
end;
$$;

-- ─── Create incident (replace existing) ────────────────────────────────────────

drop function if exists public.employee_insert_incident(
  bigint, bigint, text, bigint, bigint, text, text, timestamptz, text[]
);

create or replace function public.employee_insert_incident(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_description      text,
  p_severity         text default 'low',
  p_job_id           uuid default null,
  p_site_id          uuid default null,
  p_assignee_id      uuid default null,
  p_photo_urls       text[] default '{}',
  p_reported_by_name text default null,
  p_title            text default null,
  p_category         text default 'general',
  p_occurred_at      timestamptz default null,
  p_latitude         double precision default null,
  p_longitude        double precision default null,
  p_location_text    text default null
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
  v_title text;
begin
  if trim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if p_job_id is not null
     and not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  if p_assignee_id is not null and not public._employee_valid(p_company_id, p_assignee_id) then
    raise exception 'invalid assignee';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    v_title := left(trim(p_description), 80);
  end if;

  insert into public.incident_reports (
    company_id, employee_id, job_id, site_id, title, description, severity, category,
    status, photo_urls, assignee_id, reported_by_name, is_closed,
    occurred_at, latitude, longitude, location_text, created_at, updated_at
  ) values (
    p_company_id, p_employee_id, p_job_id, p_site_id, v_title, trim(p_description),
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
$$;

revoke all on function public.employee_insert_incident(
  uuid, uuid, text, text, uuid, uuid, uuid, text[], text, text, text, timestamptz, double precision, double precision, text
) from public;
grant execute on function public.employee_insert_incident(
  uuid, uuid, text, text, uuid, uuid, uuid, text[], text, text, text, timestamptz, double precision, double precision, text
) to anon, authenticated;

-- ─── List / get incidents ──────────────────────────────────────────────────────

create or replace function public.employee_get_incidents(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid default null,
  p_include_closed boolean default true
)
returns setof public.incident_reports
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select i.*
  from public.incident_reports i
  where i.company_id = p_company_id
    and public._employee_valid(p_company_id, p_employee_id)
    and (p_job_id is null or i.job_id = p_job_id)
    and (p_include_closed or i.status not in ('closed', 'resolved'))
    and (
      i.employee_id = p_employee_id
      or i.assignee_id = p_employee_id
      or (
        i.job_id is not null
        and public._employee_assigned_to_job(p_company_id, p_employee_id, i.job_id)
      )
    )
  order by i.created_at desc
  limit 200;
$$;

grant execute on function public.employee_get_incidents(uuid, uuid, uuid, boolean) to anon, authenticated;

create or replace function public.employee_get_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid
)
returns json
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
begin
  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_row
  from public.incident_reports
  where id = p_incident_id and company_id = p_company_id;

  if v_row.id is null then
    raise exception 'NOT_FOUND';
  end if;

  return row_to_json(v_row);
end;
$$;

grant execute on function public.employee_get_incident(uuid, uuid, uuid) to anon, authenticated;

-- Keep legacy alias pointing to expanded list (reporter-only subset for backward compat)
create or replace function public.employee_get_own_incidents(
  p_company_id uuid,
  p_employee_id uuid
)
returns setof public.incident_reports
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select i.*
  from public.incident_reports i
  where i.company_id = p_company_id
    and i.employee_id = p_employee_id
    and public._employee_valid(p_company_id, p_employee_id)
  order by i.created_at desc
  limit 200;
$$;

-- ─── Update / close ────────────────────────────────────────────────────────────

create or replace function public.employee_update_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_status text default null,
  p_resolution_notes text default null,
  p_assignee_id uuid default null,
  p_clear_assignee boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
begin
  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_status is not null then
    if not public._employee_can_manage_incident(p_company_id, p_employee_id, p_incident_id) then
      raise exception 'FORBIDDEN_STATUS';
    end if;
    perform public._incident_apply_status(
      p_incident_id, p_status, p_employee_id, p_resolution_notes
    );
  elsif p_resolution_notes is not null then
    update public.incident_reports
    set resolution_notes = p_resolution_notes, updated_at = now()
    where id = p_incident_id;
  end if;

  if p_clear_assignee or p_assignee_id is not null then
    if not public._employee_can_manage_incident(p_company_id, p_employee_id, p_incident_id) then
      raise exception 'FORBIDDEN_ASSIGN';
    end if;
  end if;

  if p_assignee_id is not null and not public._employee_valid(p_company_id, p_assignee_id) then
    raise exception 'invalid assignee';
  end if;

  if p_clear_assignee then
    update public.incident_reports set assignee_id = null, updated_at = now()
    where id = p_incident_id;
  elsif p_assignee_id is not null then
    update public.incident_reports set assignee_id = p_assignee_id, updated_at = now()
    where id = p_incident_id;
  end if;

  select * into v_row from public.incident_reports where id = p_incident_id;
  return row_to_json(v_row);
end;
$$;

grant execute on function public.employee_update_incident(
  uuid, uuid, uuid, text, text, uuid, boolean
) to anon, authenticated;

-- ─── Comments ──────────────────────────────────────────────────────────────────

create or replace function public.employee_add_incident_comment(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_body text
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_comments%rowtype;
  v_name text;
begin
  if trim(coalesce(p_body, '')) = '' then
    raise exception 'BODY_REQUIRED';
  end if;

  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  select trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, ''))
  into v_name
  from public.employees e
  where e.id = p_employee_id;

  insert into public.incident_comments (
    company_id, incident_id, author_employee_id, author_name, body
  ) values (
    p_company_id, p_incident_id, p_employee_id,
    nullif(trim(v_name), ''), trim(p_body)
  )
  returning * into v_row;

  update public.incident_reports set updated_at = now() where id = p_incident_id;

  return row_to_json(v_row);
end;
$$;

grant execute on function public.employee_add_incident_comment(uuid, uuid, uuid, text) to anon, authenticated;

create or replace function public.employee_get_incident_comments(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid
)
returns setof public.incident_comments
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select c.*
  from public.incident_comments c
  where c.company_id = p_company_id
    and c.incident_id = p_incident_id
    and public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id)
  order by c.created_at asc;
$$;

grant execute on function public.employee_get_incident_comments(uuid, uuid, uuid) to anon, authenticated;

create or replace function public.employee_get_incident_status_history(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid
)
returns setof public.incident_status_history
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select h.*
  from public.incident_status_history h
  where h.company_id = p_company_id
    and h.incident_id = p_incident_id
    and public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id)
  order by h.created_at desc;
$$;

grant execute on function public.employee_get_incident_status_history(uuid, uuid, uuid) to anon, authenticated;

-- Append photo URLs (reporter or manager)
create or replace function public.employee_append_incident_photos(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_photo_urls text[]
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
begin
  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  update public.incident_reports
  set photo_urls = photo_urls || coalesce(p_photo_urls, '{}'),
      updated_at = now()
  where id = p_incident_id and company_id = p_company_id
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;

grant execute on function public.employee_append_incident_photos(uuid, uuid, uuid, text[]) to anon, authenticated;
