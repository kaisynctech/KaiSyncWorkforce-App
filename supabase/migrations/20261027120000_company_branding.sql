-- Company branding & details: public logo, company profile and banking details for documents,
-- and a public lookup so the client / contractor portals show the company they belong to.

-- 1. Company details (Settings › General). Existing: name, address, contact_email, contact_phone,
--    is_vat_registered, vat_number, logo_url (old private logo path).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS legal_name text CHECK (legal_name IS NULL OR char_length(legal_name) <= 200),
  ADD COLUMN IF NOT EXISTS registration_number text CHECK (registration_number IS NULL OR char_length(registration_number) <= 60),
  ADD COLUMN IF NOT EXISTS website text CHECK (website IS NULL OR char_length(website) <= 200),
  ADD COLUMN IF NOT EXISTS postal_address text CHECK (postal_address IS NULL OR char_length(postal_address) <= 500),
  ADD COLUMN IF NOT EXISTS bank_account_holder text CHECK (bank_account_holder IS NULL OR char_length(bank_account_holder) <= 200),
  ADD COLUMN IF NOT EXISTS bank_name text CHECK (bank_name IS NULL OR char_length(bank_name) <= 120),
  ADD COLUMN IF NOT EXISTS bank_account_number text CHECK (bank_account_number IS NULL OR char_length(bank_account_number) <= 40),
  ADD COLUMN IF NOT EXISTS bank_branch_code text CHECK (bank_branch_code IS NULL OR char_length(bank_branch_code) <= 20),
  ADD COLUMN IF NOT EXISTS bank_account_type text CHECK (bank_account_type IS NULL OR char_length(bank_account_type) <= 40),
  ADD COLUMN IF NOT EXISTS bank_swift_code text CHECK (bank_swift_code IS NULL OR char_length(bank_swift_code) <= 20),
  ADD COLUMN IF NOT EXISTS show_bank_on_invoices boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_bank_on_quotes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS document_footer text CHECK (document_footer IS NULL OR char_length(document_footer) <= 1000),
  ADD COLUMN IF NOT EXISTS brand_logo_path text CHECK (brand_logo_path IS NULL OR char_length(brand_logo_path) <= 300);

-- 2. Public bucket for logos only (logos are shown to clients, contractors, in emails and PDFs).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('company-branding', 'company-branding', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- Files live under <company id>/...; HR and above of that company may add, replace and remove them.
CREATE POLICY p_company_branding_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    AND role_is_hr_or_above(get_my_role(((storage.foldername(name))[1])::uuid)));
CREATE POLICY p_company_branding_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    AND role_is_hr_or_above(get_my_role(((storage.foldername(name))[1])::uuid)));
CREATE POLICY p_company_branding_remove ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    AND role_is_hr_or_above(get_my_role(((storage.foldername(name))[1])::uuid)));

-- 3. HR and above set or clear the logo (company details stay owner-only through the companies policy).
CREATE OR REPLACE FUNCTION public.set_company_brand_logo(p_company_id uuid, p_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF p_path IS NOT NULL AND (p_path NOT LIKE p_company_id::text || '/%' OR char_length(p_path) > 300) THEN
    RAISE EXCEPTION 'BAD_LOGO_PATH';
  END IF;
  UPDATE public.companies SET brand_logo_path = p_path WHERE id = p_company_id;
END $$;

-- 4. Public brand for the portals (name + public logo path only), by company code.
CREATE OR REPLACE FUNCTION public.company_brand_by_code(p_company_code text)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object('name', c.name, 'logo_path', c.brand_logo_path)
  FROM public.companies c
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
  LIMIT 1;
$$;
