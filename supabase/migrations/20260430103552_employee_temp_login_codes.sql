-- HR-generated temporary login codes for workers without email access.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS temp_login_code text,
  ADD COLUMN IF NOT EXISTS temp_login_code_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS temp_login_code_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_employees_temp_login_code
  ON public.employees(company_id, temp_login_code)
  WHERE temp_login_code IS NOT NULL;

DROP FUNCTION IF EXISTS public.employee_resolve_by_code(text, text);

CREATE OR REPLACE FUNCTION public.employee_resolve_by_code(
  p_company_code text,
  p_employee_code text
)
RETURNS TABLE (
  company_id bigint,
  employee_id bigint,
  employee_code text,
  name text,
  surname text,
  employment_date text,
  employment_type text,
  employment_type_label text,
  "position" text,
  monthly_salary numeric,
  hourly_rate numeric,
  work_days_weekly numeric,
  daily_hours numeric,
  branch text,
  manager_user_id text,
  access_level text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT
    c.id AS company_id,
    e.id AS employee_id,
    COALESCE(e.employee_code, ''),
    COALESCE(e.name, ''),
    COALESCE(e.surname, ''),
    COALESCE(e.employment_date::text, ''),
    COALESCE(e.employment_type, ''),
    COALESCE(e.employment_type_label, e.employment_type, ''),
    COALESCE(e.position, '') AS "position",
    COALESCE(e.monthly_salary, 0)::numeric,
    COALESCE(e.hourly_rate, 0)::numeric,
    COALESCE(e.work_days_weekly, 5)::numeric,
    COALESCE(e.daily_hours, 8)::numeric,
    COALESCE(e.branch, ''),
    e.manager_user_id::text,
    COALESCE(e.access_level, 'employee')
  FROM public.companies c
  JOIN public.employees e ON e.company_id = c.id
  WHERE c.company_code = p_company_code
    AND (
      e.employee_code = p_employee_code
      OR (
        e.temp_login_code = p_employee_code
        AND e.temp_login_code_expires_at IS NOT NULL
        AND e.temp_login_code_expires_at > now()
      )
    )
  ORDER BY
    CASE WHEN e.temp_login_code = p_employee_code THEN 0 ELSE 1 END,
    e.id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.employee_resolve_by_code(text, text)
  TO anon, authenticated;
