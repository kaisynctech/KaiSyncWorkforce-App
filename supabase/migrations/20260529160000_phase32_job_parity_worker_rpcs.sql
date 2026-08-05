-- Phase 3.2: employee job parity worker RPCs (documents, checklist insert, job thread, leadership-safe).

set search_path = public;
grant execute on function public.ensure_job_team_message_thread(uuid, uuid) to anon, authenticated;
create or replace function public.employee_get_job_thread(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_tid uuid;
  v_row public.message_threads%rowtype;
begin
  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  v_tid := public.ensure_job_team_message_thread(p_company_id, p_job_id);

  select * into v_row from public.message_threads where id = v_tid;
  return row_to_json(v_row);
end;
$$;
grant execute on function public.employee_get_job_thread(uuid, uuid, uuid) to anon, authenticated;
create or replace function public.employee_get_job_documents(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid
)
returns setof public.job_documents
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select d.*
  from public.job_documents d
  where d.company_id = p_company_id
    and d.job_id = p_job_id
    and public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id)
  order by d.created_at desc;
$$;
grant execute on function public.employee_get_job_documents(uuid, uuid, uuid) to anon, authenticated;
create or replace function public.employee_insert_job_document(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_document_name text,
  p_document_type text,
  p_file_url text
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_documents%rowtype;
begin
  if trim(coalesce(p_document_name, '')) = '' or trim(coalesce(p_file_url, '')) = '' then
    raise exception 'DOCUMENT_REQUIRED';
  end if;

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  insert into public.job_documents (
    company_id, job_id, document_name, document_type, file_url, created_at
  ) values (
    p_company_id, p_job_id, trim(p_document_name),
    coalesce(nullif(trim(p_document_type), ''), 'other'),
    trim(p_file_url), now()
  )
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
grant execute on function public.employee_insert_job_document(
  uuid, uuid, uuid, text, text, text
) to anon, authenticated;
create or replace function public.employee_insert_checklist_item(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_description text
)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_checklist_items%rowtype;
  v_sort int;
begin
  if trim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  select coalesce(max(c.sort_order), -1) + 1 into v_sort
  from public.job_checklist_items c
  where c.company_id = p_company_id and c.job_id = p_job_id;

  insert into public.job_checklist_items (
    company_id, job_id, description, is_checked, sort_order
  ) values (
    p_company_id, p_job_id, trim(p_description), false, v_sort
  )
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
grant execute on function public.employee_insert_checklist_item(uuid, uuid, uuid, text) to anon, authenticated;
