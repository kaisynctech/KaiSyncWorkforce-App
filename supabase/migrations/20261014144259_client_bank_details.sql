-- Client bank details for refunds. Kept off public.clients so the client
-- list and client export do not download account numbers.
-- Readable and writable only by people who can edit clients.

CREATE TABLE public.client_bank_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  account_holder text,
  bank_name text,
  account_number text,
  branch_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_bank_details_client_unique UNIQUE (client_id),
  CONSTRAINT client_bank_details_has_detail CHECK (
    nullif(btrim(coalesce(account_holder, '')), '') IS NOT NULL
    OR nullif(btrim(coalesce(bank_name, '')), '') IS NOT NULL
    OR nullif(btrim(coalesce(account_number, '')), '') IS NOT NULL
    OR nullif(btrim(coalesce(branch_code, '')), '') IS NOT NULL
  )
);

CREATE INDEX idx_client_bank_details_company_client
  ON public.client_bank_details (company_id, client_id);

COMMENT ON TABLE public.client_bank_details IS
  'Bank account used when a client refund must be paid. One row per client.';

ALTER TABLE public.client_bank_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_bank_details_select ON public.client_bank_details
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_bank_details.client_id
        AND c.company_id = client_bank_details.company_id
    )
  );

CREATE POLICY client_bank_details_insert ON public.client_bank_details
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_bank_details.client_id
        AND c.company_id = client_bank_details.company_id
    )
  );

CREATE POLICY client_bank_details_update ON public.client_bank_details
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

CREATE POLICY client_bank_details_delete ON public.client_bank_details
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_bank_details TO authenticated;
REVOKE ALL ON public.client_bank_details FROM anon;

CREATE OR REPLACE FUNCTION public.audit_client_bank_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_client uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_company := COALESCE(NEW.company_id, OLD.company_id);
  v_client := COALESCE(NEW.client_id, OLD.client_id);
  IF TG_OP = 'INSERT' THEN
    v_before := NULL;
  ELSE
    v_before := jsonb_build_object(
      'account_holder', OLD.account_holder,
      'bank_name', OLD.bank_name,
      'account_last4', CASE
        WHEN length(regexp_replace(COALESCE(OLD.account_number, ''), '\s', '', 'g')) < 4 THEN NULL
        ELSE RIGHT(regexp_replace(COALESCE(OLD.account_number, ''), '\s', '', 'g'), 4)
      END,
      'branch_code', OLD.branch_code
    );
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_after := NULL;
  ELSE
    v_after := jsonb_build_object(
      'account_holder', NEW.account_holder,
      'bank_name', NEW.bank_name,
      'account_last4', CASE
        WHEN length(regexp_replace(COALESCE(NEW.account_number, ''), '\s', '', 'g')) < 4 THEN NULL
        ELSE RIGHT(regexp_replace(COALESCE(NEW.account_number, ''), '\s', '', 'g'), 4)
      END,
      'branch_code', NEW.branch_code
    );
  END IF;

  BEGIN
    PERFORM public.write_audit_event(
      v_company,
      'client.banking_updated',
      'client',
      v_client::text,
      v_before,
      v_after,
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_client_bank_details() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER client_bank_details_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.client_bank_details
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_client_bank_details();
