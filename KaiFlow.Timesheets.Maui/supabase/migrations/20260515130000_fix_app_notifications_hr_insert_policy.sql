set search_path = public;
-- Allow HR users to emit notifications for employees in their own company.
-- Existing policy p_app_notifications_hr only matches audience hr/all rows,
-- which blocks INSERTs for audience='employee' during job creation.
do $$
begin
  if not exists (
    select 1
    from pg_policy
    where polname = 'p_app_notifications_hr_insert'
      and polrelid = 'public.app_notifications'::regclass
  ) then
    create policy p_app_notifications_hr_insert
      on public.app_notifications
      for insert
      with check (
        company_id = current_hr_company_id()
        and (
          (audience = 'employee' and recipient_employee_id is not null)
          or (audience = 'hr' and recipient_auth_user_id is not null)
          or audience = 'all'
        )
      );
  end if;
end
$$;
