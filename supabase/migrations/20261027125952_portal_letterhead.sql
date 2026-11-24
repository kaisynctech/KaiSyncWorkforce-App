-- Letterhead for documents downloaded from the portals (invoices and statements).
-- Client: company details, plus banking only when the company shows banking on invoices.
-- Contractor: company details only (the company pays the contractor, not the other way round).

-- Helper runs with the caller's rights (not SECURITY DEFINER): called directly by the public it
-- finds nothing (companies RLS); called from the portal functions below it runs as their owner.
CREATE OR REPLACE FUNCTION public._company_letterhead_json(p_company_id uuid, p_with_bank boolean)
RETURNS json
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT json_build_object(
    'name', c.name, 'legal_name', c.legal_name, 'registration_number', c.registration_number,
    'is_vat_registered', coalesce(c.is_vat_registered, false), 'vat_number', c.vat_number,
    'address', c.address, 'postal_address', c.postal_address,
    'contact_phone', c.contact_phone, 'contact_email', c.contact_email, 'website', c.website,
    'logo_path', c.brand_logo_path, 'document_footer', c.document_footer,
    'show_bank_on_invoices', p_with_bank AND c.show_bank_on_invoices,
    'show_bank_on_quotes', p_with_bank AND c.show_bank_on_quotes,
    'bank', CASE WHEN p_with_bank AND (c.show_bank_on_invoices OR c.show_bank_on_quotes) THEN json_build_object(
      'bank_account_holder', c.bank_account_holder, 'bank_name', c.bank_name,
      'bank_account_number', c.bank_account_number, 'bank_branch_code', c.bank_branch_code,
      'bank_account_type', c.bank_account_type, 'bank_swift_code', c.bank_swift_code) END
  )
  FROM public.companies c WHERE c.id = p_company_id;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_get_letterhead(p_company_code text, p_client_code text)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._company_letterhead_json(x.company_id, true)
  FROM public._client_portal_client(p_company_code, p_client_code) x
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.contractor_portal_get_letterhead(p_company_code text, p_contractor_code text)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._company_letterhead_json(c.id, false)
  FROM public.contractors ct
  JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.contractor_code IS NOT NULL
    AND ct.is_active = true
  LIMIT 1;
$$;
