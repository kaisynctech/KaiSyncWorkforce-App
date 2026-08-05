
alter table payment_approvals
    add column if not exists shared_with_employee boolean not null default false;

create or replace function employee_get_payslips(
    p_company_id  uuid,
    p_employee_id uuid
)
returns json language plpgsql security definer set search_path = public
as $$
declare v_emp employees%rowtype;
begin
    select * into v_emp from employees
    where id = p_employee_id and company_id = p_company_id and is_active = true;
    if not found then raise exception 'Employee not found'; end if;

    return (
        select coalesce(json_agg(row_to_json(p) order by p.period_start desc), '[]'::json)
        from payment_approvals p
        where p.employee_id = p_employee_id
          and p.company_id  = p_company_id
          and p.shared_with_employee = true
    );
end; $$;

grant execute on function employee_get_payslips(uuid, uuid) to anon, authenticated;
;
