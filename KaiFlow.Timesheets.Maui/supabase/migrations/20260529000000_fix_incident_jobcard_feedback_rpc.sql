-- Phase 3.1: drop legacy bigint RPC overloads + preserve job-card timestamps on partial saves.

set search_path = public;
-- ─── Incident: PGRST203 from bigint + uuid overload coexistence ─────────────

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
  p_reported_by_name text default null
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

  insert into public.incident_reports (
    company_id, employee_id, job_id, site_id, description, severity,
    photo_urls, assignee_id, reported_by_name, is_closed, created_at
  ) values (
    p_company_id, p_employee_id, p_job_id, p_site_id, trim(p_description),
    coalesce(nullif(trim(p_severity), ''), 'low'),
    coalesce(p_photo_urls, '{}'), p_assignee_id,
    nullif(trim(coalesce(p_reported_by_name, '')), ''),
    false, now()
  )
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
revoke all on function public.employee_insert_incident(
  uuid, uuid, text, text, uuid, uuid, uuid, text[], text
) from public;
grant execute on function public.employee_insert_incident(
  uuid, uuid, text, text, uuid, uuid, uuid, text[], text
) to anon, authenticated;
-- ─── Job card: do not wipe timestamps on partial upsert ───────────────────────

drop function if exists public.employee_upsert_job_card(
  bigint, bigint, bigint, timestamptz, timestamptz, text, text, text, text[], text
);
create or replace function public.employee_upsert_job_card(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null,
  p_work_performed text default null,
  p_materials_used text default null,
  p_photo_urls text[] default '{}',
  p_is_completed boolean default false,
  p_client_signature_url text default null
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_cards%rowtype;
begin
  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  insert into public.job_cards (
    company_id, job_id, employee_id,
    start_time, end_time, work_performed, materials_used,
    photo_urls, is_completed, client_signature_url, updated_at
  )
  values (
    p_company_id, p_job_id, p_employee_id,
    p_start_time, p_end_time, p_work_performed, p_materials_used,
    coalesce(p_photo_urls, '{}'), coalesce(p_is_completed, false),
    p_client_signature_url, now()
  )
  on conflict (company_id, job_id)
  do update set
    employee_id = excluded.employee_id,
    start_time = coalesce(excluded.start_time, job_cards.start_time),
    end_time = coalesce(excluded.end_time, job_cards.end_time),
    work_performed = coalesce(excluded.work_performed, job_cards.work_performed),
    materials_used = coalesce(excluded.materials_used, job_cards.materials_used),
    photo_urls = case
      when coalesce(array_length(excluded.photo_urls, 1), 0) > 0 then excluded.photo_urls
      else job_cards.photo_urls
    end,
    is_completed = excluded.is_completed,
    client_signature_url = coalesce(excluded.client_signature_url, job_cards.client_signature_url),
    updated_at = now()
  returning * into v_row;

  if coalesce(p_is_completed, false) then
    update public.jobs
    set status = 'completed',
        closed_at = coalesce(closed_at, now()),
        updated_at = now()
    where id = p_job_id
      and company_id = p_company_id
      and status not in ('completed', 'cancelled');
  end if;

  return row_to_json(v_row);
end;
$$;
revoke all on function public.employee_upsert_job_card(
  uuid, uuid, uuid, timestamptz, timestamptz, text, text, text[], boolean, text
) from public;
grant execute on function public.employee_upsert_job_card(
  uuid, uuid, uuid, timestamptz, timestamptz, text, text, text[], boolean, text
) to anon, authenticated;
-- ─── Job feedback (uuid v2 — legacy table was dropped) ────────────────────────

create table if not exists public.job_feedback (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  employee_id  uuid references public.employees(id) on delete set null,
  rating       int not null check (rating between 1 and 5),
  comments     text,
  submitted_at timestamptz not null default now()
);
create unique index if not exists uq_job_feedback_job_employee
  on public.job_feedback (job_id, employee_id);
create index if not exists idx_job_feedback_company_job
  on public.job_feedback (company_id, job_id, submitted_at desc);
alter table public.job_feedback enable row level security;
drop policy if exists p_job_feedback_hr on public.job_feedback;
create policy p_job_feedback_hr on public.job_feedback
  for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));
create or replace function public.employee_submit_job_feedback(
  p_company_id  uuid,
  p_employee_id uuid,
  p_job_id      uuid,
  p_rating      int,
  p_comments    text default null
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_feedback%rowtype;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'INVALID_RATING';
  end if;

  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  insert into public.job_feedback (company_id, job_id, employee_id, rating, comments)
  values (p_company_id, p_job_id, p_employee_id, p_rating, nullif(trim(coalesce(p_comments, '')), ''))
  on conflict (job_id, employee_id)
  do update set
    rating = excluded.rating,
    comments = excluded.comments,
    submitted_at = now()
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
create or replace function public.employee_get_job_feedback(
  p_company_id  uuid,
  p_employee_id uuid,
  p_job_id      uuid
)
returns setof public.job_feedback
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select f.*
  from public.job_feedback f
  where f.company_id = p_company_id
    and f.job_id = p_job_id
    and public._employee_valid(p_company_id, p_employee_id)
  order by f.submitted_at desc;
$$;
grant execute on function public.employee_submit_job_feedback(uuid, uuid, uuid, int, text)
  to anon, authenticated;
grant execute on function public.employee_get_job_feedback(uuid, uuid, uuid)
  to anon, authenticated;
