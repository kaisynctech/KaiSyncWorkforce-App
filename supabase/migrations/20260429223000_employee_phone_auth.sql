-- ============================================================
-- Employee phone-based authentication linkage
-- - Adds employees.phone
-- - Extends profile linking to match by email or phone
-- - Extends get_my_employee_companies() to return emp_phone
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS phone text;
CREATE INDEX IF NOT EXISTS idx_employees_phone
  ON public.employees (phone)
  WHERE phone IS NOT NULL;
-- Link current auth user to employee rows by email OR phone.
-- Phone comparison normalizes to digits only to tolerate formatting.
CREATE OR REPLACE FUNCTION public.link_employee_profile()
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE sql AS $$
  UPDATE public.employees e
  SET
    profile_id = auth.uid(),
    invite_status = CASE
      WHEN invite_status IN ('sent', 'expired', 'not_sent') THEN 'accepted'
      ELSE invite_status
    END
  FROM auth.users u
  WHERE u.id = auth.uid()
    AND e.profile_id IS NULL
    AND (
      (
        e.email IS NOT NULL
        AND u.email IS NOT NULL
        AND lower(e.email) = lower(u.email)
      )
      OR (
        e.phone IS NOT NULL
        AND u.phone IS NOT NULL
        AND regexp_replace(e.phone, '[^0-9]+', '', 'g')
          = regexp_replace(u.phone, '[^0-9]+', '', 'g')
      )
    );
$$;
DROP FUNCTION IF EXISTS public.get_my_employee_companies();
CREATE FUNCTION public.get_my_employee_companies()
RETURNS TABLE(
  employee_id           text,
  employee_code         text,
  emp_name              text,
  emp_surname           text,
  employment_date       text,
  employment_type       text,
  employment_type_label text,
  emp_position          text,
  monthly_salary        numeric,
  hourly_rate           numeric,
  work_days_weekly      numeric,
  daily_hours           numeric,
  branch                text,
  manager_user_id       text,
  access_level          text,
  emp_email             text,
  emp_phone             text,
  profile_id            uuid,
  company_id            text,
  company_name          text,
  company_code          text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql AS $$
  SELECT
    e.id::text,
    COALESCE(e.employee_code, ''),
    COALESCE(e.name, ''),
    COALESCE(e.surname, ''),
    COALESCE(e.employment_date::text, ''),
    COALESCE(e.employment_type, ''),
    e.employment_type_label,
    COALESCE(e.position, '') AS emp_position,
    COALESCE(e.monthly_salary, 0)::numeric,
    COALESCE(e.hourly_rate, 0)::numeric,
    COALESCE(e.work_days_weekly, 5)::numeric,
    COALESCE(e.daily_hours, 8)::numeric,
    COALESCE(e.branch, ''),
    e.manager_user_id::text,
    COALESCE(e.access_level, 'employee'),
    e.email,
    e.phone,
    e.profile_id,
    c.id::text,
    c.name,
    c.company_code
  FROM public.employees e
  JOIN public.companies c ON e.company_id = c.id
  LEFT JOIN auth.users au ON au.id = auth.uid()
  WHERE
    e.profile_id = auth.uid()
    OR (
      e.email IS NOT NULL
      AND au.email IS NOT NULL
      AND lower(e.email) = lower(au.email)
    )
    OR (
      e.phone IS NOT NULL
      AND au.phone IS NOT NULL
      AND regexp_replace(e.phone, '[^0-9]+', '', 'g')
        = regexp_replace(au.phone, '[^0-9]+', '', 'g')
    );
$$;
GRANT EXECUTE ON FUNCTION public.get_my_employee_companies() TO authenticated;
