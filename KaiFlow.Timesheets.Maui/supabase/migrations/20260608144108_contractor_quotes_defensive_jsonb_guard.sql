-- Migration: 20260608144108_contractor_quotes_defensive_jsonb_guard
-- Defensive JSONB guards on quote fields - resubmit quote function
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_resubmit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_name         text;
    v_quote_number text;
    v_total        numeric;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.contractors
        WHERE id = p_contractor_id AND company_id = p_company_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'Contractor not found or inactive';
    END IF;

    UPDATE public.contractor_quotes
    SET    status       = 'submitted',
           submitted_at = now(),
           updated_at   = now()
    WHERE  id             = p_quote_id
      AND  contractor_id  = p_contractor_id
      AND  company_id     = p_company_id
      AND  status         = 'revision_requested'
    RETURNING quote_number, total_amount
    INTO v_quote_number, v_total;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found or not in revision_requested state';
    END IF;

    SELECT name INTO v_name FROM public.contractors WHERE id = p_contractor_id;

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_contractor_id, 'contractor_portal', 'resubmit_quote', 'info',
            jsonb_build_object('quote_id', p_quote_id, 'quote_number', v_quote_number));

    -- Notify HR via the existing function (uses valid 'hr' audience with recipient lookup)
    PERFORM public.notify_hr_contractor_quote(
        p_company_id,
        p_contractor_id,
        coalesce(v_name, 'Contractor'),
        v_quote_number,
        v_total
    );
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_resubmit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_resubmit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_resubmit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_resubmit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO service_role;

