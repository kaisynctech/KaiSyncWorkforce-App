-- Settings › General save. Signed-in users cannot UPDATE companies directly (no table grant), so the
-- old "Save company name" silently did nothing. This owner-only function changes just the profile
-- fields (never plan, code, modules or owner).
CREATE OR REPLACE FUNCTION public.update_company_profile(p_company_id uuid, p_profile jsonb)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.companies%ROWTYPE;
  t text;
BEGIN
  IF auth.uid() IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
     OR public.get_my_role(p_company_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'ONLY_OWNER';
  END IF;
  t := nullif(btrim(coalesce(p_profile->>'name', '')), '');
  IF t IS NULL THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF char_length(t) > 200 THEN RAISE EXCEPTION 'NAME_TOO_LONG'; END IF;

  UPDATE public.companies SET
    name = t,
    legal_name = nullif(btrim(coalesce(p_profile->>'legal_name', '')), ''),
    registration_number = nullif(btrim(coalesce(p_profile->>'registration_number', '')), ''),
    is_vat_registered = coalesce((p_profile->>'is_vat_registered')::boolean, is_vat_registered),
    vat_number = nullif(btrim(coalesce(p_profile->>'vat_number', '')), ''),
    contact_phone = nullif(btrim(coalesce(p_profile->>'contact_phone', '')), ''),
    contact_email = nullif(btrim(coalesce(p_profile->>'contact_email', '')), ''),
    website = nullif(btrim(coalesce(p_profile->>'website', '')), ''),
    address = nullif(btrim(coalesce(p_profile->>'address', '')), ''),
    postal_address = nullif(btrim(coalesce(p_profile->>'postal_address', '')), ''),
    bank_account_holder = nullif(btrim(coalesce(p_profile->>'bank_account_holder', '')), ''),
    bank_name = nullif(btrim(coalesce(p_profile->>'bank_name', '')), ''),
    bank_account_number = nullif(regexp_replace(coalesce(p_profile->>'bank_account_number', ''), '\s+', '', 'g'), ''),
    bank_branch_code = nullif(btrim(coalesce(p_profile->>'bank_branch_code', '')), ''),
    bank_account_type = nullif(btrim(coalesce(p_profile->>'bank_account_type', '')), ''),
    bank_swift_code = nullif(upper(btrim(coalesce(p_profile->>'bank_swift_code', ''))), ''),
    show_bank_on_invoices = coalesce((p_profile->>'show_bank_on_invoices')::boolean, show_bank_on_invoices),
    show_bank_on_quotes = coalesce((p_profile->>'show_bank_on_quotes')::boolean, show_bank_on_quotes),
    document_footer = nullif(btrim(coalesce(p_profile->>'document_footer', '')), '')
  WHERE id = p_company_id
  RETURNING * INTO v;
  RETURN row_to_json(v);
END $$;
