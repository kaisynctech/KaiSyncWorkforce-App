-- Migration: 20260608114215_contractor_banking_approval
-- HR approve/reject contractor banking submission functions
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.hr_approve_contractor_banking(p_update_id uuid, p_reviewed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_update   public.contractor_banking_updates%ROWTYPE;
    v_reviewer public.employees%ROWTYPE;
BEGIN
    -- Load and validate the pending update
    SELECT * INTO v_update
    FROM   public.contractor_banking_updates
    WHERE  id = p_update_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Banking update not found';
    END IF;

    IF v_update.status <> 'pending' THEN
        RAISE EXCEPTION 'Cannot approve: update status is already \\"%\\"', v_update.status;
    END IF;

    -- Validate reviewer: active HR employee in the same company
    SELECT * INTO v_reviewer
    FROM   public.employees
    WHERE  id          = p_reviewed_by
      AND  company_id  = v_update.company_id
      AND  is_active   = true
      AND  access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reviewer not found or lacks HR permissions for this company';
    END IF;

    -- ── Copy banking fields to contractors table ───────────────────────────────
    -- banking_verified is ALWAYS reset to false — HR must re-verify separately.
    UPDATE public.contractors
    SET
        account_holder_name = v_update.account_holder_name,
        bank_name           = v_update.bank_name,
        bank_account        = v_update.bank_account,
        bank_branch_code    = v_update.bank_branch_code,
        account_type        = v_update.account_type,
        swift_bic           = v_update.swift_bic,
        banking_verified    = false,   -- ← intentional; never auto-verified on approval
        updated_at          = now()
    WHERE id         = v_update.contractor_id
      AND company_id = v_update.company_id;

    -- ── Mark update approved ──────────────────────────────────────────────────
    UPDATE public.contractor_banking_updates
    SET
        status      = 'approved',
        reviewed_at = now(),
        reviewed_by = p_reviewed_by
    WHERE id = p_update_id;

    -- ── Activity log ──────────────────────────────────────────────────────────
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        v_update.company_id,
        v_reviewer.user_id,       -- HR employee's Supabase auth user id
        'HrContractorDetails',
        'contractor_banking_update_approved',
        'info',
        jsonb_build_object(
            'contractor_id',  v_update.contractor_id,
            'update_id',      p_update_id,
            'reviewed_by',    p_reviewed_by
        ),
        now()
    );

    -- TODO Phase 2C.5: Notify contractor via portal notification system.
    -- HOOK: PERFORM public.notify_contractor_banking_decision(
    --     v_update.contractor_id, v_update.company_id, 'approved', null);
END;
$function$


REVOKE ALL ON FUNCTION public.hr_approve_contractor_banking(p_update_id uuid, p_reviewed_by uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_approve_contractor_banking(p_update_id uuid, p_reviewed_by uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_approve_contractor_banking(p_update_id uuid, p_reviewed_by uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_approve_contractor_banking(p_update_id uuid, p_reviewed_by uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_reject_contractor_banking(p_update_id uuid, p_reviewed_by uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_update   public.contractor_banking_updates%ROWTYPE;
    v_reviewer public.employees%ROWTYPE;
BEGIN
    -- Load and validate
    SELECT * INTO v_update
    FROM   public.contractor_banking_updates
    WHERE  id = p_update_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Banking update not found';
    END IF;

    IF v_update.status <> 'pending' THEN
        RAISE EXCEPTION 'Cannot reject: update status is already \\"%\\"', v_update.status;
    END IF;

    -- Validate reviewer
    SELECT * INTO v_reviewer
    FROM   public.employees
    WHERE  id         = p_reviewed_by
      AND  company_id = v_update.company_id
      AND  is_active  = true
      AND  access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reviewer not found or lacks HR permissions for this company';
    END IF;

    -- ── Mark rejected (contractors table NOT touched) ─────────────────────────
    UPDATE public.contractor_banking_updates
    SET
        status           = 'rejected',
        reviewed_at      = now(),
        reviewed_by      = p_reviewed_by,
        rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
    WHERE id = p_update_id;

    -- ── Activity log ──────────────────────────────────────────────────────────
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        v_update.company_id,
        v_reviewer.user_id,
        'HrContractorDetails',
        'contractor_banking_update_rejected',
        'info',
        jsonb_build_object(
            'contractor_id',    v_update.contractor_id,
            'update_id',        p_update_id,
            'reviewed_by',      p_reviewed_by,
            'rejection_reason', p_reason
        ),
        now()
    );

    -- TODO Phase 2C.5: Notify contractor via portal notification system.
    -- HOOK: PERFORM public.notify_contractor_banking_decision(
    --     v_update.contractor_id, v_update.company_id, 'rejected', p_reason);
END;
$function$


REVOKE ALL ON FUNCTION public.hr_reject_contractor_banking(p_update_id uuid, p_reviewed_by uuid, p_reason text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_reject_contractor_banking(p_update_id uuid, p_reviewed_by uuid, p_reason text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_banking(p_update_id uuid, p_reviewed_by uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_banking(p_update_id uuid, p_reviewed_by uuid, p_reason text) TO service_role;

