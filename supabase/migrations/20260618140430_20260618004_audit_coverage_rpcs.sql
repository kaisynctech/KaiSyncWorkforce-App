-- ═══════════════════════════════════════════════════════════════════════════════
-- ARCH-002 Migration 3 — Audit Coverage RPCs
-- SF-2 fix: approve_pending_employee, reject_pending_employee (legacy role strings)
-- Rebuild: hr_delete_employee_safe (references dropped hr_users table)
-- New RPCs: decide_leave_request, update_employee_banking, set_employee_active,
--           delete_employee, reject_payment_run
-- All RPCs include non-blocking audit hooks (BR-2 pattern).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── SF-2 Fix 1: approve_pending_employee ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_pending_employee(p_employee_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_emp     employees%ROWTYPE;
  v_company companies%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- SF-2 fix: replace legacy access_level self-join with get_my_role
  IF get_my_role(v_emp.company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'Not authorized to approve this registration';
  END IF;

  UPDATE employees
  SET registration_status  = 'active',
      is_active            = true,
      login_password_ready = true
  WHERE id = p_employee_id;

  IF v_emp.user_id IS NOT NULL THEN
    INSERT INTO company_relationships (user_id, company_id, role, is_active)
    VALUES (v_emp.user_id, v_emp.company_id, 'employee', true)
    ON CONFLICT (user_id, company_id)
    DO UPDATE SET is_active = true, role = 'employee';

    SELECT * INTO v_company FROM companies WHERE id = v_emp.company_id;

    INSERT INTO app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data
    ) VALUES (
      v_emp.company_id, 'employee', v_emp.user_id, p_employee_id,
      'registration_approved',
      'Welcome to ' || coalesce(v_company.name, 'your company'),
      'Your account at ' || coalesce(v_company.name, 'this company') ||
        ' has been approved. Open My Companies to get started.',
      'employee', p_employee_id::text,
      'registration_approved:' || p_employee_id::text,
      jsonb_build_object(
        'company_id',   v_emp.company_id,
        'employee_id',  p_employee_id,
        'company_name', v_company.name,
        'company_code', v_company.code
      )
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;

  BEGIN
    PERFORM write_audit_event(
      v_emp.company_id,
      'employee.registration_approved',
      'employee',
      p_employee_id::text,
      jsonb_build_object('registration_status', 'pending'),
      jsonb_build_object('registration_status', 'active')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pending_employee FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pending_employee TO authenticated;

-- ── SF-2 Fix 2: reject_pending_employee ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_pending_employee(p_employee_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_emp     employees%ROWTYPE;
  v_company companies%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- SF-2 fix: replace legacy access_level self-join with get_my_role
  IF get_my_role(v_emp.company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'Not authorized to reject this registration';
  END IF;

  UPDATE employees
  SET registration_status = 'rejected',
      is_active           = false
  WHERE id = p_employee_id;

  IF v_emp.user_id IS NOT NULL THEN
    SELECT * INTO v_company FROM companies WHERE id = v_emp.company_id;

    INSERT INTO app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data
    ) VALUES (
      v_emp.company_id, 'employee', v_emp.user_id, p_employee_id,
      'registration_rejected',
      'Registration declined — ' || coalesce(v_company.name, 'company'),
      'Your request to join ' || coalesce(v_company.name, 'this company') ||
        ' was declined. Contact their HR team if you need help.',
      'employee', p_employee_id::text,
      'registration_rejected:' || p_employee_id::text,
      jsonb_build_object(
        'company_id',   v_emp.company_id,
        'employee_id',  p_employee_id,
        'company_name', v_company.name,
        'company_code', v_company.code
      )
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;

  BEGIN
    PERFORM write_audit_event(
      v_emp.company_id,
      'employee.registration_rejected',
      'employee',
      p_employee_id::text,
      jsonb_build_object('registration_status', 'pending'),
      jsonb_build_object('registration_status', 'rejected')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_pending_employee FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_pending_employee TO authenticated;

-- ── Rebuild: hr_delete_employee_safe ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_delete_employee_safe(
  p_company_id  uuid,
  p_employee_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required to delete employees'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(e) INTO v_before
  FROM employees e
  WHERE e.id = p_employee_id AND e.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.time_punches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  DELETE FROM public.employees
  WHERE company_id = p_company_id AND id = p_employee_id;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'employee.deleted',
      'employee',
      p_employee_id::text,
      v_before,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_delete_employee_safe FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_delete_employee_safe TO authenticated;

-- ── New RPC 1: decide_leave_request ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decide_leave_request(
  p_company_id       uuid,
  p_leave_request_id uuid,
  p_decision         text,
  p_note             text DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_actor_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'Invalid decision "%": must be "approved" or "declined"', p_decision
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT user_has_permission(p_company_id, 'leave.approve') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: leave.approve permission required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Resolve the actor's employee record to stamp approver_hr_user_id
  SELECT id INTO v_actor_employee_id
  FROM employees
  WHERE user_id   = auth.uid()
    AND company_id = p_company_id
    AND is_active  = true
  LIMIT 1;

  UPDATE leave_requests
  SET status              = p_decision,
      decision_note       = p_note,
      decided_at          = now(),
      approver_hr_user_id = v_actor_employee_id
  WHERE id         = p_leave_request_id
    AND company_id = p_company_id
    AND status     = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found, not pending, or does not belong to this company'
      USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'leave.decided',
      'leave_request',
      p_leave_request_id::text,
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', p_decision, 'decision_note', p_note)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_leave_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_leave_request TO authenticated;

-- ── New RPC 2: update_employee_banking ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_employee_banking(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_bank_account     text DEFAULT NULL,
  p_bank_name        text DEFAULT NULL,
  p_bank_branch_code text DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
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

REVOKE ALL ON FUNCTION public.update_employee_banking FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_employee_banking TO authenticated;

-- ── New RPC 3: set_employee_active ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_employee_active(
  p_company_id  uuid,
  p_employee_id uuid,
  p_is_active   boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_current_active boolean;
  v_target_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required to change employee active status'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT is_active, user_id
  INTO v_current_active, v_target_user_id
  FROM employees
  WHERE id = p_employee_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  UPDATE employees
  SET is_active = p_is_active
  WHERE id = p_employee_id AND company_id = p_company_id;

  IF v_target_user_id IS NOT NULL THEN
    UPDATE company_relationships
    SET is_active = p_is_active
    WHERE user_id = v_target_user_id AND company_id = p_company_id;
  END IF;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'employee.active_changed',
      'employee',
      p_employee_id::text,
      jsonb_build_object('is_active', v_current_active),
      jsonb_build_object('is_active', p_is_active)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_active FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employee_active TO authenticated;

-- ── New RPC 4: delete_employee ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_employee(
  p_company_id  uuid,
  p_employee_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required to delete employees'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(e) INTO v_before
  FROM employees e
  WHERE e.id = p_employee_id AND e.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.time_punches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  DELETE FROM public.employees
  WHERE company_id = p_company_id AND id = p_employee_id;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'employee.deleted',
      'employee',
      p_employee_id::text,
      v_before,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_employee FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_employee TO authenticated;

-- ── New RPC 5: reject_payment_run ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_payment_run(
  p_company_id          uuid,
  p_payment_approval_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
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
  SET status = 'rejected'
  WHERE id         = p_payment_approval_id
    AND company_id = p_company_id
    AND status     IN ('pending', 'approved');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment approval not found or does not belong to this company'
      USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'payment.rejected',
      'payment_approval',
      p_payment_approval_id::text,
      NULL,
      jsonb_build_object('status', 'rejected')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_payment_run FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_payment_run TO authenticated;;
