create or replace function public.hr_delete_employee_safe(
  p_company_id bigint,
  p_employee_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_company_id bigint;
begin
  v_my_company_id := current_hr_company_id();
  if v_my_company_id is null or v_my_company_id <> p_company_id then
    raise exception 'Not authorized to delete this employee';
  end if;

  -- Null references that use NO ACTION / RESTRICT and are nullable.
  update public.jobs
    set assignee_employee_id = null
    where company_id = p_company_id and assignee_employee_id = p_employee_id;
  update public.jobs
    set contractor_employee_id = null
    where company_id = p_company_id and contractor_employee_id = p_employee_id;
  update public.document_files
    set employee_id = null
    where company_id = p_company_id and employee_id = p_employee_id;
  update public.form_submissions
    set employee_id = null
    where company_id = p_company_id and employee_id = p_employee_id;
  update public.notification_events
    set target_employee_id = null
    where company_id = p_company_id and target_employee_id = p_employee_id;
  update public.asset_inspections
    set performed_by = null
    where company_id = p_company_id and performed_by = p_employee_id;
  update public.inventory_allocations
    set allocated_by = null
    where company_id = p_company_id and allocated_by = p_employee_id;
  update public.app_messages
    set sender_employee_id = null
    where company_id = p_company_id and sender_employee_id = p_employee_id;
  update public.app_message_threads
    set created_by_employee_id = null
    where company_id = p_company_id and created_by_employee_id = p_employee_id;
  update public.contractor_admin_events
    set actor_employee_id = null
    where company_id = p_company_id and actor_employee_id = p_employee_id;
  update public.pa_tasks
    set owner_employee_id = null
    where company_id = p_company_id and owner_employee_id = p_employee_id;
  update public.shift_events
    set employee_id = null
    where company_id = p_company_id and employee_id = p_employee_id;
  update public.invite_delivery_audit
    set target_employee_id = null
    where company_id = p_company_id and target_employee_id = p_employee_id;

  -- Purge non-nullable historical rows that otherwise block deletion.
  delete from public.punches
    where company_id = p_company_id and employees_id = p_employee_id;
  delete from public.incidents
    where company_id = p_company_id and employee_id = p_employee_id;
  delete from public.job_inventory_usage
    where company_id = p_company_id and employee_id = p_employee_id;

  -- Delete the employee row (remaining CASCADE references clean up automatically).
  delete from public.employees
    where company_id = p_company_id and id = p_employee_id;

  if not found then
    raise exception 'Employee not found in this company';
  end if;
end;
$$;
grant execute on function public.hr_delete_employee_safe(bigint, bigint) to authenticated;
