-- ARCH-001 Migration 2: Role-Enforced Write RPCs
-- Creates/replaces set_employee_role, approve_payment_run,
-- transfer_company_ownership, update_employee_banking with role enforcement.

CREATE OR REPLACE FUNCTION public.set_employee_role(p_company_id uuid, p_employee_id uuid, p_new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role  text;
  v_target_role  text;
  v_target_user  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_role NOT IN ('hr', 'manager', 'employee') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: role "%" is not assignable via set_employee_role', p_new_role
      USING ERRCODE = 'P0001';
  END IF;

  v_caller_role := get_my_role(p_company_id);

  IF v_caller_role NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: caller does not have permission to change employee roles'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT e.access_level, e.user_id
  INTO v_target_role, v_target_user
  FROM employees e
  WHERE e.id         = p_employee_id
    AND e.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_OWNER: owner role can only be changed via transfer_company_ownership'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_caller_role = 'hr' AND p_new_role NOT IN ('manager', 'employee') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: hr may only assign manager or employee roles'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_target_role = 'hr' AND v_caller_role != 'owner' THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only owner can modify an hr user''s role'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE employees
  SET    access_level = p_new_role
  WHERE  id           = p_employee_id
    AND  company_id   = p_company_id;

  IF v_target_user IS NOT NULL THEN
    UPDATE company_relationships
    SET    role       = p_new_role
    WHERE  user_id    = v_target_user
      AND  company_id = p_company_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.approve_payment_run(p_company_id uuid, p_payment_approval_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    IF NOT user_has_permission(p_company_id, 'payments.approve') THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: payments.approve permission required'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.hr_check_step_up_valid(p_company_id) THEN
        RAISE EXCEPTION 'STEP_UP_REQUIRED: step-up verification required'
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

    BEGIN
        PERFORM write_audit_event(
            p_company_id,
            'payment.approved',
            'payment_approval',
            p_payment_approval_id::text,
            jsonb_build_object('status', 'pending'),
            jsonb_build_object('status', 'approved')
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_company_ownership(p_company_id uuid, p_target_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_role    text;
    v_target_user_id uuid;
    v_current_owner  uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    v_caller_role := get_my_role(p_company_id);

    IF v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: only the current owner can transfer ownership'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.hr_check_step_up_valid(p_company_id) THEN
        RAISE EXCEPTION 'STEP_UP_REQUIRED: step-up verification required'
            USING ERRCODE = 'P0001';
    END IF;

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
        RAISE EXCEPTION 'Cannot transfer ownership to yourself' USING ERRCODE = 'P0001';
    END IF;

    SELECT owner_user_id INTO v_current_owner
    FROM companies
    WHERE id = p_company_id;

    UPDATE employees
    SET access_level = 'hr'
    WHERE company_id = p_company_id
      AND user_id    = v_current_owner;

    UPDATE company_relationships
    SET role = 'hr'
    WHERE company_id = p_company_id
      AND user_id    = v_current_owner;

    UPDATE employees
    SET access_level = 'owner'
    WHERE id         = p_target_employee_id
      AND company_id = p_company_id;

    UPDATE company_relationships
    SET role = 'owner'
    WHERE company_id = p_company_id
      AND user_id    = v_target_user_id;

    UPDATE companies
    SET owner_user_id = v_target_user_id
    WHERE id = p_company_id;

    BEGIN
        PERFORM write_audit_event(
            p_company_id,
            'company.ownership_transferred',
            'company',
            p_company_id::text,
            NULL,
            NULL,
            jsonb_build_object(
                'previous_owner_user_id', v_current_owner,
                'new_owner_user_id',      v_target_user_id,
                'new_owner_employee_id',  p_target_employee_id
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_banking(p_company_id uuid, p_employee_id uuid, p_bank_account text DEFAULT NULL, p_bank_name text DEFAULT NULL, p_bank_branch_code text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_before jsonb;
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

    SELECT jsonb_build_object(
        'bank_account',     bank_account,
        'bank_name',        bank_name,
        'bank_branch_code', bank_branch_code
    ) INTO v_before
    FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
    END IF;

    UPDATE employees
    SET bank_account              = p_bank_account,
        bank_name                 = p_bank_name,
        bank_branch_code          = p_bank_branch_code,
        bank_details_updated_at   = now(),
        bank_details_updated_by   = 'hr'
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
                'bank_branch_code', p_bank_branch_code
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_role(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_employee_role(uuid,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_employee_role(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_role(uuid,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.approve_payment_run(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_payment_run(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_payment_run(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payment_run(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.transfer_company_ownership(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_company_ownership(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_company_ownership(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_company_ownership(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.update_employee_banking(uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employee_banking(uuid,uuid,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_employee_banking(uuid,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_banking(uuid,uuid,text,text,text) TO service_role;
