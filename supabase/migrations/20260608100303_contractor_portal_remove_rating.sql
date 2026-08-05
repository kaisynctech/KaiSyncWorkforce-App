-- Phase 2C privacy fix: remove contractor rating from portal-facing RPC.
-- Rating is internal HR information — contractors must not see it.
-- HR-side Contractor.cs model, HrContractorDetailsPage rating field,
-- and HrContractorsPage rating column are unchanged.

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
        -- Read-only: HR-owned state (no rating — internal HR information only)
        'banking_verified',         v_ct.banking_verified,
        'payment_hold',             v_ct.payment_hold,
        'compliance_hold',          v_ct.compliance_hold,
        'is_active',                v_ct.is_active,
        'payment_terms',            v_ct.payment_terms,
        'preferred_payment_method', v_ct.preferred_payment_method,
        'compliance_pack_name',     coalesce(v_pack_name, '')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_get_profile TO anon, authenticated;

COMMENT ON FUNCTION public.contractor_portal_get_profile IS
    'Contractor portal: returns profile for self-service display and editing. '
    'Rating is intentionally excluded — it is internal HR information. Phase 2C.';;
