
-- Allow employees to log in with their id_number as the login code
CREATE OR REPLACE FUNCTION public.employee_resolve_by_code(p_company_code text, p_employee_code text)
RETURNS TABLE(
    company_id             uuid,
    employee_id            uuid,
    emp_user_id            uuid,
    employee_code          text,
    emp_name               text,
    emp_surname            text,
    employment_date        text,
    employment_type        text,
    emp_position           text,
    monthly_salary         numeric,
    hourly_rate            numeric,
    work_days_weekly       integer,
    daily_hours            numeric,
    emp_branch             text,
    access_level           text,
    login_password_ready   boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id                                            AS company_id,
    e.id                                            AS employee_id,
    e.user_id                                       AS emp_user_id,
    COALESCE(e.employee_code, '')                   AS employee_code,
    COALESCE(e.name, '')                            AS emp_name,
    COALESCE(e.surname, '')                         AS emp_surname,
    COALESCE(e.employment_date::text, '')           AS employment_date,
    COALESCE(e.employment_type, '')                 AS employment_type,
    COALESCE(e.position, '')                        AS emp_position,
    COALESCE(e.monthly_salary, 0)::numeric          AS monthly_salary,
    COALESCE(e.hourly_rate, 0)::numeric             AS hourly_rate,
    COALESCE(e.work_days_weekly, 5)::integer        AS work_days_weekly,
    COALESCE(e.daily_hours, 8)::numeric             AS daily_hours,
    COALESCE(e.branch, '')                          AS emp_branch,
    COALESCE(e.access_level, 'employee')            AS access_level,
    COALESCE(e.login_password_ready, false)         AS login_password_ready
  FROM public.companies c
  JOIN public.employees e ON e.company_id = c.id
  WHERE (
    c.code = p_company_code
    OR (c.code ~ '^\d+$' AND p_company_code ~ '^\d+$'
        AND c.code::bigint = p_company_code::bigint)
  )
  AND (
    e.employee_code = p_employee_code
    OR e.id_number = p_employee_code
    OR (
      e.temp_login_code = p_employee_code
      AND e.temp_login_code_expires_at IS NOT NULL
      AND e.temp_login_code_expires_at > now()
    )
  )
  ORDER BY
    CASE WHEN e.temp_login_code = p_employee_code THEN 0
         WHEN e.employee_code = p_employee_code  THEN 1
         ELSE 2 END,
    e.created_at
  LIMIT 1;
$function$;
;
