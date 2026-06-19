-- Migration: 20260609133918_portal_quote_conversion_fields
-- Additional fields for quote conversion - invoice submission and payout functions
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_submit_invoice(p_company_code text, p_contractor_code text, p_job_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ct         public.contractors%ROWTYPE;
    v_jc_id      uuid;
    v_payout_id  uuid;
    v_notes      text;
BEGIN
    -- Resolve contractor from portal codes (same pattern as all other portal RPCs)
    SELECT * INTO v_ct
    FROM public.contractors ct
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(c.code))              = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code))  = upper(trim(p_contractor_code))
      AND ct.is_active = true;

    IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;

    -- Verify the contractor is actually assigned to this job
    IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
        RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
    END IF;

    -- Find the specific job_contractors row for this assignment
    SELECT id INTO v_jc_id
    FROM public.job_contractors
    WHERE company_id    = v_ct.company_id
      AND job_id        = p_job_id
      AND contractor_id = v_ct.id
    LIMIT 1;

    -- Compose notes: \\"INV-001 | additional notes\\"
    v_notes := nullif(trim(concat_ws(' | ',
        nullif(trim(coalesce(p_invoice_reference, '')), ''),
        nullif(trim(coalesce(p_notes, '')), '')
    )), '');

    -- Create the payout record — HR will review amount, set VAT, and approve
    INSERT INTO public.contractor_payouts (
        id, company_id, contractor_id, job_id, job_contractor_id,
        subtotal, vat_rate, vat_amount, total_amount, retention_amount,
        is_vat_inclusive, tax_type,
        payout_status, approval_status,
        notes, created_at, updated_at
    ) VALUES (
        gen_random_uuid(),
        v_ct.company_id,
        v_ct.id,
        p_job_id,
        v_jc_id,
        p_amount,
        0,
        0,
        p_amount,
        0,
        false,
        'standard',
        'pending',
        'pending',
        v_notes,
        now(),
        now()
    )
    RETURNING id INTO v_payout_id;

    RETURN v_payout_id;
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_submit_invoice(p_company_code text, p_contractor_code text, p_job_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_submit_invoice(p_company_code text, p_contractor_code text, p_job_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_invoice(p_company_code text, p_contractor_code text, p_job_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_invoice(p_company_code text, p_contractor_code text, p_job_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_list_payouts(p_company_code text, p_contractor_code text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
  FROM (
    SELECT
      p.id,
      p.company_id,
      p.contractor_id,
      p.job_id,
      p.job_contractor_id,
      p.subtotal,
      p.vat_rate,
      p.vat_amount,
      p.total_amount,
      p.retention_amount,
      p.payout_status,
      p.approval_status,
      p.rejection_reason,
      p.notes,
      p.payout_date,
      p.approved_at,
      p.paid_at,
      p.created_at,
      j.title    AS job_title,
      j.job_code AS job_code
    FROM  public.contractor_payouts  p
    INNER JOIN public.contractors    ct ON ct.id = p.contractor_id
    INNER JOIN public.companies      c  ON c.id  = p.company_id
    LEFT  JOIN public.jobs           j  ON j.id  = p.job_id
                                       AND j.company_id = p.company_id
    WHERE upper(trim(c.code))             = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND ct.contractor_code IS NOT NULL
      AND ct.is_active = true
      AND (p.payout_status <> 'cancelled' OR p.approval_status = 'rejected')
  ) t;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_list_payouts(p_company_code text, p_contractor_code text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_list_payouts(p_company_code text, p_contractor_code text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_list_payouts(p_company_code text, p_contractor_code text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_list_payouts(p_company_code text, p_contractor_code text) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_resubmit_payout(p_company_code text, p_contractor_code text, p_payout_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contractor_id uuid;
  v_company_id    uuid;
  v_notes         text;
BEGIN
  SELECT ct.id, c.id
    INTO v_contractor_id, v_company_id
    FROM public.contractors ct
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND upper(trim(c.code))             = upper(trim(p_company_code))
      AND ct.is_active = true
    LIMIT 1;

  IF v_contractor_id IS NULL THEN
    RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND';
  END IF;

  v_notes := nullif(trim(concat_ws(' | ',
      nullif(trim(coalesce(p_invoice_reference, '')), ''),
      nullif(trim(coalesce(p_notes, '')), '')
  )), '');

  UPDATE public.contractor_payouts
  SET
    payout_status    = 'pending',
    approval_status  = 'pending',
    rejection_reason = NULL,
    subtotal         = p_amount,
    vat_amount       = 0,
    total_amount     = p_amount,
    notes            = v_notes,
    updated_at       = now()
  WHERE id              = p_payout_id
    AND contractor_id   = v_contractor_id
    AND company_id      = v_company_id
    AND approval_status = 'rejected';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_NOT_FOUND_OR_NOT_REJECTED';
  END IF;
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_resubmit_payout(p_company_code text, p_contractor_code text, p_payout_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_resubmit_payout(p_company_code text, p_contractor_code text, p_payout_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_resubmit_payout(p_company_code text, p_contractor_code text, p_payout_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_resubmit_payout(p_company_code text, p_contractor_code text, p_payout_id uuid, p_amount numeric, p_invoice_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO service_role;

