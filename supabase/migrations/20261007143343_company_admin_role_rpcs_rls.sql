-- 20261007143343_company_admin_role_rpcs_rls
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.set_employee_role(
  p_company_id uuid,
  p_employee_id uuid,
  p_new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF p_new_role NOT IN ('admin', 'hr', 'manager', 'employee') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: role "%" is not assignable via set_employee_role', p_new_role
      USING ERRCODE = 'P0001';
  END IF;

  v_caller_role := get_my_role(p_company_id);

  IF NOT public.role_is_hr_or_above(v_caller_role) THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: caller does not have permission to change employee roles'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT e.access_level, e.user_id
  INTO v_target_role, v_target_user
  FROM employees e
  WHERE e.id = p_employee_id
    AND e.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_OWNER: owner role can only be changed via transfer_company_ownership'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_new_role = 'admin' AND v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only the company Owner can assign Admin'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target_role = 'admin' AND v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only the company Owner can modify an Admin'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_caller_role = 'hr' AND p_new_role NOT IN ('manager', 'employee') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: hr may only assign manager or employee roles'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_caller_role = 'admin' AND p_new_role NOT IN ('hr', 'manager', 'employee') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: Admin may only assign HR, manager, or employee'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target_role = 'hr' AND NOT public.role_is_owner_or_admin(v_caller_role) THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only Owner or Admin can modify an HR user''s role'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE employees
  SET access_level = p_new_role
  WHERE id = p_employee_id
    AND company_id = p_company_id;

  IF v_target_user IS NOT NULL THEN
    UPDATE company_relationships
    SET role = p_new_role
    WHERE user_id = v_target_user
      AND company_id = p_company_id;
  END IF;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'employee.role_changed',
      'employee',
      p_employee_id::text,
      jsonb_build_object('role', v_target_role),
      jsonb_build_object('role', p_new_role)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

DROP POLICY IF EXISTS employees_update ON public.employees;
CREATE POLICY employees_update ON public.employees
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND public.role_is_hr_or_above(get_my_role(company_id))
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND public.role_is_hr_or_above(get_my_role(company_id))
  );

DROP POLICY IF EXISTS employees_delete ON public.employees;
CREATE POLICY employees_delete ON public.employees
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND public.role_is_owner_or_admin(get_my_role(company_id))
  );

DROP POLICY IF EXISTS payment_approvals_select ON public.payment_approvals;
CREATE POLICY payment_approvals_select ON public.payment_approvals
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND public.role_is_hr_or_above(get_my_role(company_id))
  );

DROP POLICY IF EXISTS payment_approvals_update ON public.payment_approvals;
CREATE POLICY payment_approvals_update ON public.payment_approvals
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND public.role_is_hr_or_above(get_my_role(company_id))
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND public.role_is_hr_or_above(get_my_role(company_id))
  );

DROP POLICY IF EXISTS payment_approvals_delete ON public.payment_approvals;
CREATE POLICY payment_approvals_delete ON public.payment_approvals
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND public.role_is_hr_or_above(get_my_role(company_id))
  );

CREATE OR REPLACE FUNCTION public.set_company_enabled_modules(
  p_company_id uuid,
  p_modules jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_access text;
  v_eff text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_company_id IS NULL OR p_modules IS NULL OR jsonb_typeof(p_modules) <> 'object' THEN
    RAISE EXCEPTION 'Invalid modules payload';
  END IF;

  v_role := public.get_my_role(p_company_id);

  SELECT e.access_level INTO v_access
  FROM public.employees e
  WHERE e.user_id = v_uid
    AND e.company_id = p_company_id
    AND e.is_active = true
  LIMIT 1;

  v_eff := coalesce(v_role, v_access);

  IF NOT public.role_is_hr_or_above(v_eff) THEN
    RAISE EXCEPTION 'INSUFFICIENT_PERMISSION: only owner, admin, or HR can change modules'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.companies
  SET enabled_modules = p_modules
  WHERE id = p_company_id
    AND id = ANY (public.user_company_ids());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found or not accessible';
  END IF;

  RETURN p_modules;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_company_admin_permissions(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
  SELECT p_company_id, 'admin', permission_key, allowed
  FROM public.company_role_permissions
  WHERE company_id = p_company_id
    AND role = 'owner'
  ON CONFLICT (company_id, role, permission_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_admin_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_company_admin_permissions(uuid) TO authenticated;
