-- Block clock-in when employee is on approved leave or marked absent for today.

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
    if lower(trim(p_type)) = 'in' then
        if employee_is_on_leave_today(p_company_id, p_employee_id) then
            raise exception 'Employee is on approved leave and cannot clock in';
        end if;

        if exists (
            select 1 from daily_absences
            where company_id  = p_company_id
              and employee_id = p_employee_id
              and date        = current_date
        ) then
            raise exception 'Employee is marked absent and cannot clock in';
        end if;
    end if;

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
