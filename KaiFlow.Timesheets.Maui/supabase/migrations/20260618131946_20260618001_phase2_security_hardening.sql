
-- ================================================================
-- Migration: 20260618001_phase2_security_hardening
-- Bundles CF-2, CF-3, CF-5 from the ARCH-001 carry-forward register
-- ================================================================

-- ----------------------------------------------------------------
-- CF-2: Revoke PUBLIC and anon EXECUTE on get_my_role and
--       seed_company_role_permissions. Both currently carry
--       {=X/postgres, anon=X/postgres} which allows unauthenticated
--       callers to invoke them. authenticated and service_role
--       grants are preserved.
-- ----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_my_role(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_role(uuid)
  FROM anon;

REVOKE ALL ON FUNCTION public.seed_company_role_permissions(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_company_role_permissions(uuid)
  FROM anon;

-- Belt-and-suspenders: ensure authenticated retains EXECUTE
GRANT EXECUTE ON FUNCTION public.get_my_role(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_company_role_permissions(uuid)
  TO authenticated;

-- ----------------------------------------------------------------
-- CF-3: Add WITH CHECK to leave_requests_update and
--       payment_approvals_update. Previously only USING was set,
--       leaving the resulting row state unvalidated on UPDATE.
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS leave_requests_update ON public.leave_requests;
CREATE POLICY leave_requests_update ON public.leave_requests
  FOR UPDATE
  USING      (
    company_id = ANY (user_company_ids())
    AND get_my_role(company_id) = ANY (ARRAY['owner','hr','manager'])
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND get_my_role(company_id) = ANY (ARRAY['owner','hr','manager'])
  );

DROP POLICY IF EXISTS payment_approvals_update ON public.payment_approvals;
CREATE POLICY payment_approvals_update ON public.payment_approvals
  FOR UPDATE
  USING      (
    company_id = ANY (user_company_ids())
    AND get_my_role(company_id) = ANY (ARRAY['owner','hr'])
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND get_my_role(company_id) = ANY (ARRAY['owner','hr'])
  );

-- ----------------------------------------------------------------
-- CF-5: Replace the single weak HR peer-promotion guard in
--       set_employee_role with two explicit guards per the product
--       decision: HR may only assign manager/employee; only owner
--       may modify another HR user's role.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_employee_role(
  p_company_id  uuid,
  p_employee_id uuid,
  p_new_role    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role  text;
  v_target_role  text;
  v_target_user  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Validate the new role value ('owner' rejected; use transfer_company_ownership)
  IF p_new_role NOT IN ('hr', 'manager', 'employee') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: role "%" is not assignable via set_employee_role', p_new_role
      USING ERRCODE = 'P0001';
  END IF;

  v_caller_role := get_my_role(p_company_id);

  IF v_caller_role NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: caller does not have permission to change employee roles'
      USING ERRCODE = 'P0001';
  END IF;

  -- Fetch current target role and user_id
  SELECT e.access_level, e.user_id
  INTO v_target_role, v_target_user
  FROM employees e
  WHERE e.id         = p_employee_id
    AND e.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company'
      USING ERRCODE = 'P0002';
  END IF;

  -- Cannot modify an owner's role through this function
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_OWNER: owner role can only be changed via transfer_company_ownership'
      USING ERRCODE = 'P0001';
  END IF;

  -- CF-5 guard A: HR callers may only assign manager or employee
  IF v_caller_role = 'hr' AND p_new_role NOT IN ('manager', 'employee') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: hr may only assign manager or employee roles'
      USING ERRCODE = 'P0001';
  END IF;

  -- CF-5 guard B: only owner may modify an existing HR user's role
  IF v_target_role = 'hr' AND v_caller_role != 'owner' THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only owner can modify an hr user''s role'
      USING ERRCODE = 'P0001';
  END IF;

  -- Update the employee's access level (trigger syncs company_relationships)
  UPDATE employees
  SET    access_level = p_new_role
  WHERE  id           = p_employee_id
    AND  company_id   = p_company_id;

  -- Sync company_relationships directly (belt-and-suspenders)
  IF v_target_user IS NOT NULL THEN
    UPDATE company_relationships
    SET    role       = p_new_role
    WHERE  user_id    = v_target_user
      AND  company_id = p_company_id;
  END IF;
END;
$$;

-- Ensure set_employee_role itself has no PUBLIC/anon grant
REVOKE ALL ON FUNCTION public.set_employee_role(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_employee_role(uuid, uuid, text) FROM anon;
;
