-- ============================================================
-- ARCH-001 Migration 2: Role-Enforced Write RPCs
-- ============================================================

-- ── 1. user_has_permission ───────────────────────────────────
-- Short-circuits for owner. Queries company_role_permissions
-- for all other roles. Returns false if role is null or key
-- not found.
CREATE OR REPLACE FUNCTION public.user_has_permission(
  p_company_id    uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    text;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  v_role := get_my_role(p_company_id);

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Owners have all permissions — short-circuit
  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  SELECT allowed
  INTO v_allowed
  FROM company_role_permissions
  WHERE company_id    = p_company_id
    AND role          = v_role
    AND permission_key = p_permission_key
  LIMIT 1;

  RETURN COALESCE(v_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;


-- ── 2. set_employee_role ─────────────────────────────────────
-- Validates the caller's role before changing another employee's
-- role. Owner assignment is unconditionally rejected here —
-- that path goes through transfer_company_ownership only.
CREATE OR REPLACE FUNCTION public.set_employee_role(
  p_company_id   uuid,
  p_employee_id  uuid,
  p_new_role     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  text;
  v_target_role  text;
  v_target_user  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Validate the new role value
  IF p_new_role NOT IN ('hr', 'manager', 'employee') THEN
    -- 'owner' is explicitly rejected here; use transfer_company_ownership
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

  -- Cannot promote target to the same level as caller (if caller is hr and target would become hr)
  -- Owner callers may freely assign any role except owner
  IF v_caller_role = 'hr' AND p_new_role = 'hr' AND v_target_role != 'hr' THEN
    RAISE EXCEPTION 'CANNOT_PROMOTE_TO_OWN_LEVEL: an hr user cannot promote another to hr'
      USING ERRCODE = 'P0001';
  END IF;

  -- Update the employee's access level (trigger syncs company_relationships)
  UPDATE employees
  SET access_level = p_new_role
  WHERE id         = p_employee_id
    AND company_id = p_company_id;

  -- Sync company_relationships directly (belt-and-suspenders for users without employee row)
  IF v_target_user IS NOT NULL THEN
    UPDATE company_relationships
    SET role = p_new_role
    WHERE user_id   = v_target_user
      AND company_id = p_company_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_role(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employee_role(uuid, uuid, text) TO authenticated;


-- ── 3. approve_payment_run ───────────────────────────────────
-- Server-enforced approval: verifies payments.approve permission
-- before updating the payment_approvals status to 'approved'.
CREATE OR REPLACE FUNCTION public.approve_payment_run(
  p_company_id          uuid,
  p_payment_approval_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT user_has_permission(p_company_id, 'payments.approve') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: payments.approve permission required'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE payment_approvals
  SET status = 'approved'
  WHERE id         = p_payment_approval_id
    AND company_id = p_company_id
    AND status     = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment approval not found, not pending, or does not belong to this company'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payment_run(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_payment_run(uuid, uuid) TO authenticated;


-- ── 4. transfer_company_ownership ───────────────────────────
-- The ONLY path that can assign the owner role.
-- Demotes current owner to hr, promotes target to owner,
-- updates companies.owner_user_id.
CREATE OR REPLACE FUNCTION public.transfer_company_ownership(
  p_company_id        uuid,
  p_target_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role     text;
  v_target_user_id  uuid;
  v_current_owner   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  v_caller_role := get_my_role(p_company_id);

  IF v_caller_role != 'owner' THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only the current owner can transfer ownership'
      USING ERRCODE = 'P0001';
  END IF;

  -- Fetch the target employee's user_id
  SELECT user_id INTO v_target_user_id
  FROM employees
  WHERE id         = p_target_employee_id
    AND company_id = p_company_id
    AND is_active  = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target employee not found or is not active in this company'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target employee does not have an associated user account'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot transfer ownership to yourself'
      USING ERRCODE = 'P0001';
  END IF;

  -- Get the current owner_user_id from companies
  SELECT owner_user_id INTO v_current_owner
  FROM companies
  WHERE id = p_company_id;

  -- Demote current owner → hr (employees table)
  UPDATE employees
  SET access_level = 'hr'
  WHERE company_id = p_company_id
    AND user_id    = v_current_owner;

  -- Demote current owner → hr (company_relationships)
  UPDATE company_relationships
  SET role = 'hr'
  WHERE company_id = p_company_id
    AND user_id    = v_current_owner;

  -- Promote target → owner (employees table)
  UPDATE employees
  SET access_level = 'owner'
  WHERE id         = p_target_employee_id
    AND company_id = p_company_id;

  -- Promote target → owner (company_relationships)
  UPDATE company_relationships
  SET role = 'owner'
  WHERE company_id = p_company_id
    AND user_id    = v_target_user_id;

  -- Update the authoritative owner pointer on companies
  UPDATE companies
  SET owner_user_id = v_target_user_id
  WHERE id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_company_ownership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_company_ownership(uuid, uuid) TO authenticated;;
