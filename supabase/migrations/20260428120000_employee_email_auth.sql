-- ============================================================
-- Employee email-based authentication
-- Adds email + profile_id to employees, creates employee_profiles
-- table, and two SECURITY DEFINER helpers used by the Flutter app.
-- ============================================================

-- 1. Extend employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS email       text,
  ADD COLUMN IF NOT EXISTS profile_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employees_email
  ON employees(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_profile_id
  ON employees(profile_id) WHERE profile_id IS NOT NULL;
-- 2. Employee global identity table (one row per auth user)
CREATE TABLE IF NOT EXISTS employee_profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  name        text,
  surname     text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emp_profile_select_own"  ON employee_profiles
  FOR SELECT  USING (auth.uid() = id);
CREATE POLICY "emp_profile_insert_own"  ON employee_profiles
  FOR INSERT  WITH CHECK (auth.uid() = id);
CREATE POLICY "emp_profile_update_own"  ON employee_profiles
  FOR UPDATE  USING (auth.uid() = id);
-- HR managers can read profiles for employees in their company
CREATE POLICY "hr_read_emp_profiles" ON employee_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hr_users
      WHERE auth_user_id = auth.uid() AND is_active = true
    )
  );
-- 3. Link current auth user to their employee records by email
--    Called right after sign-in / sign-up from the Flutter app.
CREATE OR REPLACE FUNCTION link_employee_profile()
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE sql AS $$
  UPDATE employees
  SET    profile_id = auth.uid()
  WHERE  lower(email) = lower(
           (SELECT email FROM auth.users WHERE id = auth.uid())
         )
    AND  profile_id IS NULL;
$$;
-- 4. Return all company contexts for the signed-in employee
CREATE OR REPLACE FUNCTION get_my_employee_companies()
RETURNS TABLE(
  employee_id          text,
  employee_code        text,
  emp_name             text,
  emp_surname          text,
  employment_date      text,
  employment_type      text,
  employment_type_label text,
  emp_position         text,
  monthly_salary       numeric,
  hourly_rate          numeric,
  work_days_weekly     numeric,
  daily_hours          numeric,
  branch               text,
  manager_user_id      text,
  access_level         text,
  emp_email            text,
  profile_id           uuid,
  company_id           text,
  company_name         text,
  company_code         text
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
    e.profile_id,
    c.id::text,
    c.name,
    c.company_code
  FROM  employees e
  JOIN  companies c ON e.company_id = c.id
  WHERE e.profile_id = auth.uid()
     OR lower(e.email) = lower(
          (SELECT au.email FROM auth.users au WHERE au.id = auth.uid())
        );
$$;
