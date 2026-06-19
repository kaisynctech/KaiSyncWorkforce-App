-- Phase I: Enrich contractor_portal_list_payouts with job context, notes,
-- approval status, and payment timestamps so the portal Payments tab can
-- show contractors a meaningful history of their submissions.

CREATE OR REPLACE FUNCTION public.contractor_portal_list_payouts(
    p_company_code    text,
    p_contractor_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
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
    WHERE upper(trim(c.code))            = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND ct.contractor_code IS NOT NULL
      AND ct.is_active = true
      AND p.payout_status <> 'cancelled'
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_list_payouts(text, text) TO anon, authenticated;
