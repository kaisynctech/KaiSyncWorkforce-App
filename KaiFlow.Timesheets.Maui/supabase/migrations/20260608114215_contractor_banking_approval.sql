-- Phase 2C.4: HR approval and rejection of contractor banking updates.
--
-- hr_approve_contractor_banking:
--   Copies pending banking fields to contractors table.
--   Sets banking_verified = false — HR must re-verify separately.
--   Marks update approved. Writes app_events.
--
-- hr_reject_contractor_banking:
--   Marks update rejected with reason. Does NOT touch contractors table.
--   Writes app_events.
--
-- Both RPCs validate: update is pending, reviewer belongs to same company,
-- reviewer has HR/admin/owner access level.
--
-- TODO Phase 2C.5: add notify_contractor_banking_decision() call
-- when contractor portal notification infrastructure is built.


-- ── Approve ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_approve_contractor_banking(
    p_update_id   uuid,
    p_reviewed_by uuid     -- employees.id of the HR user approving
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        RAISE EXCEPTION 'Cannot approve: update status is already "%"', v_update.status;
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
$$;

GRANT EXECUTE ON FUNCTION public.hr_approve_contractor_banking TO authenticated;

COMMENT ON FUNCTION public.hr_approve_contractor_banking IS
    'Copies pending banking to contractors table, resets banking_verified = false, '
    'marks update approved. HR must separately verify banking before payouts. '
    'Phase 2C.4.';


-- ── Reject ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_reject_contractor_banking(
    p_update_id   uuid,
    p_reviewed_by uuid,
    p_reason      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        RAISE EXCEPTION 'Cannot reject: update status is already "%"', v_update.status;
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
$$;

GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_banking TO authenticated;

COMMENT ON FUNCTION public.hr_reject_contractor_banking IS
    'Marks a pending banking update as rejected with reason. '
    'contractors table banking fields are not modified. Phase 2C.4.';;
