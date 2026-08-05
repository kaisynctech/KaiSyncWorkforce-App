
DROP FUNCTION IF EXISTS public.self_register_company(text, text, text);

CREATE FUNCTION public.self_register_company(
  p_company_name text,
  p_owner_first_name text DEFAULT ''::text,
  p_owner_last_name text DEFAULT ''::text
)
RETURNS TABLE(company_id uuid, company_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid;
  v_code       text;
  v_company_id uuid;
  v_email      text;
  v_fn         text;
  v_ln         text;
  v_ecode      text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'You must be signed in to register a company.';
  end if;

  if p_company_name is null or btrim(p_company_name) = '' then
    raise exception 'Company name is required.';
  end if;

  if exists (
    select 1 from public.company_relationships
    where user_id = v_uid and role = 'owner' and is_active = true
  ) then
    raise exception 'This account is already mapped to a company.';
  end if;

  select email into v_email from auth.users where id = v_uid;

  v_fn := coalesce(nullif(btrim(p_owner_first_name), ''), split_part(v_email, '@', 1));
  v_ln := coalesce(nullif(btrim(p_owner_last_name), ''), '');

  loop
    v_code := lpad(nextval('public.company_code_seq')::text, 4, '0');
    begin
      insert into public.companies (name, code, plan_code, trial_started_at, owner_user_id)
      values (btrim(p_company_name), v_code, 'free_trial', now(), v_uid)
      returning id into v_company_id;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  insert into public.company_relationships (user_id, company_id, role, is_active)
  values (v_uid, v_company_id, 'owner', true);

  v_ecode := v_code || '-OWNER';
  insert into public.employees (
    company_id, name, surname, employee_code,
    employment_type, position,
    monthly_salary, hourly_rate, weekly_rate, daily_rate,
    work_days_weekly, daily_hours, branch,
    access_level, worker_type, user_id, email
  ) values (
    v_company_id, v_fn, v_ln, v_ecode,
    'part-time', 'Company Owner',
    0, 0, 0, 0,
    5, 8, '',
    'owner', 'employee', v_uid, lower(trim(v_email))
  );

  return query select v_company_id, v_code;
end;
$function$;
;
