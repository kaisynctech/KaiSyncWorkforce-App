-- 20261105133201_company_email_domain_guard
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

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
