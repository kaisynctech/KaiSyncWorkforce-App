-- Phase 2C.2: Contractor Portal self-service profile.
--
-- Adds three SECURITY DEFINER functions so the portal's anon session can
-- read and update its own contractor profile without direct table access.
-- All updates are validated against contractor_id + company_id.
-- HR-owned fields (holds, rating, banking_verified, etc.) are never touched.

-- ── 1. Read profile ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_get_profile(
    p_contractor_id uuid,
    p_company_id    uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ct        public.contractors%ROWTYPE;
    v_company   public.companies%ROWTYPE;
    v_pack_name text;
BEGIN
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id         = p_contractor_id
      AND  company_id = p_company_id
      AND  is_active  = true;

    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT * INTO v_company
    FROM   public.companies
    WHERE  id = p_company_id;

    -- Compliance pack name (nullable — pack may not be assigned)
    IF v_ct.compliance_pack_id IS NOT NULL THEN
        SELECT name INTO v_pack_name
        FROM   public.contractor_compliance_packs
        WHERE  id = v_ct.compliance_pack_id;
    END IF;

    RETURN json_build_object(
        -- Editable by contractor
        'name',                     v_ct.name,
        'registration_number',      v_ct.registration_number,
        'tax_number',               v_ct.tax_number,
        'is_vat_registered',        v_ct.is_vat_registered,
        'vat_number',               v_ct.vat_number,
        'contact_person',           v_ct.contact_person,
        'phone',                    v_ct.phone,
        'email',                    v_ct.email,
        'address',                  v_ct.address,
        -- Read-only: identity
        'company_name',             v_company.name,
        'company_code',             v_company.code,
        'contractor_code',          v_ct.contractor_code,
        'partner_kind',             v_ct.partner_kind,
        -- Read-only: HR-owned state
        'banking_verified',         v_ct.banking_verified,
        'payment_hold',             v_ct.payment_hold,
        'compliance_hold',          v_ct.compliance_hold,
        'rating',                   v_ct.rating,
        'is_active',                v_ct.is_active,
        'payment_terms',            v_ct.payment_terms,
        'preferred_payment_method', v_ct.preferred_payment_method,
        'compliance_pack_name',     coalesce(v_pack_name, '')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_get_profile TO anon, authenticated;


-- ── 2. HR notification helper ─────────────────────────────────────────────────
--
-- Notifies all HR/admin employees when a contractor updates their profile.
-- Same pattern as notify_hr_contractor_document (Phase 2B.3c).
-- Dedupe key is hourly per contractor/employee to prevent notification spam.

CREATE OR REPLACE FUNCTION public.notify_hr_contractor_profile_updated(
    p_company_id      uuid,
    p_contractor_id   uuid,
    p_changes_summary text,
    p_is_tax_change   boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contractor_name text;
    v_notification_type  text;
    v_title              text;
    v_body               text;
    r                    RECORD;
    v_hour_window        text;
BEGIN
    SELECT name INTO v_contractor_name FROM public.contractors WHERE id = p_contractor_id;
    v_contractor_name := coalesce(nullif(trim(v_contractor_name), ''), 'Contractor');
    v_hour_window     := to_char(now(), 'YYYYMMDDHH24');

    IF p_is_tax_change THEN
        v_notification_type := 'contractor_tax_updated';
        v_title             := 'Contractor Tax/VAT Updated — Verify Required';
        v_body              := v_contractor_name
                               || ' updated their tax/VAT information ('
                               || p_changes_summary
                               || '). Please verify on the Contractor profile.';
    ELSE
        v_notification_type := 'contractor_profile_updated';
        v_title             := 'Contractor Profile Updated';
        v_body              := v_contractor_name
                               || ' updated their profile ('
                               || p_changes_summary || ').';
    END IF;

    FOR r IN
        SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
        FROM   public.employees e
        WHERE  e.company_id  = p_company_id
          AND  e.is_active   = true
          AND  e.user_id     IS NOT NULL
          AND  e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
    LOOP
        INSERT INTO public.app_notifications (
            company_id,
            audience,
            recipient_auth_user_id,
            recipient_employee_id,
            type,
            title,
            body,
            ref_type,
            ref_id,
            dedupe_key,
            data
        ) VALUES (
            p_company_id,
            'hr',
            r.auth_user_id,
            r.employee_id,
            v_notification_type,
            v_title,
            v_body,
            'contractor',
            p_contractor_id::text,
            v_notification_type || ':' || p_contractor_id::text
                || ':' || r.employee_id::text || ':' || v_hour_window,
            jsonb_build_object(
                'contractor_id',   p_contractor_id,
                'changes',         p_changes_summary,
                'is_tax_change',   p_is_tax_change
            )
        )
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_hr_contractor_profile_updated TO anon, authenticated;


-- ── 3. Update profile ─────────────────────────────────────────────────────────
--
-- Updates only the explicitly listed contractor-editable columns.
-- HR-owned fields are NEVER in this function's UPDATE statement.
-- Validates contractor_id + company_id + is_active before writing.
-- Logs activity to app_events.
-- Sends HR notification (informational for contact/registration,
-- verification-required for tax/VAT changes).

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
    v_changes         text[]  := '{}';
    v_is_tax_change   boolean := false;
    v_changes_summary text;
BEGIN
    -- Validate contractor identity and active status
    SELECT * INTO v_old
    FROM   public.contractors
    WHERE  id         = p_contractor_id
      AND  company_id = p_company_id
      AND  is_active  = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contractor not found or inactive';
    END IF;

    -- Require company name
    IF trim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'Company name is required';
    END IF;

    -- Detect what changed (for audit trail and notification routing)
    IF v_old.name                IS DISTINCT FROM nullif(trim(p_name), '')
       OR v_old.registration_number IS DISTINCT FROM nullif(trim(p_registration_number), '')
    THEN
        v_changes := array_append(v_changes, 'company profile');
    END IF;

    IF v_old.tax_number       IS DISTINCT FROM nullif(trim(p_tax_number), '')
       OR v_old.is_vat_registered IS DISTINCT FROM p_is_vat_registered
       OR v_old.vat_number    IS DISTINCT FROM nullif(trim(p_vat_number), '')
    THEN
        v_is_tax_change := true;
        v_changes := array_append(v_changes, 'tax / VAT');
    END IF;

    IF v_old.contact_person IS DISTINCT FROM nullif(trim(p_contact_person), '')
       OR v_old.phone       IS DISTINCT FROM nullif(trim(p_phone), '')
       OR v_old.email       IS DISTINCT FROM nullif(trim(p_email), '')
       OR v_old.address     IS DISTINCT FROM nullif(trim(p_address), '')
    THEN
        v_changes := array_append(v_changes, 'contact details');
    END IF;

    -- Nothing changed — exit without writes
    IF array_length(v_changes, 1) IS NULL THEN RETURN; END IF;

    v_changes_summary := array_to_string(v_changes, ', ');

    -- ── Explicit allowlist UPDATE (HR-owned columns never touched) ────────────
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
    WHERE id         = p_contractor_id
      AND company_id = p_company_id;

    -- ── Activity / audit log ──────────────────────────────────────────────────
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id,
        NULL,                         -- portal = no JWT auth_user_id
        'ContractorPortal',
        'contractor_profile_updated',
        'info',
        jsonb_build_object(
            'contractor_id',   p_contractor_id,
            'changes',         v_changes,
            'is_tax_change',   v_is_tax_change
        ),
        now()
    );

    -- ── HR notifications ──────────────────────────────────────────────────────
    PERFORM public.notify_hr_contractor_profile_updated(
        p_company_id,
        p_contractor_id,
        v_changes_summary,
        v_is_tax_change
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_update_profile TO anon, authenticated;


-- ── 4. Comments ───────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.contractor_portal_get_profile IS
    'Contractor portal: returns full profile for read/display. '
    'SECURITY DEFINER — validates contractor_id + company_id. Phase 2C.2.';

COMMENT ON FUNCTION public.contractor_portal_update_profile IS
    'Contractor portal: updates contractor-editable fields only. '
    'HR-owned fields (holds, rating, banking_verified, etc.) are never modified. '
    'Logs to app_events. Notifies HR via notify_hr_contractor_profile_updated. Phase 2C.2.';

COMMENT ON FUNCTION public.notify_hr_contractor_profile_updated IS
    'Notifies HR/admin employees when a contractor updates their profile via portal. '
    'Tax/VAT changes use a higher-priority notification type. Phase 2C.2.';;
