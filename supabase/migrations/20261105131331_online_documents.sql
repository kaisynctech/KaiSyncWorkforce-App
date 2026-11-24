-- Online documents: a private link in invoice and quote emails. The client opens it without a login and can
-- download the PDF, see the banking details and send proof of payment (invoices), or accept / decline
-- (quotes). The link is a long random token; only the public_document edge function (service role) reads it.

CREATE TABLE IF NOT EXISTS public.document_links (
  token text PRIMARY KEY CHECK (length(token) >= 32),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice', 'quote')),
  doc_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '180 days',
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS document_links_doc_idx ON public.document_links (doc_id);
ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;
-- No policies: nobody reads this table directly. Office staff see "viewed" through document_link_status().
REVOKE ALL ON public.document_links FROM anon, authenticated;

-- When the client last opened the online invoice / quote (for the office screens).
CREATE OR REPLACE FUNCTION public.document_link_status(p_doc_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object('first_viewed_at', min(l.first_viewed_at), 'last_viewed_at', max(l.last_viewed_at),
                           'views', coalesce(sum(l.view_count), 0))
  FROM public.document_links l
  WHERE l.doc_id = p_doc_id AND l.company_id = ANY (public.user_company_ids())
$$;
REVOKE ALL ON FUNCTION public.document_link_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_link_status(uuid) TO authenticated;

-- Tell the office (owner, admin, HR, managers) about something a client did online.
CREATE OR REPLACE FUNCTION public._notify_office(p_company_id uuid, p_type text, p_title text, p_body text,
  p_ref_type text, p_ref_id text, p_key text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.app_notifications (company_id, audience, recipient_auth_user_id, recipient_employee_id,
    type, title, body, ref_type, ref_id, dedupe_key, data)
  SELECT p_company_id, 'hr', e.user_id, e.id, p_type, p_title, p_body, p_ref_type, p_ref_id, p_key || ':' || e.id, p_data
  FROM public.employees e
  WHERE e.company_id = p_company_id AND e.is_active AND e.user_id IS NOT NULL
    AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
$$;
REVOKE ALL ON FUNCTION public._notify_office(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- An accepted quote becomes a draft invoice: same client, lines, prices and VAT. One invoice per quote
-- (a voided or cancelled one does not count). Returns the invoice id.
CREATE OR REPLACE FUNCTION public._quote_to_draft_invoice(p_quote_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.commercial_quotes%ROWTYPE; v_id uuid; v_rate numeric; v_terms int;
BEGIN
  SELECT * INTO q FROM public.commercial_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  SELECT id INTO v_id FROM public.finance_invoices
    WHERE company_id = q.company_id AND quote_id = q.id AND coalesce(status, '') NOT IN ('voided', 'cancelled')
    ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_rate := CASE WHEN coalesce(q.subtotal, 0) > 0 THEN round(coalesce(q.vat_amount, 0) / q.subtotal, 4) ELSE 0 END;
  SELECT coalesce(q.payment_terms_days, c.payment_terms_days, 30) INTO v_terms FROM public.clients c WHERE c.id = q.client_id;
  INSERT INTO public.finance_invoices (company_id, client_id, deal_id, project_id, job_id, quote_id, invoice_number, status,
    currency, subtotal, vat_rate, vat_amount, total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type,
    issue_date, due_date, invoice_type, notes)
  VALUES (q.company_id, q.client_id, q.deal_id, q.deal_id, q.job_id, q.id, NULL, 'draft',
    coalesce(q.currency, 'ZAR'), coalesce(q.subtotal, 0), v_rate, coalesce(q.vat_amount, 0), coalesce(q.total_amount, 0), 0,
    coalesce(q.total_amount, 0), false, CASE WHEN v_rate > 0 THEN 'standard' ELSE 'exempt' END,
    current_date, current_date + coalesce(v_terms, 30), 'standard',
    'From quote ' || coalesce(q.quote_number, '') || ', accepted online.')
  RETURNING id INTO v_id;
  INSERT INTO public.finance_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, subtotal,
    vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type, item_type, source_id, unit)
  SELECT q.company_id, v_id, row_number() OVER (ORDER BY l.sort_order, l.created_at),
    coalesce(nullif(trim(l.description), ''), q.title), coalesce(l.quantity, 1), coalesce(l.unit_sell_price, 0),
    coalesce(l.subtotal_sell, 0), coalesce(l.vat_rate, v_rate), coalesce(l.vat_amount, 0), coalesce(l.line_total, 0), false,
    CASE WHEN v_rate > 0 THEN 'standard' ELSE 'exempt' END,
    CASE WHEN l.job_service_id IS NOT NULL THEN 'service' WHEN l.inventory_item_id IS NOT NULL THEN 'inventory'
         WHEN l.catalogue_item_id IS NOT NULL THEN 'catalogue' ELSE 'custom' END,
    coalesce(l.job_service_id, l.inventory_item_id, l.catalogue_item_id), l.unit
  FROM public.commercial_quote_lines l
  WHERE l.quote_id = q.id AND NOT coalesce(l.is_excluded, false);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._quote_to_draft_invoice(uuid) FROM PUBLIC, anon, authenticated;
