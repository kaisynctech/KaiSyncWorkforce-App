
-- Add registration_status to employees table
alter table employees add column if not exists registration_status text not null default 'active';
create index if not exists idx_employees_pending on employees(company_id, registration_status) where registration_status = 'pending';

-- RPC: employee_self_register
create or replace function employee_self_register(
    p_user_id uuid,
    p_email text,
    p_first_name text,
    p_last_name text,
    p_company_code text
) returns json language plpgsql security definer set search_path = public as $$
declare
    v_company companies%rowtype;
    v_employee employees%rowtype;
begin
    select * into v_company from companies where code = upper(trim(p_company_code));
    if not found then raise exception 'Company not found'; end if;

    select * into v_employee from employees
    where company_id = v_company.id and lower(email) = lower(p_email) and is_active = true;

    if found then
        update employees
        set user_id = p_user_id, registration_status = 'active'
        where id = v_employee.id;
        return json_build_object(
            'status', 'linked',
            'employee_id', v_employee.id,
            'company_id', v_company.id,
            'access_level', v_employee.access_level
        );
    else
        insert into employees (
            id, company_id, user_id, name, surname, email,
            is_active, registration_status, access_level, employment_type, worker_type
        )
        values (
            gen_random_uuid(), v_company.id, p_user_id, p_first_name, p_last_name, p_email,
            false, 'pending', 'employee', 'permanent', 'employee'
        )
        returning * into v_employee;

        return json_build_object(
            'status', 'pending',
            'employee_id', v_employee.id,
            'company_id', v_company.id,
            'company_name', v_company.name
        );
    end if;
end; $$;

grant execute on function employee_self_register(uuid, text, text, text, text) to authenticated;

-- RPC: employee_update_profile
create or replace function employee_update_profile(
    p_employee_id uuid,
    p_company_id uuid,
    p_first_name text default null,
    p_last_name text default null,
    p_phone text default null,
    p_id_number text default null,
    p_bank_account text default null,
    p_bank_name text default null,
    p_bank_branch_code text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
    v_emp employees%rowtype;
begin
    perform 1 from employees where id = p_employee_id and company_id = p_company_id;
    if not found then raise exception 'Employee not found'; end if;

    update employees set
        name            = coalesce(p_first_name,     name),
        surname         = coalesce(p_last_name,      surname),
        phone           = coalesce(p_phone,          phone),
        id_number       = coalesce(p_id_number,      id_number),
        bank_account    = coalesce(p_bank_account,   bank_account),
        bank_name       = coalesce(p_bank_name,      bank_name),
        bank_branch_code = coalesce(p_bank_branch_code, bank_branch_code)
    where id = p_employee_id
    returning * into v_emp;

    return row_to_json(v_emp);
end; $$;

grant execute on function employee_update_profile(uuid, uuid, text, text, text, text, text, text, text) to anon, authenticated;
;
