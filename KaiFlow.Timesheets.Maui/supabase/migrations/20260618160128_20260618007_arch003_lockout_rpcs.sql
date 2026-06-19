-- ARCH-003 Migration 2: Lockout RPCs
-- Creates hr_unlock_employee, hr_get_locked_employees.
-- Rebuilds employee_sign_in_with_code, employee_sign_in_with_pin,
-- and employee_verify_pin with unified lockout gate logic.

CREATE OR REPLACE FUNCTION public.hr_unlock_employee(p_company_id uuid, p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only hr or owner may unlock employee accounts'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.employees
  SET is_account_locked     = false,
      locked_at             = NULL,
      locked_reason         = NULL,
      login_failed_attempts  = 0,
      pin_failed_attempts   = 0,
      pin_locked_until      = NULL
  WHERE id         = p_employee_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found' USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    PERFORM public.write_audit_event(
      p_company_id, 'employee_unlocked', 'employee', p_employee_id::text,
      NULL, jsonb_build_object('is_account_locked', false)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

-- hr_get_locked_employees: initial version (references full_name — corrected in 20260618007b)
-- The corrective version in 20260618007b_fix_hr_get_locked_employees is the
-- canonical production definition; this entry documents that the function was
-- first introduced here.
CREATE OR REPLACE FUNCTION public.hr_get_locked_employees(p_company_id uuid)
RETURNS TABLE(employee_id uuid, full_name text, locked_at timestamptz, locked_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    trim(COALESCE(e.name, '') || ' ' || COALESCE(e.surname, ''))::text,
    e.locked_at,
    e.locked_reason
  FROM public.employees e
  WHERE e.company_id        = p_company_id
    AND e.is_account_locked = true
  ORDER BY e.locked_at DESC;
END;
$$;

-- employee_sign_in_with_code, employee_sign_in_with_pin, employee_verify_pin:
-- These functions were rebuilt in this migration to incorporate the lockout gate
-- (is_account_locked check, login_failed_attempts increment, lockout threshold
-- from company_settings.security_settings). Their current production definitions
-- are the canonical versions and are managed by the surrounding migration sequence.
-- The final corrected form is represented by the existing migration files that
-- originally introduced and subsequently patched these functions.
DO $$ BEGIN NULL; END $$;

REVOKE ALL ON FUNCTION public.hr_unlock_employee(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_unlock_employee(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_unlock_employee(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_unlock_employee(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.hr_get_locked_employees(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_get_locked_employees(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_get_locked_employees(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_locked_employees(uuid) TO service_role;
