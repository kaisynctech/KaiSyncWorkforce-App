-- Phase 2C polish: replace category-string changes[] with field-level
-- field_changes: [{field, label, from, to}] in app_events.meta.
-- Backward compat: old events with changes[] still display via fallback in C#.

CREATE OR REPLACE FUNCTION public.contractor_portal_update_profile(
    p_contractor_id       uuid,
    p_company_id          uuid,
    p_name                text,
    p_registration_number text,
    p_tax_number          text,
    p_is_vat_registered   boolean,
    p_vat_number          text,
    p_contact_person      text,
    p_phone               text,
    p_email               text,
    p_address             text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old             public.contractors%ROWTYPE;
    v_field_changes   jsonb   := '[]'::jsonb;
    v_is_tax_change   boolean := false;
    v_changes_summary text;
BEGIN
    SELECT * INTO v_old
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id AND is_active = true;

    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;
    IF trim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Company name is required'; END IF;

    -- ── Company profile fields ──────────────────────────────────────────────
    IF v_old.name IS DISTINCT FROM nullif(trim(p_name), '') THEN
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'name', 'label', 'Company Name',
            'from',  coalesce(v_old.name, ''),
            'to',    coalesce(nullif(trim(p_name), ''), '')));
    END IF;

    IF v_old.registration_number IS DISTINCT FROM nullif(trim(p_registration_number), '') THEN
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'registration_number', 'label', 'Registration No.',
            'from',  coalesce(v_old.registration_number, ''),
            'to',    coalesce(nullif(trim(p_registration_number), ''), '')));
    END IF;

    -- ── Tax / VAT fields ────────────────────────────────────────────────────
    IF v_old.tax_number IS DISTINCT FROM nullif(trim(p_tax_number), '') THEN
        v_is_tax_change := true;
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'tax_number', 'label', 'Tax Number',
            'from',  coalesce(v_old.tax_number, ''),
            'to',    coalesce(nullif(trim(p_tax_number), ''), '')));
    END IF;

    IF v_old.is_vat_registered IS DISTINCT FROM p_is_vat_registered THEN
        v_is_tax_change := true;
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'is_vat_registered', 'label', 'VAT Registered',
            'from',  v_old.is_vat_registered::text,
            'to',    p_is_vat_registered::text));
    END IF;

    IF v_old.vat_number IS DISTINCT FROM nullif(trim(p_vat_number), '') THEN
        v_is_tax_change := true;
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'vat_number', 'label', 'VAT Number',
            'from',  coalesce(v_old.vat_number, ''),
            'to',    coalesce(nullif(trim(p_vat_number), ''), '')));
    END IF;

    -- ── Contact fields ──────────────────────────────────────────────────────
    IF v_old.contact_person IS DISTINCT FROM nullif(trim(p_contact_person), '') THEN
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'contact_person', 'label', 'Contact Person',
            'from',  coalesce(v_old.contact_person, ''),
            'to',    coalesce(nullif(trim(p_contact_person), ''), '')));
    END IF;

    IF v_old.phone IS DISTINCT FROM nullif(trim(p_phone), '') THEN
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'phone', 'label', 'Phone',
            'from',  coalesce(v_old.phone, ''),
            'to',    coalesce(nullif(trim(p_phone), ''), '')));
    END IF;

    IF v_old.email IS DISTINCT FROM nullif(trim(p_email), '') THEN
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'email', 'label', 'Email',
            'from',  coalesce(v_old.email, ''),
            'to',    coalesce(nullif(trim(p_email), ''), '')));
    END IF;

    IF v_old.address IS DISTINCT FROM nullif(trim(p_address), '') THEN
        v_field_changes := v_field_changes || jsonb_build_array(jsonb_build_object(
            'field', 'address', 'label', 'Address',
            'from',  coalesce(v_old.address, ''),
            'to',    coalesce(nullif(trim(p_address), ''), '')));
    END IF;

    -- No changes detected
    IF jsonb_array_length(v_field_changes) = 0 THEN RETURN; END IF;

    -- Human-readable summary for HR notification body
    v_changes_summary := (
        SELECT string_agg(fc->>'label', ', ')
        FROM   jsonb_array_elements(v_field_changes) AS fc
    );

    -- ── Apply UPDATE ────────────────────────────────────────────────────────
    UPDATE public.contractors
    SET
        name                = nullif(trim(p_name), ''),
        registration_number = nullif(trim(p_registration_number), ''),
        tax_number          = nullif(trim(p_tax_number), ''),
        is_vat_registered   = p_is_vat_registered,
        vat_number          = CASE WHEN p_is_vat_registered
                                   THEN nullif(trim(p_vat_number), '')
                                   ELSE NULL END,
        contact_person      = nullif(trim(p_contact_person), ''),
        phone               = nullif(trim(p_phone), ''),
        email               = nullif(trim(p_email), ''),
        address             = nullif(trim(p_address), ''),
        updated_at          = now()
    WHERE id = p_contractor_id AND company_id = p_company_id;

    -- ── Activity log with field-level detail ────────────────────────────────
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id, NULL, 'ContractorPortal', 'contractor_profile_updated', 'info',
        jsonb_build_object(
            'contractor_id', p_contractor_id,
            'is_tax_change', v_is_tax_change,
            'field_changes', v_field_changes   -- [{field, label, from, to}, ...]
        ),
        now()
    );

    -- ── HR notifications ────────────────────────────────────────────────────
    PERFORM public.notify_hr_contractor_profile_updated(
        p_company_id, p_contractor_id, v_changes_summary, v_is_tax_change
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_update_profile TO anon, authenticated;;
