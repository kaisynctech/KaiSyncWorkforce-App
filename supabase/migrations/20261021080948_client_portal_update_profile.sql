-- 20261021080948_client_portal_update_profile
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.client_portal_update_profile(
  p_company_code text, p_client_code text,
  p_name text, p_legal_name text, p_company_number text, p_vat_number text,
  p_contact_person text, p_email text, p_phone text, p_mobile text,
  p_direct_line text, p_fax text, p_website text, p_address text, p_billing_address text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client_id uuid;
  v_company_id uuid;
  v_old public.clients%ROWTYPE;
  v_changes jsonb := '[]'::jsonb;
  v_summary text;
  f record;
BEGIN
  SELECT x.client_id, x.company_id INTO v_client_id, v_company_id
  FROM public._client_portal_client(p_company_code, p_client_code) x;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF trim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Company name is required'; END IF;

  SELECT * INTO v_old FROM public.clients WHERE id = v_client_id AND company_id = v_company_id FOR UPDATE;

  FOR f IN
    SELECT * FROM (VALUES
      ('name', 'Company Name', v_old.name::text, p_name),
      ('legal_name', 'Legal Name', v_old.legal_name::text, p_legal_name),
      ('company_number', 'Registration No.', v_old.company_number::text, p_company_number),
      ('vat_number', 'VAT Number', v_old.vat_number::text, p_vat_number),
      ('contact_person', 'Contact Person', v_old.contact_person::text, p_contact_person),
      ('email', 'Email', v_old.email::text, p_email),
      ('phone', 'Phone', v_old.phone::text, p_phone),
      ('mobile', 'Mobile', v_old.mobile::text, p_mobile),
      ('direct_line', 'Direct Line', v_old.direct_line::text, p_direct_line),
      ('fax', 'Fax', v_old.fax::text, p_fax),
      ('website', 'Website', v_old.website::text, p_website),
      ('address', 'Address', v_old.address::text, p_address),
      ('billing_address', 'Billing Address', v_old.billing_address::text, p_billing_address)
    ) AS t(field, label, old_value, new_value)
  LOOP
    IF length(coalesce(f.new_value, '')) > 1000 THEN
      RAISE EXCEPTION '% is too long', f.label;
    END IF;
    IF nullif(trim(coalesce(f.old_value, '')), '') IS DISTINCT FROM nullif(trim(coalesce(f.new_value, '')), '') THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', f.field, 'label', f.label,
        'from', coalesce(f.old_value, ''), 'to', coalesce(nullif(trim(f.new_value), ''), '')));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_changes) = 0 THEN
    RETURN public.client_portal_get_profile(p_company_code, p_client_code);
  END IF;

  UPDATE public.clients SET
    name            = trim(p_name),
    legal_name      = nullif(trim(coalesce(p_legal_name, '')), ''),
    company_number  = nullif(trim(coalesce(p_company_number, '')), ''),
    vat_number      = nullif(trim(coalesce(p_vat_number, '')), ''),
    contact_person  = nullif(trim(coalesce(p_contact_person, '')), ''),
    email           = nullif(trim(coalesce(p_email, '')), ''),
    phone           = nullif(trim(coalesce(p_phone, '')), ''),
    mobile          = nullif(trim(coalesce(p_mobile, '')), ''),
    direct_line     = nullif(trim(coalesce(p_direct_line, '')), ''),
    fax             = nullif(trim(coalesce(p_fax, '')), ''),
    website         = nullif(trim(coalesce(p_website, '')), ''),
    address         = nullif(trim(coalesce(p_address, '')), ''),
    billing_address = nullif(trim(coalesce(p_billing_address, '')), '')
  WHERE id = v_client_id AND company_id = v_company_id;

  v_summary := (SELECT string_agg(x->>'label', ', ') FROM jsonb_array_elements(v_changes) x);
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company_id, NULL, 'ClientPortal', 'client_profile_updated', 'info',
          jsonb_build_object('client_id', v_client_id::text, 'source', 'client_portal', 'field_changes', v_changes),
          now());
  PERFORM public.notify_hr_client_profile_updated(v_company_id, v_client_id, v_summary);

  RETURN public.client_portal_get_profile(p_company_code, p_client_code);
END;
$$;
GRANT EXECUTE ON FUNCTION public.client_portal_update_profile(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated;
