
-- Add punched_by_manager_id to time_punches
alter table time_punches
    add column if not exists punched_by_manager_id uuid references auth.users(id);

-- Update employee_insert_punch to accept the optional manager param
create or replace function employee_insert_punch(
    p_company_id  uuid,
    p_employee_id uuid,
    p_type        text,
    p_date_time   timestamptz,
    p_latitude    double precision default null,
    p_longitude   double precision default null,
    p_address     text            default null,
    p_job_id      uuid            default null,
    p_notes       text            default null,
    p_punched_by_manager_id uuid  default null
)
returns json language plpgsql security definer set search_path = public
as $$
declare v_punch time_punches;
begin
    insert into time_punches (
        id, company_id, employee_id, type, date_time,
        latitude, longitude, address, job_id, notes, punched_by_manager_id
    ) values (
        gen_random_uuid(), p_company_id, p_employee_id, p_type, p_date_time,
        p_latitude, p_longitude, p_address, p_job_id, p_notes, p_punched_by_manager_id
    ) returning * into v_punch;

    return row_to_json(v_punch);
end; $$;

grant execute on function employee_insert_punch(uuid, uuid, text, timestamptz, double precision, double precision, text, uuid, text, uuid) to anon, authenticated;

-- Helper: get the last punch for a list of employee IDs (for team punch status check)
create or replace function hr_get_employees_last_punch(
    p_company_id   uuid,
    p_employee_ids uuid[]
)
returns json language plpgsql security definer set search_path = public
as $$
begin
    return (
        select coalesce(json_agg(row_to_json(t)), '[]'::json)
        from (
            select distinct on (employee_id)
                id, employee_id, company_id, type, date_time,
                latitude, longitude, address, job_id, notes,
                punched_by_manager_id, created_at
            from time_punches
            where company_id = p_company_id
              and employee_id = any(p_employee_ids)
            order by employee_id, date_time desc
        ) t
    );
end; $$;

grant execute on function hr_get_employees_last_punch(uuid, uuid[]) to authenticated;
;
