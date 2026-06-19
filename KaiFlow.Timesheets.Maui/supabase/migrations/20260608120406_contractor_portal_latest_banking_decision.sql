-- Migration: 20260608120406_contractor_portal_latest_banking_decision
-- Get latest banking decision for contractor portal
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_get_latest_banking_decision(p_contractor_id uuid, p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row    public.contractor_banking_updates%ROWTYPE;
    v_masked text;
BEGIN
    -- Validate contractor belongs to this company and is active
    IF NOT EXISTS (
        SELECT 1 FROM public.contractors
        WHERE id = p_contractor_id AND company_id = p_company_id AND is_active = true
    ) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_row
    FROM   public.contractor_banking_updates
    WHERE  contractor_id = p_contractor_id
      AND  company_id    = p_company_id
    ORDER  BY submitted_at DESC
    LIMIT  1;

    IF NOT FOUND THEN RETURN NULL; END IF;

    v_masked := CASE
        WHEN v_row.bank_account IS NULL OR length(trim(v_row.bank_account)) = 0 THEN NULL
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
        'reviewed_at',          v_row.reviewed_at,
        'rejection_reason',     v_row.rejection_reason
    );
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_get_latest_banking_decision(p_contractor_id uuid, p_company_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_get_latest_banking_decision(p_contractor_id uuid, p_company_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_latest_banking_decision(p_contractor_id uuid, p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_latest_banking_decision(p_contractor_id uuid, p_company_id uuid) TO service_role;

