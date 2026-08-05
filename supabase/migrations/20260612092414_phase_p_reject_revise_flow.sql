
-- Phase P: Reject → Revise flow for contractor portal invoices

-- 1. Add rejection_reason column
ALTER TABLE public.contractor_payouts
ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Recreate contractor_portal_list_payouts:
--    - Returns rejection_reason
--    - Shows rejected payouts (previously hidden by payout_status <> 'cancelled')
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
$function$;

-- 3. Create contractor_portal_resubmit_payout RPC
CREATE OR REPLACE FUNCTION public.contractor_portal_resubmit_payout(
  p_company_code      text,
  p_contractor_code   text,
  p_payout_id         uuid,
  p_amount            numeric,
  p_invoice_reference text DEFAULT NULL,
  p_notes             text DEFAULT NULL
)
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
$function$;
;
