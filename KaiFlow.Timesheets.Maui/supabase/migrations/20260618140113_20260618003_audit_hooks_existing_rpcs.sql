-- ═══════════════════════════════════════════════════════════════════════════════
-- ARCH-002 Migration 2 — Non-blocking audit hooks on 5 existing RPCs
-- Adds write_audit_event calls to: set_employee_role, transfer_company_ownership,
-- approve_payment_run, upsert_company_settings, seed_company_role_permissions.
-- All audit writes are wrapped in BEGIN…EXCEPTION to be non-blocking (BR-2).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. set_employee_role ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_employee_role(
  p_company_id  uuid,
  p_employee_id uuid,
  p_new_role    text
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
$$;

REVOKE ALL ON FUNCTION public.set_employee_role FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employee_role TO authenticated;

-- ── 2. transfer_company_ownership ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_company_ownership(
  p_company_id          uuid,
  p_target_employee_id  uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.transfer_company_ownership FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_company_ownership TO authenticated;

-- ── 3. approve_payment_run ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_payment_run(
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
$$;

REVOKE ALL ON FUNCTION public.approve_payment_run FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_payment_run TO authenticated;

-- ── 4. upsert_company_settings ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_company_settings(
  p_company_id uuid,
  p_payload    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_row    public.company_settings%ROWTYPE;
  v_before jsonb;
BEGIN
  IF NOT (public.is_company_owner(p_company_id) OR public.platform_is_admin()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT to_jsonb(cs) INTO v_before
  FROM company_settings cs
  WHERE cs.company_id = p_company_id;

  INSERT INTO public.company_settings (
    company_id, timezone, currency, vat_rate, branding, logo_url,
    primary_color, secondary_color, payroll_preferences, leave_settings, updated_at
  ) VALUES (
    p_company_id,
    coalesce(p_payload->>'timezone', 'Africa/Johannesburg'),
    coalesce(p_payload->>'currency', 'ZAR'),
    coalesce((p_payload->>'vat_rate')::numeric, 15.00),
    coalesce(p_payload->'branding', '{}'::jsonb),
    p_payload->>'logo_url',
    p_payload->>'primary_color',
    p_payload->>'secondary_color',
    coalesce(p_payload->'payroll_preferences', '{}'::jsonb),
    coalesce(p_payload->'leave_settings', '{}'::jsonb),
    now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    timezone            = coalesce(EXCLUDED.timezone,            company_settings.timezone),
    currency            = coalesce(EXCLUDED.currency,            company_settings.currency),
    vat_rate            = coalesce(EXCLUDED.vat_rate,            company_settings.vat_rate),
    branding            = coalesce(EXCLUDED.branding,            company_settings.branding),
    logo_url            = coalesce(EXCLUDED.logo_url,            company_settings.logo_url),
    primary_color       = coalesce(EXCLUDED.primary_color,       company_settings.primary_color),
    secondary_color     = coalesce(EXCLUDED.secondary_color,     company_settings.secondary_color),
    payroll_preferences = coalesce(EXCLUDED.payroll_preferences, company_settings.payroll_preferences),
    leave_settings      = coalesce(EXCLUDED.leave_settings,      company_settings.leave_settings),
    updated_at          = now()
  RETURNING * INTO v_row;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'company.settings_updated',
      'company_settings',
      p_company_id::text,
      v_before,
      to_jsonb(v_row)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_company_settings FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_company_settings TO authenticated;

-- ── 5. seed_company_role_permissions ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_company_role_permissions(p_company_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_matrix text[][] := ARRAY[
    ['owner','projects.view',              'true'],
    ['owner','projects.view_all',          'true'],
    ['owner','projects.create',            'true'],
    ['owner','projects.edit',              'true'],
    ['owner','jobs.view',                  'true'],
    ['owner','jobs.view_all',              'true'],
    ['owner','jobs.create',                'true'],
    ['owner','jobs.edit',                  'true'],
    ['owner','employees.view',             'true'],
    ['owner','employees.create',           'true'],
    ['owner','employees.edit',             'true'],
    ['owner','contractors.view',           'true'],
    ['owner','contractors.create',         'true'],
    ['owner','contractors.edit',           'true'],
    ['owner','clients.view',               'true'],
    ['owner','clients.edit',               'true'],
    ['owner','inventory.view',             'true'],
    ['owner','inventory.edit',             'true'],
    ['owner','suppliers.view',             'true'],
    ['owner','suppliers.edit',             'true'],
    ['owner','attendance.view_team',       'true'],
    ['owner','attendance.view_all',        'true'],
    ['owner','leave.view_all',             'true'],
    ['owner','leave.approve',              'true'],
    ['owner','payments.view_payroll',      'true'],
    ['owner','payments.approve',           'true'],
    ['owner','reports.view_operational',   'true'],
    ['owner','reports.view_financial',     'true'],
    ['owner','settings.view',              'true'],
    ['hr','projects.view',                 'true'],
    ['hr','projects.view_all',             'true'],
    ['hr','projects.create',               'true'],
    ['hr','projects.edit',                 'true'],
    ['hr','jobs.view',                     'true'],
    ['hr','jobs.view_all',                 'true'],
    ['hr','jobs.create',                   'true'],
    ['hr','jobs.edit',                     'true'],
    ['hr','employees.view',                'true'],
    ['hr','employees.create',              'true'],
    ['hr','employees.edit',                'true'],
    ['hr','contractors.view',              'true'],
    ['hr','contractors.create',            'true'],
    ['hr','contractors.edit',              'true'],
    ['hr','clients.view',                  'true'],
    ['hr','clients.edit',                  'true'],
    ['hr','inventory.view',                'true'],
    ['hr','inventory.edit',                'true'],
    ['hr','suppliers.view',                'true'],
    ['hr','suppliers.edit',                'true'],
    ['hr','attendance.view_team',          'true'],
    ['hr','attendance.view_all',           'true'],
    ['hr','leave.view_all',                'true'],
    ['hr','leave.approve',                 'true'],
    ['hr','payments.view_payroll',         'true'],
    ['hr','payments.approve',              'true'],
    ['hr','reports.view_operational',      'true'],
    ['hr','reports.view_financial',        'true'],
    ['hr','settings.view',                 'true'],
    ['manager','projects.view',            'true'],
    ['manager','projects.view_all',        'false'],
    ['manager','projects.create',          'true'],
    ['manager','projects.edit',            'true'],
    ['manager','jobs.view',                'true'],
    ['manager','jobs.view_all',            'false'],
    ['manager','jobs.create',              'true'],
    ['manager','jobs.edit',                'true'],
    ['manager','employees.view',           'true'],
    ['manager','employees.create',         'false'],
    ['manager','employees.edit',           'false'],
    ['manager','contractors.view',         'true'],
    ['manager','contractors.create',       'true'],
    ['manager','contractors.edit',         'true'],
    ['manager','clients.view',             'true'],
    ['manager','clients.edit',             'true'],
    ['manager','inventory.view',           'true'],
    ['manager','inventory.edit',           'true'],
    ['manager','suppliers.view',           'true'],
    ['manager','suppliers.edit',           'false'],
    ['manager','attendance.view_team',     'true'],
    ['manager','attendance.view_all',      'false'],
    ['manager','leave.view_all',           'false'],
    ['manager','leave.approve',            'true'],
    ['manager','payments.view_payroll',    'false'],
    ['manager','payments.approve',         'false'],
    ['manager','reports.view_operational', 'true'],
    ['manager','reports.view_financial',   'false'],
    ['manager','settings.view',            'false'],
    ['employee','projects.view',           'true'],
    ['employee','projects.view_all',       'false'],
    ['employee','projects.create',         'false'],
    ['employee','projects.edit',           'false'],
    ['employee','jobs.view',               'true'],
    ['employee','jobs.view_all',           'false'],
    ['employee','jobs.create',             'false'],
    ['employee','jobs.edit',               'false'],
    ['employee','employees.view',          'false'],
    ['employee','employees.create',        'false'],
    ['employee','employees.edit',          'false'],
    ['employee','contractors.view',        'false'],
    ['employee','contractors.create',      'false'],
    ['employee','contractors.edit',        'false'],
    ['employee','clients.view',            'true'],
    ['employee','clients.edit',            'false'],
    ['employee','inventory.view',          'true'],
    ['employee','inventory.edit',          'false'],
    ['employee','suppliers.view',          'false'],
    ['employee','suppliers.edit',          'false'],
    ['employee','attendance.view_team',    'false'],
    ['employee','attendance.view_all',     'false'],
    ['employee','leave.view_all',          'false'],
    ['employee','leave.approve',           'false'],
    ['employee','payments.view_payroll',   'true'],
    ['employee','payments.approve',        'false'],
    ['employee','reports.view_operational','false'],
    ['employee','reports.view_financial',  'false'],
    ['employee','settings.view',           'false']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_matrix, 1) LOOP
    INSERT INTO public.company_role_permissions
      (company_id, role, permission_key, allowed)
    VALUES (
      p_company_id,
      v_matrix[i][1],
      v_matrix[i][2],
      v_matrix[i][3]::boolean
    )
    ON CONFLICT (company_id, role, permission_key) DO NOTHING;
  END LOOP;

  IF auth.uid() IS NOT NULL THEN
    BEGIN
      PERFORM write_audit_event(
        p_company_id,
        'company.permissions_seeded',
        'company',
        p_company_id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_role_permissions FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_company_role_permissions TO authenticated;;
