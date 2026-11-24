-- 20261021080547_client_portal_get_profile
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

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
GRANT EXECUTE ON FUNCTION public.client_portal_get_profile(text, text) TO anon, authenticated;
