-- Migration: 20260608125918_contractor_quotes_vat_charges_polish
-- VAT/charges polish on quote functions - upload quote and delete draft
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_upload_quote(p_contractor_id uuid, p_company_id uuid, p_title text, p_description text, p_quote_number text, p_amount numeric, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_valid_until date, p_contractor_notes text, p_file_url text, p_file_name text, p_storage_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ct        public.contractors%ROWTYPE;
    v_quote_id  uuid;
    v_qnum      text;
    v_taxable   numeric; v_vat numeric; v_total numeric; v_incl boolean;
BEGIN
    SELECT * INTO v_ct FROM public.contractors
    WHERE id=p_contractor_id AND company_id=p_company_id AND is_active=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;
    IF trim(coalesce(p_title,''))=''    THEN RAISE EXCEPTION 'Title is required'; END IF;
    IF trim(coalesce(p_file_url,''))='' THEN RAISE EXCEPTION 'File URL is required'; END IF;

    v_qnum := coalesce(nullif(trim(coalesce(p_quote_number,'')), ''),
              public.generate_contractor_quote_number(p_company_id, p_contractor_id));

    SELECT o_taxable, o_vat, o_total, o_is_vat_inclusive
    INTO   v_taxable, v_vat, v_total, v_incl
    FROM   public._cq_compute_totals(
        coalesce(p_amount,0), coalesce(p_discount,0), coalesce(p_freight,0),
        coalesce(p_duty,0), coalesce(p_levies,0), coalesce(p_other_charges,0),
        coalesce(p_vat_mode,'exclusive'), coalesce(p_vat_rate,0.15));

    INSERT INTO public.contractor_quotes (
        company_id, contractor_id, quote_number, title, description,
        source_mode, vat_mode, vat_rate, is_vat_inclusive,
        subtotal, discount_amount, freight_amount, duty_amount,
        levies_amount, other_charges_amount, taxable_amount, vat_amount, total_amount,
        valid_until, contractor_notes, status, submitted_at,
        sender_name, sender_reg_number, sender_vat_number, created_at, updated_at
    ) VALUES (
        p_company_id, p_contractor_id, v_qnum, trim(p_title),
        nullif(trim(coalesce(p_description,'')), ''),
        'upload', coalesce(p_vat_mode,'exclusive'), coalesce(p_vat_rate,0.15), v_incl,
        coalesce(p_amount,0), coalesce(p_discount,0), coalesce(p_freight,0),
        coalesce(p_duty,0), coalesce(p_levies,0), coalesce(p_other_charges,0),
        v_taxable, v_vat, v_total,
        p_valid_until, nullif(trim(coalesce(p_contractor_notes,'')), ''),
        'submitted', now(),
        v_ct.name, v_ct.registration_number, v_ct.vat_number, now(), now()
    ) RETURNING id INTO v_quote_id;

    INSERT INTO public.contractor_quote_attachments (
        quote_id, company_id, contractor_id, file_name, file_url, storage_path, is_primary, uploaded_by
    ) VALUES (v_quote_id, p_company_id, p_contractor_id, p_file_name, p_file_url, p_storage_path, true, 'contractor_portal');

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
    VALUES (p_company_id, NULL, 'ContractorPortal', 'contractor_quote_submitted', 'info',
        jsonb_build_object('contractor_id',p_contractor_id,'quote_id',v_quote_id,
            'quote_number',v_qnum,'total_amount',v_total,'source_mode','upload'), now());

    PERFORM public.notify_hr_contractor_quote(p_company_id, p_contractor_id, v_ct.name, v_qnum, v_total);

    RETURN v_quote_id;
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_upload_quote(p_contractor_id uuid, p_company_id uuid, p_title text, p_description text, p_quote_number text, p_amount numeric, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_valid_until date, p_contractor_notes text, p_file_url text, p_file_name text, p_storage_path text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_upload_quote(p_contractor_id uuid, p_company_id uuid, p_title text, p_description text, p_quote_number text, p_amount numeric, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_valid_until date, p_contractor_notes text, p_file_url text, p_file_name text, p_storage_path text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_upload_quote(p_contractor_id uuid, p_company_id uuid, p_title text, p_description text, p_quote_number text, p_amount numeric, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_valid_until date, p_contractor_notes text, p_file_url text, p_file_name text, p_storage_path text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_upload_quote(p_contractor_id uuid, p_company_id uuid, p_title text, p_description text, p_quote_number text, p_amount numeric, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_valid_until date, p_contractor_notes text, p_file_url text, p_file_name text, p_storage_path text) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_delete_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    DELETE FROM public.contractor_quotes
    WHERE  id            = p_quote_id
      AND  contractor_id = p_contractor_id
      AND  company_id    = p_company_id
      AND  status        = 'draft';   -- only drafts can be deleted

    IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found or not deletable'; END IF;
    -- Items + attachments cascade-deleted automatically
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_delete_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_delete_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_delete_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_delete_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO service_role;

