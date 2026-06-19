-- =============================================================================
-- ARCH-003 Migration 9: Step-up verification table + RPCs + sensitive RPC guards
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. step_up_sessions table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.step_up_sessions (
    id              uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         uuid         NOT NULL,
    company_id      uuid         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    verified_at     timestamptz  NOT NULL DEFAULT now(),
    expires_at      timestamptz  NOT NULL DEFAULT now(),
    failed_attempts integer      NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    CONSTRAINT uq_step_up_sessions_user_company UNIQUE (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_step_up_sessions_lookup
    ON public.step_up_sessions(user_id, company_id);

ALTER TABLE public.step_up_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read their own step-up sessions (needed for app-layer freshness check)
CREATE POLICY step_up_sessions_user_select
    ON public.step_up_sessions
    FOR SELECT
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. hr_confirm_step_up  — called after successful password re-verification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_confirm_step_up(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.step_up_sessions
        (user_id, company_id, verified_at, expires_at, failed_attempts, locked_until)
    VALUES
        (auth.uid(), p_company_id, now(), now() + INTERVAL '15 minutes', 0, NULL)
    ON CONFLICT (user_id, company_id) DO UPDATE
        SET verified_at     = now(),
            expires_at      = now() + INTERVAL '15 minutes',
            failed_attempts = 0,
            locked_until    = NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_confirm_step_up(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_confirm_step_up(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_confirm_step_up(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. hr_record_step_up_failure  — called after failed password attempt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_record_step_up_failure(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempts     integer;
    v_locked_until timestamptz;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    -- Upsert: create a (non-valid) row if none exists, or increment failure count
    INSERT INTO public.step_up_sessions
        (user_id, company_id, verified_at, expires_at, failed_attempts, locked_until)
    VALUES
        (auth.uid(), p_company_id, now(), now() - INTERVAL '1 second', 1, NULL)
    ON CONFLICT (user_id, company_id) DO UPDATE
        SET failed_attempts = step_up_sessions.failed_attempts + 1;

    -- Read back current state
    SELECT failed_attempts, locked_until
    INTO   v_attempts, v_locked_until
    FROM   public.step_up_sessions
    WHERE  user_id    = auth.uid()
      AND  company_id = p_company_id;

    -- Lock for 30 minutes after 3 consecutive failures
    IF v_attempts >= 3 AND v_locked_until IS NULL THEN
        v_locked_until := now() + INTERVAL '30 minutes';
        UPDATE public.step_up_sessions
        SET locked_until = v_locked_until
        WHERE user_id    = auth.uid()
          AND company_id = p_company_id;
    END IF;

    RETURN jsonb_build_object(
        'failed_attempts', v_attempts,
        'locked_until',    v_locked_until
    );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_record_step_up_failure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_record_step_up_failure(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_record_step_up_failure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. hr_check_step_up_valid  — fast gate called inside sensitive RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_check_step_up_valid(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM   public.step_up_sessions
        WHERE  user_id    = auth.uid()
          AND  company_id = p_company_id
          AND  expires_at > now()
          AND  (locked_until IS NULL OR locked_until < now())
    );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_check_step_up_valid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_check_step_up_valid(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_check_step_up_valid(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Rebuild approve_payment_run  — add step-up guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_payment_run(
    p_company_id          uuid,
    p_payment_approval_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
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
$$;

-- ---------------------------------------------------------------------------
-- 6. Rebuild transfer_company_ownership  — add step-up guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_company_ownership(
    p_company_id        uuid,
    p_target_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
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

-- ---------------------------------------------------------------------------
-- 7. Rebuild update_employee_banking  — add step-up guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_employee_banking(
    p_company_id      uuid,
    p_employee_id     uuid,
    p_bank_account    text DEFAULT NULL,
    p_bank_name       text DEFAULT NULL,
    p_bank_branch_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
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

-- ---------------------------------------------------------------------------
-- 8. Rebuild seed_company_role_permissions  — add step-up guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_company_role_permissions(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.hr_check_step_up_valid(p_company_id) THEN
        RAISE EXCEPTION 'STEP_UP_REQUIRED: step-up verification required'
            USING ERRCODE = 'P0001';
    END IF;

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
END;
$$;
