-- Payslip bank edits use update_employee_banking.
-- Company Admin was given HR-level people access, but this function
-- still allowed only owner and hr.

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

  IF NOT public.role_is_hr_or_above(get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner, admin, or hr required to update banking details'
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
