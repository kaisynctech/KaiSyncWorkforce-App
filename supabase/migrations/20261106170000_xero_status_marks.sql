-- Xero status marks on the lists (Release 1, approved by Nyarie 6 Nov 2026).
-- xero_doc_statuses: for a list of KaiSync records, each one's Xero state in one call:
--   'synced'  in Xero (with its Xero id, for "Open in Xero")
--   'waiting' queued / being sent
--   'error'   Xero refused it (with Xero's message)
--   'skipped' not sent, with the reason (e.g. dated before the company's Xero start date)
-- Records never sent are left out (the list offers "Send to Xero" on them). NULL for companies without Xero.
-- xero_send_now now also starts the worker straight away instead of waiting for the next minute.

CREATE OR REPLACE FUNCTION public.xero_doc_statuses(p_company_id uuid, p_kind text, p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link_entity text; v_queue text[]; v_out jsonb := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = p_company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true))
     AND NOT public.platform_is_admin() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.xero_connections WHERE company_id = p_company_id AND coalesce(is_active, true)) THEN
    RETURN NULL;   -- no Xero: the lists show no marks at all
  END IF;
  IF coalesce(array_length(p_ids, 1), 0) = 0 THEN RETURN v_out; END IF;
  v_link_entity := CASE p_kind WHEN 'invoice' THEN 'invoice' WHEN 'credit_note' THEN 'credit_note' WHEN 'po' THEN 'po_bill'
                               WHEN 'supplier_invoice' THEN 'supplier_bill' ELSE NULL END;
  v_queue := CASE p_kind WHEN 'invoice' THEN ARRAY['invoice', 'invoice_void'] WHEN 'credit_note' THEN ARRAY['credit_note']
                         WHEN 'po' THEN ARRAY['po_bill'] WHEN 'supplier_invoice' THEN ARRAY['supplier_bill', 'supplier_payment']
                         WHEN 'client' THEN ARRAY['client'] WHEN 'supplier' THEN ARRAY['supplier'] ELSE ARRAY[]::text[] END;

  SELECT coalesce(jsonb_object_agg(r.id::text, jsonb_strip_nulls(jsonb_build_object(
           's', CASE WHEN q.status IN ('pending', 'working') THEN 'waiting'
                     WHEN q.status = 'error' THEN 'error'
                     WHEN x.xero_id IS NOT NULL THEN 'synced'
                     WHEN q.status = 'skipped' THEN 'skipped' END,
           'err', CASE WHEN q.status IN ('error', 'skipped') THEN q.last_error END,
           'job', CASE WHEN q.status = 'error' THEN q.id END,
           'xid', x.xero_id, 'xst', x.xero_status, 'at', coalesce(q.done_at, x.at)))), '{}'::jsonb)
    INTO v_out
    FROM unnest(p_ids) AS r(id)
    LEFT JOIN LATERAL (
      SELECT sq.status, sq.last_error, sq.id, sq.done_at FROM public.xero_sync_queue sq
       WHERE sq.company_id = p_company_id AND sq.record_id = r.id AND sq.entity = ANY (v_queue)
       ORDER BY (sq.status IN ('pending', 'working', 'error')) DESC, sq.created_at DESC LIMIT 1) q ON true
    LEFT JOIN LATERAL (
      SELECT l.xero_id, l.xero_status, l.last_synced_at AS at FROM public.xero_doc_links l
       WHERE v_link_entity IS NOT NULL AND l.company_id = p_company_id AND l.entity = v_link_entity AND l.record_id = r.id
      UNION ALL
      SELECT c.xero_contact_id, NULL, c.last_synced_at FROM public.xero_contact_links c
       WHERE p_kind IN ('client', 'supplier') AND c.company_id = p_company_id AND c.record_id = r.id
         AND c.record_type = CASE p_kind WHEN 'client' THEN 'client' ELSE 'contractor' END
      LIMIT 1) x ON true
   WHERE q.status IS NOT NULL OR x.xero_id IS NOT NULL;
  RETURN v_out;
END $$;

-- "Send to Xero" now: queue it (any date) and start the worker straight away.
CREATE OR REPLACE FUNCTION public.xero_send_now(p_company_id uuid, p_entity text, p_record_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.xero_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_entity NOT IN ('client', 'supplier', 'invoice', 'credit_note', 'po_bill', 'supplier_bill') THEN RAISE EXCEPTION 'BAD_ENTITY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.xero_connections WHERE company_id = p_company_id AND coalesce(is_active, true)) THEN
    RAISE EXCEPTION 'XERO_NOT_CONNECTED'; END IF;
  INSERT INTO public.xero_sync_queue (company_id, entity, record_id, label)
  VALUES (p_company_id, p_entity, p_record_id, initcap(replace(p_entity, '_', ' ')))
  ON CONFLICT (company_id, entity, record_id) WHERE status IN ('pending', 'working', 'error')
  DO UPDATE SET status = CASE WHEN xero_sync_queue.status = 'working' THEN 'working' ELSE 'pending' END, next_attempt_at = now(), attempts = 0;
  PERFORM public.xero_sync_kick();
END $$;

-- Retrying from a list starts the worker straight away too.
CREATE OR REPLACE FUNCTION public.xero_retry(p_company_id uuid, p_job_id uuid DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT public.xero_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  UPDATE public.xero_sync_queue SET status = 'pending', next_attempt_at = now(), attempts = 0
   WHERE company_id = p_company_id AND status = 'error' AND (p_job_id IS NULL OR id = p_job_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN PERFORM public.xero_sync_kick(); END IF;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.xero_doc_statuses(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xero_doc_statuses(uuid, text, uuid[]) TO authenticated;
