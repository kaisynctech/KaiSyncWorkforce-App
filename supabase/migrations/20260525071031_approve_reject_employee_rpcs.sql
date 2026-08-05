
create or replace function approve_pending_employee(p_employee_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
    update employees
    set registration_status = 'active', is_active = true
    where id = p_employee_id;
end; $$;

grant execute on function approve_pending_employee(uuid) to authenticated;

create or replace function reject_pending_employee(p_employee_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
    update employees
    set registration_status = 'rejected'
    where id = p_employee_id;
end; $$;

grant execute on function reject_pending_employee(uuid) to authenticated;
;
