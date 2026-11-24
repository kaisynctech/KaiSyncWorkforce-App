-- Send from your own domain: a company proves it owns its domain (DNS records with our email provider,
-- Resend). Once verified, emails to its clients, suppliers and staff come from e.g. accounts@theircompany.co.za
-- instead of the KaiSync address. Managed only through the company_email_domain edge function.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email_domain text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email_domain_id text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email_domain_status text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email_domain_records jsonb;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email_domain_checked_at timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email_from_local text NOT NULL DEFAULT 'accounts'
  CHECK (email_from_local ~ '^[a-z0-9][a-z0-9._-]{0,40}$');
CREATE UNIQUE INDEX IF NOT EXISTS companies_email_domain_uq ON public.companies (lower(email_domain)) WHERE email_domain IS NOT NULL;

-- The address a company's emails come from: its own once verified, otherwise the KaiSync one (NULL).
CREATE OR REPLACE FUNCTION public.company_sender_address(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN email_domain_status = 'verified' AND email_domain IS NOT NULL
              THEN email_from_local || '@' || lower(email_domain) END
  FROM public.companies WHERE id = p_company_id
$$;
REVOKE ALL ON FUNCTION public.company_sender_address(uuid) FROM PUBLIC, anon, authenticated;

-- Only the company_email_domain function (service role) changes these; the app can't mark a domain verified.
CREATE OR REPLACE FUNCTION public._guard_company_email_domain()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.email_domain := OLD.email_domain;
    NEW.email_domain_id := OLD.email_domain_id;
    NEW.email_domain_status := OLD.email_domain_status;
    NEW.email_domain_records := OLD.email_domain_records;
    NEW.email_domain_checked_at := OLD.email_domain_checked_at;
    NEW.email_from_local := OLD.email_from_local;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER guard_company_email_domain BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public._guard_company_email_domain();
