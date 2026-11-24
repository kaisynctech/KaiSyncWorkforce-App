-- Extra client identity, phone lines, and additional people.
-- Bank details stay off this table.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS company_number text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS mobile text,
  ADD COLUMN IF NOT EXISTS direct_line text,
  ADD COLUMN IF NOT EXISTS fax text;

COMMENT ON COLUMN public.clients.account_number IS
  'External account number, such as the Xero contact account number.';
COMMENT ON COLUMN public.clients.legal_name IS
  'Registered legal name when it differs from the trading name.';
COMMENT ON COLUMN public.clients.company_number IS
  'Company registration number.';
COMMENT ON COLUMN public.clients.website IS
  'Client website.';
COMMENT ON COLUMN public.clients.mobile IS
  'Mobile phone, kept separate from clients.phone.';
COMMENT ON COLUMN public.clients.direct_line IS
  'Direct dial number.';
COMMENT ON COLUMN public.clients.fax IS
  'Fax number.';

CREATE TABLE public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  include_in_emails boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_contacts_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX idx_client_contacts_client_sort
  ON public.client_contacts (client_id, sort_order);
CREATE INDEX idx_client_contacts_company_client
  ON public.client_contacts (company_id, client_id);

COMMENT ON TABLE public.client_contacts IS
  'Additional people on a client. The primary contact stays on clients.contact_person.';

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_contacts_select ON public.client_contacts
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.view')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_contacts.client_id
        AND c.company_id = client_contacts.company_id
    )
  );

CREATE POLICY client_contacts_insert ON public.client_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_contacts.client_id
        AND c.company_id = client_contacts.company_id
    )
  );

CREATE POLICY client_contacts_update ON public.client_contacts
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

CREATE POLICY client_contacts_delete ON public.client_contacts
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_contacts TO authenticated;
REVOKE ALL ON public.client_contacts FROM anon;
