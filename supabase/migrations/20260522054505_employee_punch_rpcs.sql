
-- 1. Insert a punch (anon-safe)
create or replace function employee_insert_punch(
    p_company_id  uuid,
    p_employee_id uuid,
    p_type        text,
    p_date_time   timestamptz,
    p_latitude    double precision default null,
    p_longitude   double precision default null,
    p_address     text default null,
    p_job_id      uuid default null,
    p_notes       text default null
)
returns json language plpgsql security definer set search_path = public
as $$
declare
    v_emp employees%rowtype;
    v_row json;
begin
    select * into v_emp from employees
    where id = p_employee_id and company_id = p_company_id and is_active = true;
    if not found then raise exception 'Employee not found'; end if;

    insert into time_punches (id, employee_id, company_id, type, date_time,
                              latitude, longitude, address, job_id, notes, created_at)
    values (gen_random_uuid(), p_employee_id, p_company_id, p_type, p_date_time,
            p_latitude, p_longitude, p_address, p_job_id, p_notes, now())
    returning row_to_json(time_punches.*) into v_row;

    return v_row;
end;
$$;

grant execute on function employee_insert_punch(uuid,uuid,text,timestamptz,double precision,double precision,text,uuid,text) to anon, authenticated;

-- 2. Get the most recent punch for an employee
create or replace function employee_get_last_punch(p_employee_id uuid)
returns json language plpgsql security definer set search_path = public
as $$
declare
    v_row json;
begin
    select row_to_json(tp.*)
    into v_row
    from time_punches tp
    where tp.employee_id = p_employee_id
    order by tp.date_time desc
    limit 1;

    return v_row;
end;
$$;

grant execute on function employee_get_last_punch(uuid) to anon, authenticated;

-- 3. Get punches in a date range for an employee
create or replace function employee_get_my_punches(
    p_company_id  uuid,
    p_employee_id uuid,
    p_from        date,
    p_to          date
)
returns json language plpgsql security definer set search_path = public
as $$
declare
    v_emp employees%rowtype;
begin
    select * into v_emp from employees
    where id = p_employee_id and company_id = p_company_id and is_active = true;
    if not found then raise exception 'Employee not found'; end if;

    return (
        select coalesce(json_agg(row_to_json(tp) order by tp.date_time asc), '[]'::json)
        from time_punches tp
        where tp.employee_id = p_employee_id
          and tp.company_id  = p_company_id
          and tp.date_time::date >= p_from
          and tp.date_time::date <= p_to
    );
end;
$$;

grant execute on function employee_get_my_punches(uuid,uuid,date,date) to anon, authenticated;
;
