-- Employee RPC hardening (phase 2)
-- Run this in Supabase SQL editor.

set search_path = public;

drop function if exists public.employee_get_jobs_for_employee(bigint, bigint);
create or replace function public.employee_get_jobs_for_employee(
  p_company_id bigint,
  p_employee_id bigint
)
returns setof public.jobs
language sql
stable
security definer
set search_path = public
as $$
  select j.*
  from public.jobs j
  where j.company_id = p_company_id
    and j.assigned_employee_ids @> array[p_employee_id];
$$;

drop function if exists public.employee_get_incidents_for_employee(bigint, bigint);
create or replace function public.employee_get_incidents_for_employee(
  p_company_id bigint,
  p_employee_id bigint
)
returns setof public.incidents
language sql
stable
security definer
set search_path = public
as $$
  select i.*
  from public.incidents i
  where i.company_id = p_company_id
    and i.employee_id = p_employee_id
  order by i.created_at desc;
$$;

drop function if exists public.employee_insert_incident(bigint, bigint, text, bigint, bigint, text, text, timestamptz, text[]);
create or replace function public.employee_insert_incident(
  p_company_id bigint,
  p_employee_id bigint,
  p_employee_code text default null,
  p_job_id bigint default null,
  p_site_id bigint default null,
  p_description text default null,
  p_severity text default null,
  p_created_at timestamptz default now(),
  p_photo_urls text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id bigint;
begin
  select e.id into v_employee_id
  from public.employees e
  where e.company_id = p_company_id
    and (
      (p_employee_id is not null and e.id = p_employee_id) or
      (p_employee_id is null and p_employee_code is not null and e.employee_code = p_employee_code)
    )
  limit 1;

  if v_employee_id is null then
    raise exception 'Employee not found for this company';
  end if;

  insert into public.incidents (
    company_id,
    employee_id,
    job_id,
    site_id,
    description,
    severity,
    created_at,
    photo_urls
  )
  values (
    p_company_id,
    v_employee_id,
    p_job_id,
    p_site_id,
    coalesce(p_description, ''),
    p_severity,
    coalesce(p_created_at, now()),
    coalesce(p_photo_urls, '{}')
  );
end;
$$;

drop function if exists public.employee_get_job_card_for_job(bigint, bigint, bigint);
create or replace function public.employee_get_job_card_for_job(
  p_company_id bigint,
  p_job_id bigint,
  p_employee_id bigint default null
)
returns public.job_cards
language sql
stable
security definer
set search_path = public
as $$
  select jc.*
  from public.job_cards jc
  join public.jobs j on j.id = jc.job_id and j.company_id = jc.company_id
  where jc.company_id = p_company_id
    and jc.job_id = p_job_id
    and (
      p_employee_id is null
      or j.assigned_employee_ids @> array[p_employee_id]
    )
  limit 1;
$$;

drop function if exists public.employee_upsert_job_card(bigint, bigint, bigint, timestamptz, timestamptz, text, text, text, text[], text);
create or replace function public.employee_upsert_job_card(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_actual_start timestamptz default null,
  p_actual_end timestamptz default null,
  p_work_performed text default null,
  p_materials_used text default null,
  p_notes text default null,
  p_photo_urls text[] default '{}',
  p_customer_signature_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and j.company_id = p_company_id
      and j.assigned_employee_ids @> array[p_employee_id]
  ) then
    raise exception 'Not allowed to edit this job card';
  end if;

  insert into public.job_cards (
    company_id,
    job_id,
    actual_start,
    actual_end,
    work_performed,
    materials_used,
    notes,
    photo_urls,
    customer_signature_url
  )
  values (
    p_company_id,
    p_job_id,
    p_actual_start,
    p_actual_end,
    p_work_performed,
    p_materials_used,
    p_notes,
    coalesce(p_photo_urls, '{}'),
    p_customer_signature_url
  )
  on conflict (company_id, job_id)
  do update set
    actual_start = excluded.actual_start,
    actual_end = excluded.actual_end,
    work_performed = excluded.work_performed,
    materials_used = excluded.materials_used,
    notes = excluded.notes,
    photo_urls = excluded.photo_urls,
    customer_signature_url = excluded.customer_signature_url;
end;
$$;

drop function if exists public.employee_update_job_status(bigint, bigint, bigint, text);
create or replace function public.employee_update_job_status(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('pending', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Invalid job status';
  end if;

  update public.jobs j
  set status = p_status
  where j.id = p_job_id
    and j.company_id = p_company_id
    and j.assigned_employee_ids @> array[p_employee_id];

  if not found then
    raise exception 'Not allowed to update this job';
  end if;
end;
$$;

drop function if exists public.employee_get_inventory_items(bigint, bigint);
create or replace function public.employee_get_inventory_items(
  p_company_id bigint,
  p_employee_id bigint default null
)
returns setof public.inventory_items
language sql
stable
security definer
set search_path = public
as $$
  select i.*
  from public.inventory_items i
  where i.company_id = p_company_id
  order by i.name;
$$;

drop function if exists public.employee_get_inventory_usage_for_job(bigint, bigint, bigint);
create or replace function public.employee_get_inventory_usage_for_job(
  p_company_id bigint,
  p_job_id bigint,
  p_employee_id bigint default null
)
returns setof public.job_inventory_usage
language sql
stable
security definer
set search_path = public
as $$
  select u.*
  from public.job_inventory_usage u
  where u.company_id = p_company_id
    and u.job_id = p_job_id
    and (p_employee_id is null or u.employee_id = p_employee_id);
$$;

drop function if exists public.employee_set_inventory_usage_for_job(bigint, bigint, bigint, jsonb);
create or replace function public.employee_set_inventory_usage_for_job(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_usages jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and j.company_id = p_company_id
      and j.assigned_employee_ids @> array[p_employee_id]
  ) then
    raise exception 'Not allowed to set usage for this job';
  end if;

  create temporary table _old_usage on commit drop as
  select
    u.inventory_item_id,
    sum(u.quantity) as qty
  from public.job_inventory_usage u
  where u.company_id = p_company_id
    and u.job_id = p_job_id
    and u.employee_id = p_employee_id
  group by u.inventory_item_id;

  create temporary table _new_usage on commit drop as
  select
    (x.inventory_item_id)::bigint as inventory_item_id,
    coalesce((x.quantity)::numeric, 0) as qty
  from jsonb_to_recordset(coalesce(p_usages, '[]'::jsonb)) as x(inventory_item_id text, quantity text)
  where coalesce((x.quantity)::numeric, 0) > 0;

  for r in
    select
      coalesce(n.inventory_item_id, o.inventory_item_id) as inventory_item_id,
      coalesce(n.qty, 0) - coalesce(o.qty, 0) as delta
    from _new_usage n
    full outer join _old_usage o
      on o.inventory_item_id = n.inventory_item_id
  loop
    if r.delta > 0 then
      update public.inventory_items i
      set stock_count = i.stock_count - r.delta
      where i.company_id = p_company_id
        and i.id = r.inventory_item_id
        and i.stock_count >= r.delta;

      if not found then
        raise exception 'Insufficient stock for item %', r.inventory_item_id;
      end if;
    elsif r.delta < 0 then
      update public.inventory_items i
      set stock_count = i.stock_count + abs(r.delta)
      where i.company_id = p_company_id
        and i.id = r.inventory_item_id;
    end if;
  end loop;

  delete from public.job_inventory_usage u
  where u.company_id = p_company_id
    and u.job_id = p_job_id
    and u.employee_id = p_employee_id;

  insert into public.job_inventory_usage (
    company_id,
    job_id,
    inventory_item_id,
    quantity,
    employee_id
  )
  select
    p_company_id,
    p_job_id,
    n.inventory_item_id,
    n.qty,
    p_employee_id
  from _new_usage n;
end;
$$;

grant execute on function public.employee_get_jobs_for_employee(bigint, bigint) to anon, authenticated;
grant execute on function public.employee_get_incidents_for_employee(bigint, bigint) to anon, authenticated;
grant execute on function public.employee_insert_incident(bigint, bigint, text, bigint, bigint, text, text, timestamptz, text[]) to anon, authenticated;
grant execute on function public.employee_get_job_card_for_job(bigint, bigint, bigint) to anon, authenticated;
grant execute on function public.employee_upsert_job_card(bigint, bigint, bigint, timestamptz, timestamptz, text, text, text, text[], text) to anon, authenticated;
grant execute on function public.employee_update_job_status(bigint, bigint, bigint, text) to anon, authenticated;
grant execute on function public.employee_get_inventory_items(bigint, bigint) to anon, authenticated;
grant execute on function public.employee_get_inventory_usage_for_job(bigint, bigint, bigint) to anon, authenticated;
grant execute on function public.employee_set_inventory_usage_for_job(bigint, bigint, bigint, jsonb) to anon, authenticated;
