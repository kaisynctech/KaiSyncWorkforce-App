-- CLIENT-PORTAL-SPEC-002 P2: client "My information".
-- Additive only: three new functions. Applied 21 Oct 2026 (daytime, Nyarie approved) as
-- migrations client_portal_get_profile, notify_hr_client_profile_updated, client_portal_update_profile
-- (+ REVOKE on the notify function). Contact-list editing left out: the client sees contacts
-- read-only and asks HR to change them.
-- Edits apply straight away, every change is
-- recorded in app_events (shown on the HR client Activity tab, "X: old → new")
-- and HR is notified (same pattern as contractor_portal_update_profile).

CREATE OR REPLACE FUNCTION public.client_portal_get_profile(p_company_code text, p_client_code text)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT json_build_object(
    'id', cl.id, 'company_id', cl.company_id, 'client_code', cl.client_code,
    'name', cl.name, 'legal_name', cl.legal_name, 'company_number', cl.company_number,
    'vat_number', cl.vat_number, 'contact_person', cl.contact_person,
    'email', cl.email, 'phone', cl.phone, 'mobile', cl.mobile, 'direct_line', cl.direct_line,
    'fax', cl.fax, 'website', cl.website, 'address', cl.address, 'billing_address', cl.billing_address,
    -- HR-only fields, shown read-only
    'account_number', cl.account_number, 'payment_terms_days', cl.payment_terms_days,
    'credit_limit', cl.credit_limit, 'tax_exempt', cl.tax_exempt,
    'contacts', coalesce((
      SELECT json_agg(json_build_object('id', cc.id, 'name', cc.name, 'email', cc.email,
                                        'include_in_emails', cc.include_in_emails)
                      ORDER BY cc.sort_order, cc.created_at)
      FROM public.client_contacts cc
      WHERE cc.client_id = cl.id AND cc.company_id = cl.company_id
    ), '[]'::json)
  )
  FROM public._client_portal_client(p_company_code, p_client_code) x
  JOIN public.clients cl ON cl.id = x.client_id AND cl.company_id = x.company_id;
$$;

CREATE OR REPLACE FUNCTION public.notify_hr_client_profile_updated(
  p_company_id uuid, p_client_id uuid, p_changes_summary text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_hour text := to_char(now(), 'YYYYMMDDHH24');
  r record;
BEGIN
  SELECT coalesce(nullif(trim(name), ''), 'Client') INTO v_name FROM public.clients WHERE id = p_client_id;
  FOR r IN
    SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
    FROM public.employees e
    WHERE e.company_id = p_company_id AND e.is_active = true AND e.user_id IS NOT NULL
      AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  LOOP
    INSERT INTO public.app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data)
    VALUES (
      p_company_id, 'hr', r.auth_user_id, r.employee_id,
      'client_profile_updated', 'Client Details Updated',
      coalesce(v_name, 'Client') || ' updated their details in the client portal (' || p_changes_summary || '). See the client''s Activity tab.',
      'client', p_client_id::text,
      'client_profile_updated:' || p_client_id::text || ':' || r.employee_id::text || ':' || v_hour,
      jsonb_build_object('client_id', p_client_id, 'changes', p_changes_summary))
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$$;

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

  IF jsonb_array_length(v_changes) > 0 THEN
    v_summary := (SELECT string_agg(x->>'label', ', ') FROM jsonb_array_elements(v_changes) x);
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
    VALUES (v_company_id, NULL, 'ClientPortal', 'client_profile_updated', 'info',
            jsonb_build_object('client_id', v_client_id::text, 'source', 'client_portal', 'field_changes', v_changes),
            now());
    PERFORM public.notify_hr_client_profile_updated(v_company_id, v_client_id, v_summary);
  END IF;

  RETURN public.client_portal_get_profile(p_company_code, p_client_code);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_hr_client_profile_updated(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_portal_get_profile(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_update_profile(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_get_profile(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_update_profile(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated;
