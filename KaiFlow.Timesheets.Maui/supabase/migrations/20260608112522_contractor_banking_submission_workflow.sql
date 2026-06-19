-- Migration: 20260608112522_contractor_banking_submission_workflow
-- Contractor banking submission workflow - submit, get banking, get pending banking
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_submit_banking(p_contractor_id uuid, p_company_id uuid, p_account_holder text, p_bank_name text, p_bank_account text, p_branch_code text, p_account_type text, p_swift_bic text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ct          public.contractors%ROWTYPE;
    v_update_id   uuid;
    v_account_last4 text;
BEGIN
    -- Validate identity
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id AND is_active = true;

    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;

    IF trim(coalesce(p_account_holder, '')) = '' THEN
        RAISE EXCEPTION 'Account holder name is required';
    END IF;
    IF trim(coalesce(p_bank_name, '')) = '' THEN
        RAISE EXCEPTION 'Bank name is required';
    END IF;
    IF trim(coalesce(p_bank_account, '')) = '' THEN
        RAISE EXCEPTION 'Account number is required';
    END IF;

    -- Compute last 4 for notifications/activity (never store separately)
    v_account_last4 := right(trim(p_bank_account), 4);

    -- Replace any existing pending update (contractor re-submitted)
    DELETE FROM public.contractor_banking_updates
    WHERE  contractor_id = p_contractor_id
      AND  status        = 'pending';

    -- Insert new pending update
    INSERT INTO public.contractor_banking_updates (
        contractor_id, company_id,
        account_holder_name, bank_name, bank_account,
        bank_branch_code, account_type, swift_bic,
        status, submitted_at, created_at
    ) VALUES (
        p_contractor_id, p_company_id,
        nullif(trim(p_account_holder), ''),
        nullif(trim(p_bank_name), ''),
        trim(p_bank_account),
        nullif(trim(p_branch_code), ''),
        nullif(trim(p_account_type), ''),
        nullif(trim(p_swift_bic), ''),
        'pending', now(), now()
    )
    RETURNING id INTO v_update_id;

    -- Activity log
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id, NULL, 'ContractorPortal',
        'contractor_banking_update_submitted', 'info',
        jsonb_build_object(
            'contractor_id',    p_contractor_id,
            'update_id',        v_update_id,
            'account_last4',    v_account_last4
        ),
        now()
    );

    -- HR notification
    PERFORM public.notify_hr_contractor_banking_update(
        p_company_id, p_contractor_id, v_ct.name, v_account_last4
    );

    RETURN v_update_id;
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_submit_banking(p_contractor_id uuid, p_company_id uuid, p_account_holder text, p_bank_name text, p_bank_account text, p_branch_code text, p_account_type text, p_swift_bic text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_submit_banking(p_contractor_id uuid, p_company_id uuid, p_account_holder text, p_bank_name text, p_bank_account text, p_branch_code text, p_account_type text, p_swift_bic text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_banking(p_contractor_id uuid, p_company_id uuid, p_account_holder text, p_bank_name text, p_bank_account text, p_branch_code text, p_account_type text, p_swift_bic text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_banking(p_contractor_id uuid, p_company_id uuid, p_account_holder text, p_bank_name text, p_bank_account text, p_branch_code text, p_account_type text, p_swift_bic text) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_get_banking(p_contractor_id uuid, p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ct  public.contractors%ROWTYPE;
    v_masked text;
BEGIN
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id         = p_contractor_id
      AND  company_id = p_company_id
      AND  is_active  = true;

    IF NOT FOUND THEN RETURN NULL; END IF;

    -- Mask account number: show last 4 digits only
    v_masked := CASE
        WHEN v_ct.bank_account IS NULL OR length(trim(v_ct.bank_account)) = 0
             THEN NULL
        ELSE repeat('•', GREATEST(0, length(trim(v_ct.bank_account)) - 4))
             || right(trim(v_ct.bank_account), 4)
    END;

    RETURN json_build_object(
        'account_holder_name',     v_ct.account_holder_name,
        'bank_name',               v_ct.bank_name,
        'masked_account',          v_masked,
        'bank_branch_code',        v_ct.bank_branch_code,
        'account_type',            v_ct.account_type,
        'swift_bic',               v_ct.swift_bic,
        'has_banking_details',     (v_ct.bank_name IS NOT NULL OR v_ct.bank_account IS NOT NULL),
        'banking_verified',        v_ct.banking_verified,
        'payment_hold',            v_ct.payment_hold,
        'compliance_hold',         v_ct.compliance_hold,
        'payment_terms',           v_ct.payment_terms,
        'preferred_payment_method', v_ct.preferred_payment_method
    );
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_get_banking(p_contractor_id uuid, p_company_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_get_banking(p_contractor_id uuid, p_company_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_banking(p_contractor_id uuid, p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_banking(p_contractor_id uuid, p_company_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_get_pending_banking(p_contractor_id uuid, p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row public.contractor_banking_updates%ROWTYPE;
    v_masked text;
BEGIN
    SELECT * INTO v_row
    FROM   public.contractor_banking_updates
    WHERE  contractor_id = p_contractor_id
      AND  company_id    = p_company_id
      AND  status        = 'pending'
    ORDER  BY submitted_at DESC
    LIMIT  1;

    IF NOT FOUND THEN RETURN NULL; END IF;

    v_masked := CASE
        WHEN v_row.bank_account IS NULL OR length(trim(v_row.bank_account)) = 0
             THEN NULL
        ELSE repeat('•', GREATEST(0, length(trim(v_row.bank_account)) - 4))
             || right(trim(v_row.bank_account), 4)
    END;

    RETURN json_build_object(
        'id',                   v_row.id,
        'account_holder_name',  v_row.account_holder_name,
        'bank_name',            v_row.bank_name,
        'masked_account',       v_masked,
        'bank_branch_code',     v_row.bank_branch_code,
        'account_type',         v_row.account_type,
        'swift_bic',            v_row.swift_bic,
        'status',               v_row.status,
        'submitted_at',         v_row.submitted_at,
        'rejection_reason',     v_row.rejection_reason
    );
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_get_pending_banking(p_contractor_id uuid, p_company_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_get_pending_banking(p_contractor_id uuid, p_company_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_pending_banking(p_contractor_id uuid, p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_pending_banking(p_contractor_id uuid, p_company_id uuid) TO service_role;

