
create or replace function public.employee_get_leave_requests(
    p_company_id  uuid,
    p_employee_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_emp public.employees%rowtype;
begin
    select * into v_emp
    from public.employees
    where id = p_employee_id
      and company_id = p_company_id
      and is_active = true;

    if not found then
        raise exception 'Employee not found in company';
    end if;

    return (
        select coalesce(
            json_agg(row_to_json(r) order by r.created_at desc),
            '[]'::json
        )
        from public.leave_requests r
        where r.employee_id = p_employee_id
          and r.company_id  = p_company_id
    );
end;
$$;

grant execute on function public.employee_get_leave_requests(uuid, uuid) to anon;
grant execute on function public.employee_get_leave_requests(uuid, uuid) to authenticated;
;
