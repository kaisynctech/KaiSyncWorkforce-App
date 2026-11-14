-- The client's side of a quotation (piece 8a). Additions only, except the acceptance step (6), which keeps the
-- old behaviour for quotations without a deposit; its previous definition is saved in _fn_backup first.
--
-- 1. Links the office can share by WhatsApp (not only by email).
-- 2. "Seen" for many quotations at once (the quotations list).
-- 3. Questions and answers on a quotation (two-way, decided 14 Nov 2026).
-- 4-5. The client's choice between a line and its options, then the totals worked out again.
-- 6. Acceptance with a deposit issues a numbered deposit invoice straight away (decided 14 Nov 2026) so the client
--    can pay it from the same page; without a deposit it is the draft invoice for the full amount, as before.

-- 1. A private link for a quotation or invoice: the existing one if there is one, else a new one.
CREATE OR REPLACE FUNCTION public.document_link_for(p_kind text, p_doc_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid; v_token text;
BEGIN
  IF p_kind = 'quote' THEN
    SELECT company_id INTO v_company FROM public.commercial_quotes WHERE id = p_doc_id;
  ELSIF p_kind = 'invoice' THEN
    SELECT company_id INTO v_company FROM public.finance_invoices WHERE id = p_doc_id;
  ELSE
    RAISE EXCEPTION 'BAD_KIND';
  END IF;
  IF v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(v_company, CASE WHEN p_kind = 'quote' THEN 'quotes.edit' ELSE 'invoices.edit' END) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT token INTO v_token FROM public.document_links
    WHERE doc_id = p_doc_id AND kind = p_kind AND company_id = v_company AND expires_at > now() + interval '14 days'
    ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NULL THEN
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.document_links (token, company_id, kind, doc_id) VALUES (v_token, v_company, p_kind, p_doc_id);
  END IF;
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.document_link_for(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_link_for(text, uuid) TO authenticated;

-- 2. Seen / views for a list of documents of the user's companies.
CREATE OR REPLACE FUNCTION public.document_link_stats(p_doc_ids uuid[])
RETURNS TABLE (doc_id uuid, views integer, first_viewed_at timestamptz, last_viewed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.doc_id, coalesce(sum(l.view_count), 0)::int, min(l.first_viewed_at), max(l.last_viewed_at)
  FROM public.document_links l
  WHERE l.doc_id = ANY (p_doc_ids) AND l.company_id = ANY (public.user_company_ids())
  GROUP BY l.doc_id
$$;
REVOKE ALL ON FUNCTION public.document_link_stats(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_link_stats(uuid[]) TO authenticated;

-- 3. Questions from the client and answers from the office, on one quotation (or invoice).
CREATE TABLE IF NOT EXISTS public.document_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quote', 'invoice')),
  doc_id uuid NOT NULL,
  from_client boolean NOT NULL,
  author_name text,
  author_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_messages_doc_idx ON public.document_messages (doc_id, created_at);
ALTER TABLE public.document_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_messages_read ON public.document_messages;
CREATE POLICY document_messages_read ON public.document_messages FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, CASE WHEN kind = 'quote' THEN 'quotes.view' ELSE 'invoices.view' END));
-- The office answers (clients write through the public_document function only).
DROP POLICY IF EXISTS document_messages_reply ON public.document_messages;
CREATE POLICY document_messages_reply ON public.document_messages FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND NOT from_client
    AND author_employee_id = public._my_employee_id(company_id)
    AND public.user_has_permission(company_id, CASE WHEN kind = 'quote' THEN 'quotes.edit' ELSE 'invoices.edit' END));
-- Marking the client's questions as read.
DROP POLICY IF EXISTS document_messages_mark_read ON public.document_messages;
CREATE POLICY document_messages_mark_read ON public.document_messages FOR UPDATE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND from_client
    AND public.user_has_permission(company_id, CASE WHEN kind = 'quote' THEN 'quotes.view' ELSE 'invoices.view' END))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND from_client);
REVOKE ALL ON public.document_messages FROM anon;

-- 4. Totals of a quotation worked out again from its counted lines (options not chosen are excluded), with the
--    contingency line kept in step and the deposit from its %.
CREATE OR REPLACE FUNCTION public._quote_recalc(p_quote_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.commercial_quotes%ROWTYPE; v_rate numeric; v_base numeric; v_amt numeric; v_dep numeric;
BEGIN
  SELECT * INTO q FROM public.commercial_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_rate := CASE WHEN coalesce(q.subtotal, 0) > 0 THEN round(coalesce(q.vat_amount, 0) / q.subtotal, 4) ELSE 0 END;
  IF coalesce(q.contingency_percent, 0) > 0 THEN
    SELECT coalesce(sum(subtotal_sell), 0) INTO v_base FROM public.commercial_quote_lines
      WHERE quote_id = q.id AND NOT coalesce(is_excluded, false) AND coalesce(extra->>'kind', '') <> 'contingency';
    v_amt := round(v_base * q.contingency_percent / 100, 2);
    UPDATE public.commercial_quote_lines SET unit_sell_price = v_amt, subtotal_sell = v_amt, quantity = 1,
      vat_amount = round(v_amt * v_rate, 4), line_total = round(v_amt * (1 + v_rate), 4)
    WHERE quote_id = q.id AND extra->>'kind' = 'contingency';
  END IF;
  UPDATE public.commercial_quotes c SET
    subtotal = s.sub, vat_amount = round(s.sub * v_rate, 2), total_amount = round(s.sub * (1 + v_rate), 2),
    cost_total = s.cost, gross_profit = s.sub - s.cost,
    gross_margin_percent = CASE WHEN s.sub > 0 THEN round((s.sub - s.cost) / s.sub * 100, 2) ELSE 0 END,
    updated_at = now()
  FROM (SELECT coalesce(sum(subtotal_sell), 0) AS sub, coalesce(sum(subtotal_cost), 0) AS cost
        FROM public.commercial_quote_lines WHERE quote_id = p_quote_id AND NOT coalesce(is_excluded, false)) s
  WHERE c.id = p_quote_id;
  v_dep := nullif(q.header_values->>'__deposit_pct', '')::numeric;
  IF v_dep > 0 THEN
    UPDATE public.commercial_quotes SET deposit_required = round(total_amount * v_dep / 100, 2) WHERE id = p_quote_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._quote_recalc(uuid) FROM PUBLIC, anon, authenticated;

-- 5. The client's choices: p_choices is a list of option line ids. Each chosen option replaces its line.
CREATE OR REPLACE FUNCTION public._quote_apply_choices(p_quote_id uuid, p_choices jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_opt record; v_n integer := 0;
BEGIN
  FOR v_opt IN
    SELECT l.id, l.option_of FROM public.commercial_quote_lines l
    WHERE l.quote_id = p_quote_id AND l.option_of IS NOT NULL
      AND l.id::text IN (SELECT jsonb_array_elements_text(coalesce(p_choices, '[]'::jsonb)))
  LOOP
    -- One choice per line: the line and its other options step aside.
    UPDATE public.commercial_quote_lines SET is_excluded = true
      WHERE quote_id = p_quote_id AND (id = v_opt.option_of OR option_of = v_opt.option_of);
    UPDATE public.commercial_quote_lines SET is_excluded = false, is_optional = false,
      extra = extra || jsonb_build_object('chosen_by_client', true)
      WHERE id = v_opt.id;
    v_n := v_n + 1;
  END LOOP;
  IF v_n > 0 THEN PERFORM public._quote_recalc(p_quote_id); END IF;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._quote_apply_choices(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 6. Acceptance → invoice. With a deposit: an issued (numbered) deposit invoice the client can pay now; the rest is
--    invoiced from the order later (the final invoice already takes off deposits). Without one: as before.
CREATE TABLE IF NOT EXISTS public._fn_backup (name text PRIMARY KEY, def text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public._fn_backup (name, def)
  SELECT '_trg_quote_accepted_invoice before deposits', pg_get_functiondef('public._trg_quote_accepted_invoice()'::regprocedure)
  WHERE NOT EXISTS (SELECT 1 FROM public._fn_backup WHERE name = '_trg_quote_accepted_invoice before deposits');

CREATE OR REPLACE FUNCTION public._quote_accept_invoice(p_quote_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.commercial_quotes%ROWTYPE; v_id uuid; v_rate numeric; v_pct numeric; v_sub numeric; v_vat numeric;
  v_terms int; v_desc text;
BEGIN
  SELECT * INTO q FROM public.commercial_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  IF coalesce(q.deposit_required, 0) <= 0 OR q.client_id IS NULL THEN
    RETURN public._quote_to_draft_invoice(p_quote_id);
  END IF;
  -- Already has an open invoice (e.g. accepted, then changed): use it.
  SELECT id INTO v_id FROM public.finance_invoices
    WHERE company_id = q.company_id AND quote_id = q.id AND coalesce(status, '') NOT IN ('voided', 'cancelled')
    ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_rate := CASE WHEN coalesce(q.subtotal, 0) > 0 THEN round(coalesce(q.vat_amount, 0) / q.subtotal, 4) ELSE 0 END;
  v_pct := coalesce(nullif(q.header_values->>'__deposit_pct', '')::numeric,
                    CASE WHEN coalesce(q.total_amount, 0) > 0 THEN round(q.deposit_required / q.total_amount * 100, 4) END);
  v_sub := round(coalesce(q.subtotal, 0) * v_pct / 100, 2);
  v_vat := round(v_sub * v_rate, 2);
  SELECT coalesce(q.payment_terms_days, c.payment_terms_days, 30) INTO v_terms FROM public.clients c WHERE c.id = q.client_id;
  v_desc := regexp_replace(trim('Deposit ' || trim_scale(round(v_pct, 2))::text || '% of quotation ' || coalesce(q.quote_number, '')
            || CASE WHEN nullif(trim(q.title), '') IS NOT NULL AND q.title <> 'Untitled Quote' THEN ' · ' || q.title ELSE '' END), '\s+', ' ', 'g');
  INSERT INTO public.finance_invoices (company_id, client_id, deal_id, project_id, job_id, quote_id, invoice_number, status,
    currency, subtotal, vat_rate, vat_amount, total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type,
    issue_date, due_date, invoice_type, notes)
  VALUES (q.company_id, q.client_id, q.deal_id, q.deal_id, q.job_id, q.id, NULL, 'draft',
    coalesce(q.currency, 'ZAR'), v_sub, v_rate, v_vat, v_sub + v_vat, 0, v_sub + v_vat, false,
    CASE WHEN v_rate > 0 THEN 'standard' ELSE 'exempt' END,
    current_date, current_date + least(coalesce(v_terms, 30), 7), 'standard',
    'Deposit for quotation ' || coalesce(q.quote_number, '') || ' (accepted).')
  RETURNING id INTO v_id;
  INSERT INTO public.finance_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, subtotal,
    vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type, item_type, source_id, unit)
  VALUES (q.company_id, v_id, 1, v_desc, 1, v_sub, v_sub, v_rate, v_vat, v_sub + v_vat, false,
    CASE WHEN v_rate > 0 THEN 'standard' ELSE 'exempt' END, 'custom', NULL, NULL);
  -- Issued now: it gets its number, goes on the client's account and to Xero like any sent invoice.
  UPDATE public.finance_invoices SET status = 'sent' WHERE id = v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._quote_accept_invoice(uuid) FROM PUBLIC, anon, authenticated;

-- The acceptance trigger (office "Mark accepted" and online) now goes through step 6. Everything else unchanged.
CREATE OR REPLACE FUNCTION public._trg_quote_accepted_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv uuid; v_office boolean; v_client text; v_deposit boolean;
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  v_deposit := coalesce(NEW.deposit_required, 0) > 0;
  BEGIN
    v_inv := public._quote_accept_invoice(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    v_inv := NULL;   -- never block the acceptance itself
  END;
  v_office := EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = NEW.company_id AND e.user_id = auth.uid());
  IF NOT v_office THEN
    SELECT name INTO v_client FROM public.clients WHERE id = NEW.client_id;
    PERFORM public._notify_office(
      NEW.company_id, 'quote_accepted_online',
      trim(coalesce(v_client, 'A client') || ' accepted quote ' || coalesce(NEW.quote_number, '')),
      coalesce(v_client, 'The client') || ' accepted ' || coalesce(NEW.quote_number, 'the quote')
        || CASE WHEN v_inv IS NULL THEN '.'
                WHEN v_deposit THEN '. The deposit invoice was sent to them on the quotation page.'
                ELSE '. A draft invoice is ready for you to check and send.' END,
      CASE WHEN v_inv IS NOT NULL THEN 'invoice' ELSE 'quote' END,
      coalesce(v_inv, NEW.id)::text, 'quote_accepted:' || NEW.id::text,
      jsonb_build_object('quote_id', NEW.id, 'invoice_id', v_inv));
  END IF;
  RETURN NEW;
END $$;

-- Check
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname IN ('document_link_for', 'document_link_stats', '_quote_recalc',
     '_quote_apply_choices', '_quote_accept_invoice')) AS functions,                       -- 5
  (SELECT count(*) FROM pg_policies WHERE tablename = 'document_messages') AS message_policies, -- 3
  (SELECT count(*) FROM public._fn_backup WHERE name = '_trg_quote_accepted_invoice before deposits') AS backup; -- 1
