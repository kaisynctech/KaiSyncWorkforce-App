-- Documents keep an explicit currency chosen on create/edit.
-- Inheritance only fills currency when the insert left it blank/null.
-- Rollback: restore previous _trg_doc_currency body from 20261106190000_currencies_2a.sql

CREATE OR REPLACE FUNCTION public._trg_doc_currency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_party text;
  v_home text;
BEGIN
  IF TG_TABLE_NAME IN ('finance_invoices', 'credit_notes', 'commercial_quotes') THEN
    IF NEW.client_id IS NULL THEN
      NEW.currency := upper(coalesce(nullif(trim(NEW.currency), ''), public.company_home_currency(NEW.company_id)));
      RETURN NEW;
    END IF;
    SELECT c.currency INTO v_party FROM public.clients c WHERE c.id = NEW.client_id;
  ELSE
    IF NEW.supplier_id IS NULL THEN
      NEW.currency := upper(coalesce(nullif(trim(NEW.currency), ''), public.company_home_currency(NEW.company_id)));
      RETURN NEW;
    END IF;
    SELECT c.currency INTO v_party FROM public.contractors c WHERE c.id = NEW.supplier_id;
  END IF;

  v_home := public.company_home_currency(NEW.company_id);

  -- Only inherit party currency when the document did not set one.
  IF nullif(trim(NEW.currency), '') IS NULL THEN
    NEW.currency := coalesce(nullif(upper(trim(v_party)), ''), v_home);
  ELSE
    NEW.currency := upper(trim(NEW.currency));
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public._trg_doc_currency() FROM PUBLIC, anon, authenticated;
