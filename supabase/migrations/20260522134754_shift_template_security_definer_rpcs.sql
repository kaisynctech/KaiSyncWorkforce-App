
-- Upsert (create or update) a shift template, bypassing RLS
create or replace function hr_upsert_shift_template(
    p_id           uuid,
    p_company_id   uuid,
    p_name         text,
    p_start_time   text,
    p_end_time     text,
    p_break_minutes int,
    p_breaks       jsonb
)
returns json language plpgsql security definer set search_path = public
as $$
declare
    v_row employee_shift_templates%rowtype;
begin
    -- Validate caller belongs to this company
    if not exists (
        select 1 from company_relationships
        where user_id = auth.uid()
          and company_id = p_company_id
          and is_active = true
    ) then
        raise exception 'Not authorised for this company';
    end if;

    if p_id is null then
        insert into employee_shift_templates
            (id, company_id, name, start_time, end_time, break_minutes, breaks)
        values
            (gen_random_uuid(), p_company_id, p_name,
             p_start_time::time, p_end_time::time, p_break_minutes, p_breaks)
        returning * into v_row;
    else
        update employee_shift_templates set
            name          = p_name,
            start_time    = p_start_time::time,
            end_time      = p_end_time::time,
            break_minutes = p_break_minutes,
            breaks        = p_breaks
        where id = p_id and company_id = p_company_id
        returning * into v_row;
    end if;

    return row_to_json(v_row);
end;
$$;

grant execute on function hr_upsert_shift_template(uuid, uuid, text, text, text, int, jsonb) to authenticated;

-- Delete a shift template, bypassing RLS
create or replace function hr_delete_shift_template(
    p_id         uuid,
    p_company_id uuid
)
returns void language plpgsql security definer set search_path = public
as $$
begin
    if not exists (
        select 1 from company_relationships
        where user_id = auth.uid()
          and company_id = p_company_id
          and is_active = true
    ) then
        raise exception 'Not authorised for this company';
    end if;

    delete from employee_shift_templates
    where id = p_id and company_id = p_company_id;
end;
$$;

grant execute on function hr_delete_shift_template(uuid, uuid) to authenticated;
;
