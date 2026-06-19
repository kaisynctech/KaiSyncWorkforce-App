-- Migration: 20260608153726_hr_quote_review_workflow
-- HR review/approve/reject contractor quote workflow functions
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.hr_approve_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_hr_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_contractor_id uuid;
    v_quote_number  text;
    v_total         numeric;
BEGIN
    UPDATE public.contractor_quotes
    SET    status      = 'approved',
           reviewed_by = p_hr_user_id,
           reviewed_at = now(),
           hr_notes    = p_hr_notes,
           updated_at  = now()
    WHERE  id         = p_quote_id
      AND  company_id = p_company_id
      AND  status IN ('submitted','under_review')
    RETURNING contractor_id, quote_number, total_amount
    INTO v_contractor_id, v_quote_number, v_total;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found or not in a reviewable state';
    END IF;

    -- Audit log (app_events — no audience constraint)
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_approve_quote', 'info',
            jsonb_build_object(
                'quote_id',      p_quote_id,
                'contractor_id', v_contractor_id,
                'quote_number',  v_quote_number,
                'total_amount',  v_total));

    -- NOTE: contractor-facing notification omitted — app_notifications.audience
    --   only permits 'employee'|'hr'|'all'.  Contractor portal visibility is
    --   achieved by the contractor reloading their quote list (status changes).
END;
$function$


REVOKE ALL ON FUNCTION public.hr_approve_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_hr_notes text DEFAULT NULL::text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_approve_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_hr_notes text DEFAULT NULL::text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_approve_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_hr_notes text DEFAULT NULL::text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_approve_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_hr_notes text DEFAULT NULL::text) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_reject_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_rejection_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_contractor_id uuid;
    v_quote_number  text;
BEGIN
    UPDATE public.contractor_quotes
    SET    status           = 'rejected',
           reviewed_by      = p_hr_user_id,
           reviewed_at      = now(),
           rejection_reason = p_rejection_reason,
           updated_at       = now()
    WHERE  id         = p_quote_id
      AND  company_id = p_company_id
      AND  status IN ('submitted','under_review')
    RETURNING contractor_id, quote_number
    INTO v_contractor_id, v_quote_number;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found or not in a reviewable state';
    END IF;

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_reject_quote', 'info',
            jsonb_build_object(
                'quote_id',         p_quote_id,
                'contractor_id',    v_contractor_id,
                'rejection_reason', p_rejection_reason));
END;
$function$


REVOKE ALL ON FUNCTION public.hr_reject_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_rejection_reason text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_reject_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_rejection_reason text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_rejection_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_rejection_reason text) TO service_role;

