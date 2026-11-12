-- Client portal and linked companies: a "Quotes" list on the dashboard (waiting for an answer first), each with a
-- secure link to the quote page where the client downloads the PDF and accepts or declines (the same page the
-- quote email links to). Accepting there also updates the project (trg_quote_project_sync).
-- Rollback: DROP FUNCTION public.client_portal_list_quotes(text, text); DROP FUNCTION public.linked_list_quotes(uuid, uuid);
--           DROP FUNCTION public._cpc_list_quotes(uuid); DROP FUNCTION public._quote_public_token(uuid);

-- The quote's public page token (reuses a live one, otherwise makes one that lasts 180 days).
CREATE OR REPLACE FUNCTION public._quote_public_token(p_quote_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token text; v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.commercial_quotes WHERE id = p_quote_id;
  IF v_company IS NULL THEN RETURN NULL; END IF;
  SELECT token INTO v_token FROM public.document_links
   WHERE doc_id = p_quote_id AND kind = 'quote' AND expires_at > now() + interval '14 days'
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NULL THEN
    v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    INSERT INTO public.document_links (token, company_id, kind, doc_id) VALUES (v_token, v_company, 'quote', p_quote_id);
  END IF;
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public._quote_public_token(uuid) FROM PUBLIC, anon, authenticated;

-- The client's quotes: waiting for an answer, plus answered ones from the last 90 days. Never drafts.
CREATE OR REPLACE FUNCTION public._cpc_list_quotes(p_client uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v json;
BEGIN
  IF p_client IS NULL THEN RETURN '[]'::json; END IF;
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.waiting DESC, t.sent_at DESC NULLS LAST), '[]'::json) INTO v
  FROM (
    SELECT q.id, q.quote_number, q.title, q.status, q.currency, q.subtotal, q.vat_amount, q.total_amount,
           q.valid_until, q.sent_at, q.accepted_at, q.declined_at, q.deal_id, d.title AS project_title,
           (q.status IN ('sent', 'viewed') AND (q.valid_until IS NULL OR q.valid_until >= current_date)) AS waiting,
           (q.valid_until IS NOT NULL AND q.valid_until < current_date AND q.status IN ('sent', 'viewed')) AS expired,
           public._quote_public_token(q.id) AS link_token
    FROM public.commercial_quotes q
    JOIN public.clients cl ON cl.id = q.client_id AND cl.company_id = q.company_id
    LEFT JOIN public.client_deals d ON d.id = q.deal_id
    WHERE cl.id = p_client
      AND (d.id IS NULL OR d.visibility <> 'private')
      AND (q.status IN ('sent', 'viewed')
           OR (q.status IN ('accepted', 'declined') AND coalesce(q.accepted_at, q.declined_at, q.updated_at) > now() - interval '90 days'))
    LIMIT 50
  ) t;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public._cpc_list_quotes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_list_quotes(p_company_code text, p_client_code text) RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_list_quotes(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.linked_list_quotes(p_company_id uuid, p_link_id uuid) RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_list_quotes(public._linked_client(p_company_id, p_link_id));
$$;
-- Same access as the other portal / linked list functions.
REVOKE ALL ON FUNCTION public.client_portal_list_quotes(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.linked_list_quotes(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_list_quotes(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linked_list_quotes(uuid, uuid) TO authenticated;
