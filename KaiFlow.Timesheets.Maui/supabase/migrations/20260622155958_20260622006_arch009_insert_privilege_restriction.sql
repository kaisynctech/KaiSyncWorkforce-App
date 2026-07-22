-- ============================================================
-- ARCH-009 Part B: INSERT Privilege Restriction (CF-6 close)
-- ============================================================

-- ----------------------------------------------------------------
-- employees_insert — restrict access_level to 'employee' on INSERT
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS employees_insert ON public.employees;
CREATE POLICY employees_insert ON public.employees
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = ANY(user_company_ids())
    AND access_level = 'employee'
  );

-- ----------------------------------------------------------------
-- companies_insert — prevent nominating a different owner on INSERT
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS companies_insert ON public.companies;
CREATE POLICY companies_insert ON public.companies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
  );

-- ================================================================
-- Adversarial verification (7 tests)
-- ================================================================
DO $$
DECLARE
  v_failures text[] := '{}';
  v_emp_check text;
  v_co_check  text;
BEGIN
  SELECT with_check INTO v_emp_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'employees'
    AND policyname = 'employees_insert';

  IF v_emp_check IS NULL OR v_emp_check NOT ILIKE '%access_level%' THEN
    v_failures := array_append(v_failures,
      'T1 FAIL: employees_insert WITH CHECK does not reference access_level');
  END IF;
  IF v_emp_check IS NULL OR v_emp_check NOT ILIKE '%employee%' THEN
    v_failures := array_append(v_failures,
      'T2 FAIL: employees_insert WITH CHECK does not restrict to ''employee''');
  END IF;
  IF v_emp_check IS NULL OR v_emp_check NOT ILIKE '%user_company_ids%' THEN
    v_failures := array_append(v_failures,
      'T3 FAIL: employees_insert WITH CHECK does not check company membership');
  END IF;

  SELECT with_check INTO v_co_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'companies'
    AND policyname = 'companies_insert';

  IF v_co_check IS NULL OR v_co_check NOT ILIKE '%owner_user_id%' THEN
    v_failures := array_append(v_failures,
      'T4 FAIL: companies_insert WITH CHECK does not reference owner_user_id');
  END IF;
  IF v_co_check IS NULL OR v_co_check NOT ILIKE '%auth.uid%' THEN
    v_failures := array_append(v_failures,
      'T5 FAIL: companies_insert WITH CHECK does not enforce auth.uid()');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employees'
      AND policyname = 'employees_insert' AND 'authenticated' = ANY(roles)
  ) THEN
    v_failures := array_append(v_failures,
      'T6 FAIL: employees_insert does not apply to authenticated role');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'companies'
      AND policyname = 'companies_insert' AND 'authenticated' = ANY(roles)
  ) THEN
    v_failures := array_append(v_failures,
      'T7 FAIL: companies_insert does not apply to authenticated role');
  END IF;

  IF array_length(v_failures, 1) > 0 THEN
    RAISE EXCEPTION E'ARCH-009 INSERT policy tests FAILED:\n%',
      array_to_string(v_failures, E'\n');
  END IF;
  RAISE NOTICE 'ARCH-009 INSERT policy verification: 7 tests passed';
END;
$$;;
