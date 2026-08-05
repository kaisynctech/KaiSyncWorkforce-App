-- ============================================================
-- Employees UPDATE parity for web create/edit fields added after
-- ARCH-007, plus account_type on update_employee_banking.
--
-- ARCH-007 granted UPDATE on a fixed column list. Later columns
-- (department, branch_id, manager_id, pay_by_hour) were never
-- granted, so authenticated HR edits fail on any Save that
-- includes them. These are not privilege-escalation targets.
--
-- account_type stays off direct UPDATE (banking surface) and is
-- written only via update_employee_banking (step-up + audit).
-- ============================================================

GRANT UPDATE (
  department,
  branch_id,
  manager_id,
  pay_by_hour
) ON TABLE public.employees TO authenticated;

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.employees', 'bank_account', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated must not UPDATE employees.bank_account';
  END IF;
  IF has_column_privilege('authenticated', 'public.employees', 'account_type', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated must not UPDATE employees.account_type';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.employees', 'department', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated must UPDATE employees.department';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.employees', 'branch_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated must UPDATE employees.branch_id';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.employees', 'manager_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated must UPDATE employees.manager_id';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.employees', 'pay_by_hour', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated must UPDATE employees.pay_by_hour';
  END IF;
END;
$$;

-- Single overload: optional p_account_type (NULL = clear / omit change semantics: we set column)
DROP FUNCTION IF EXISTS public.update_employee_banking(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.update_employee_banking(uuid, uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.update_employee_banking(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_bank_account     text DEFAULT NULL,
  p_bank_name        text DEFAULT NULL,
  p_bank_branch_code text DEFAULT NULL,
  p_account_type     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_account_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required to update banking details'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.hr_check_step_up_valid(p_company_id) THEN
    RAISE EXCEPTION 'STEP_UP_REQUIRED: step-up verification required'
      USING ERRCODE = 'P0001';
  END IF;

  v_account_type := nullif(trim(coalesce(p_account_type, '')), '');
  IF v_account_type IS NOT NULL THEN
    v_account_type := lower(v_account_type);
  END IF;

  SELECT jsonb_build_object(
    'bank_account',     bank_account,
    'bank_name',        bank_name,
    'bank_branch_code', bank_branch_code,
    'account_type',     account_type
  ) INTO v_before
  FROM employees
  WHERE id = p_employee_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  UPDATE employees
  SET bank_account            = p_bank_account,
      bank_name               = p_bank_name,
      bank_branch_code        = p_bank_branch_code,
      account_type            = v_account_type,
      bank_details_updated_at = now(),
      bank_details_updated_by = 'hr'
  WHERE id         = p_employee_id
    AND company_id = p_company_id;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'employee.banking_updated',
      'employee',
      p_employee_id::text,
      v_before,
      jsonb_build_object(
        'bank_account',     p_bank_account,
        'bank_name',        p_bank_name,
        'bank_branch_code', p_bank_branch_code,
        'account_type',     v_account_type
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.update_employee_banking(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employee_banking(uuid, uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_employee_banking(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_banking(uuid, uuid, text, text, text, text) TO service_role;
