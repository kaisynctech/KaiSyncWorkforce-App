-- Phase E: link contractor_payouts to a specific job_contractors assignment,
-- and add a portal RPC for contractor-initiated invoice submission.

-- 1. Add job_contractor_id FK to contractor_payouts (nullable — preserves existing rows)
ALTER TABLE public.contractor_payouts
    ADD COLUMN IF NOT EXISTS job_contractor_id uuid
        REFERENCES public.job_contractors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_contractor_payouts_jc
    ON public.contractor_payouts (company_id, job_contractor_id)
    WHERE job_contractor_id IS NOT NULL;

-- 2. Portal RPC: contractor submits an invoice for a specific job assignment
CREATE OR REPLACE FUNCTION public.contractor_portal_submit_invoice(
    p_company_code       text,
    p_contractor_code    text,
    p_job_id             uuid,
    p_amount             numeric,
    p_invoice_reference  text    DEFAULT NULL,
    p_notes              text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    -- Compose notes: "INV-001 | additional notes"
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
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_invoice
    TO anon, authenticated;;
