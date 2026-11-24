-- Linked companies extras (approved 30 Oct 2026): at-a-glance numbers, work from all
-- contractors, proof of payment, alerts for the customer company, and per-link history.

-- ── 3. At a glance, per link (both sides) ───────────────────────────────────
-- Customer side: the provider's work visible to us. Provider side: our own client's work.
CREATE OR REPLACE FUNCTION public.linked_summary(p_company_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._company_link_office(p_company_id);
  RETURN coalesce((
    SELECT json_object_agg(l.id, json_build_object(
      'open_jobs', (SELECT count(*) FROM json_array_elements(public._cpc_list_jobs(l.provider_client_id)) j
                    WHERE j->>'status' NOT IN ('completed', 'cancelled', 'closed', 'invoiced')),
      'quotes_waiting', (SELECT count(*) FROM public.client_deals d
                         WHERE d.client_id = l.provider_client_id AND d.company_id = l.provider_company_id
                           AND d.visibility <> 'private' AND d.quotation_sent_at IS NOT NULL
                           AND d.quotation_response = 'pending'),
      'owing', (SELECT coalesce(sum(i.balance_due), 0) FROM public.finance_invoices i
                WHERE i.client_id = l.provider_client_id AND i.company_id = l.provider_company_id
                  AND i.status NOT IN ('draft', 'cancelled', 'voided', 'paid') AND i.voided_at IS NULL)))
    FROM public.company_links l
    WHERE l.status = 'active' AND p_company_id IN (l.provider_company_id, l.customer_company_id)
  ), '{}'::json);
END $$;

-- ── 5. Work from all my contractors (customer side) ─────────────────────────
CREATE OR REPLACE FUNCTION public.linked_work_overview(p_company_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; v_out jsonb := '[]'::jsonb; v_name text;
BEGIN
  PERFORM public._company_link_office(p_company_id);
  FOR l IN SELECT * FROM public.company_links WHERE status = 'active' AND customer_company_id = p_company_id LOOP
    SELECT name INTO v_name FROM public.companies WHERE id = l.provider_company_id;
    v_out := v_out || coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', 'job', 'link_id', l.id, 'provider', v_name, 'id', j->>'id',
               'ref', j->>'job_code', 'title', j->>'title', 'status', j->>'status', 'date', j->>'scheduled_start', 'amount', NULL))
      FROM json_array_elements(public._cpc_list_jobs(l.provider_client_id)) j
      WHERE j->>'status' NOT IN ('completed', 'cancelled', 'closed', 'invoiced')), '[]'::jsonb);
    v_out := v_out || coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', 'quote', 'link_id', l.id, 'provider', v_name, 'id', d.id,
               'ref', d.project_code, 'title', d.title, 'status', 'awaiting_you', 'date', d.quotation_sent_at, 'amount', d.offer_amount))
      FROM public.client_deals d
      WHERE d.client_id = l.provider_client_id AND d.company_id = l.provider_company_id AND d.visibility <> 'private'
        AND d.quotation_sent_at IS NOT NULL AND d.quotation_response = 'pending'), '[]'::jsonb);
    v_out := v_out || coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', 'invoice', 'link_id', l.id, 'provider', v_name, 'id', i->>'id',
               'ref', i->>'invoice_number', 'title', 'Invoice ' || coalesce(i->>'invoice_number', ''), 'status', i->>'status',
               'date', i->>'due_date', 'amount', (i->>'balance_due')::numeric))
      FROM json_array_elements(public._cpc_list_invoices(l.provider_client_id)) i
      WHERE i->>'status' NOT IN ('paid', 'cancelled', 'voided') AND coalesce((i->>'balance_due')::numeric, 0) > 0.009), '[]'::jsonb);
  END LOOP;
  RETURN v_out;
END $$;

-- ── 6. Proof of payment from a linked customer ──────────────────────────────
-- The file is uploaded first through linked_prepare_upload into the provider's
-- client_documents/<provider>/<client>/ folder; it lands in the provider's existing review.
CREATE OR REPLACE FUNCTION public.linked_submit_payment_proof(p_company_id uuid, p_link_id uuid, p_invoice_id uuid,
  p_storage_path text, p_amount numeric DEFAULT NULL, p_reference text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client public.clients%ROWTYPE; v_inv public.finance_invoices%ROWTYPE; v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_id uuid; v_customer text; v_by text;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = public._linked_client(p_company_id, p_link_id);
  IF public._cpc_get_invoice(v_client.id, p_invoice_id) IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  SELECT * INTO v_inv FROM public.finance_invoices WHERE id = p_invoice_id;
  IF v_inv.status IN ('paid', 'voided', 'cancelled') THEN RAISE EXCEPTION 'INVOICE_CLOSED'; END IF;
  IF v_path = '' OR v_path LIKE '%..%'
     OR left(v_path, length('client_documents/' || v_client.company_id || '/' || v_client.id || '/')) <> 'client_documents/' || v_client.company_id || '/' || v_client.id || '/' THEN
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN RAISE EXCEPTION 'BAD_AMOUNT'; END IF;
  INSERT INTO public.finance_payment_proofs (company_id, invoice_id, storage_path, file_url, amount, reference, notes, status)
  VALUES (v_client.company_id, p_invoice_id, v_path, NULL, p_amount, nullif(trim(coalesce(p_reference, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''), 'submitted')
  RETURNING id INTO v_id;
  UPDATE public.media_upload_grants SET consumed_at = now() WHERE storage_path = v_path AND consumed_at IS NULL;
  SELECT name INTO v_customer FROM public.companies WHERE id = p_company_id;
  v_by := public._linked_actor_name(p_company_id);
  INSERT INTO public.app_notifications (company_id, audience, recipient_auth_user_id, recipient_employee_id,
    type, title, body, ref_type, ref_id, dedupe_key, data)
  SELECT v_client.company_id, 'hr', e.user_id, e.id, 'linked_payment_proof', 'Proof of payment from ' || v_customer,
         v_by || ' sent proof of payment for invoice ' || coalesce(v_inv.invoice_number, '')
           || coalesce(' (R' || to_char(p_amount, 'FM999G999G990D00') || ')', '') || '. Review it on the invoice.',
         'invoice', p_invoice_id::text, 'linked_payment_proof:' || v_id || ':' || e.id,
         jsonb_build_object('invoice_id', p_invoice_id, 'proof_id', v_id, 'link_id', p_link_id)
  FROM public.employees e
  WHERE e.company_id = v_client.company_id AND e.is_active AND e.user_id IS NOT NULL
    AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_payment_proof_submitted',
    jsonb_build_object('invoice_id', p_invoice_id, 'proof_id', v_id, 'amount', p_amount));
  RETURN v_id;
END $$;

-- Proofs we sent for one invoice, with the provider's decision.
CREATE OR REPLACE FUNCTION public.linked_list_payment_proofs(p_company_id uuid, p_link_id uuid, p_invoice_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  v_client := public._linked_client(p_company_id, p_link_id);
  IF public._cpc_get_invoice(v_client, p_invoice_id) IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  RETURN coalesce((SELECT json_agg(json_build_object('id', p.id, 'amount', p.amount, 'reference', p.reference, 'status', p.status,
                     'submitted_at', p.submitted_at, 'review_notes', p.review_notes) ORDER BY p.submitted_at DESC)
                   FROM public.finance_payment_proofs p WHERE p.invoice_id = p_invoice_id AND p.resident_id IS NULL), '[]'::json);
END $$;

-- ── 8. History of one link (both companies) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.linked_link_history(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_links%ROWTYPE;
BEGIN
  PERFORM public._company_link_office(p_company_id);
  SELECT * INTO v_link FROM public.company_links WHERE id = p_link_id AND p_company_id IN (provider_company_id, customer_company_id);
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  RETURN coalesce((SELECT json_agg(x ORDER BY x.at DESC) FROM (
    SELECT * FROM (
      -- Link requested, accepted, declined, disconnected (each company holds its own copy).
      (SELECT DISTINCT ON (a.action, a.created_at) a.action, a.created_at AS at,
              (SELECT c.name FROM public.companies c WHERE c.id = (a.meta->>'actor_company_id')::uuid) AS who, NULL::jsonb AS details
       FROM public.audit_events a
       WHERE a.target_type = 'company_link' AND a.target_id = p_link_id::text AND a.company_id = p_company_id)
      UNION ALL
      -- Work done through the link by the customer company.
      (SELECT e.action, e.created_at, e.meta->>'by',
              jsonb_strip_nulls(jsonb_build_object('job_code', e.meta->>'job_code', 'amount', e.meta->'amount'))
       FROM public.app_events e
       WHERE e.company_id = v_link.provider_company_id AND e.screen = 'LinkedCompany' AND e.meta->>'link_id' = p_link_id::text)
      UNION ALL
      -- Alerts the provider's work sent to the customer company (one row per event, not per person).
      (SELECT DISTINCT ON (n.dedupe_key_base) n.type, n.created_at, n.who, jsonb_build_object('title', n.title)
       FROM (SELECT nn.type, nn.created_at, nn.data->>'by' AS who, nn.title,
                    regexp_replace(nn.dedupe_key, ':[^:]+$', '') AS dedupe_key_base
             FROM public.app_notifications nn
             WHERE nn.company_id = v_link.customer_company_id AND nn.type LIKE 'linked\_from\_provider\_%'
               AND nn.data->>'link_id' = p_link_id::text) n)
    ) u ORDER BY u.at DESC LIMIT 500
  ) x), '[]'::json);
END $$;

-- ── 4. Alerts for the customer company when the provider works for them ─────
-- Only for clients joined by an active link; never blocks the provider's own save.
CREATE OR REPLACE FUNCTION public._linked_notify_customer(p_client_id uuid, p_kind text, p_title text, p_body text,
  p_ref_type text, p_ref_id text, p_dedupe text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_links%ROWTYPE; v_provider text;
BEGIN
  SELECT * INTO v_link FROM public.company_links WHERE provider_client_id = p_client_id AND status = 'active' LIMIT 1;
  IF v_link.id IS NULL THEN RETURN; END IF;
  SELECT name INTO v_provider FROM public.companies WHERE id = v_link.provider_company_id;
  INSERT INTO public.app_notifications (company_id, audience, recipient_auth_user_id, recipient_employee_id,
    type, title, body, ref_type, ref_id, dedupe_key, data)
  SELECT v_link.customer_company_id, 'hr', e.user_id, e.id, 'linked_from_provider_' || p_kind,
         replace(p_title, '{provider}', v_provider), replace(p_body, '{provider}', v_provider),
         p_ref_type, p_ref_id, 'linked_from_provider:' || p_dedupe || ':' || e.id,
         jsonb_build_object('link_id', v_link.id, 'by', v_provider, 'ref_type', p_ref_type, 'ref_id', p_ref_id)
  FROM public.employees e
  WHERE e.company_id = v_link.customer_company_id AND e.is_active AND e.user_id IS NOT NULL
    AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
EXCEPTION WHEN others THEN
  RAISE WARNING 'linked customer alert skipped: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public._trg_linked_alert_deal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.quotation_sent_at IS NOT NULL AND NEW.quotation_sent_at IS DISTINCT FROM OLD.quotation_sent_at AND NEW.visibility <> 'private' THEN
    PERFORM public._linked_notify_customer(NEW.client_id, 'quote', 'Quote from {provider}',
      '{provider} sent you a quote for ' || coalesce(NEW.title, 'a project')
        || coalesce(' (R' || to_char(NEW.offer_amount, 'FM999G999G990D00') || ' excl. VAT)', '') || '. Open Linked companies to accept or ask for changes.',
      'project', NEW.id::text, 'quote:' || NEW.id || ':' || to_char(NEW.quotation_sent_at, 'YYYYMMDDHH24MISS'));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING 'linked quote alert skipped: %', SQLERRM; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_linked_alert_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.status NOT IN ('draft', 'cancelled', 'voided')
     AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    PERFORM public._linked_notify_customer(NEW.client_id, 'invoice', 'Invoice from {provider}',
      '{provider} sent invoice ' || coalesce(NEW.invoice_number, '') || ' for R' || to_char(NEW.total_amount, 'FM999G999G990D00')
        || coalesce(', due ' || to_char(NEW.due_date, 'DD Mon YYYY'), '') || '.',
      'invoice', NEW.id::text, 'invoice:' || NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING 'linked invoice alert skipped: %', SQLERRM; RETURN NEW;
END $$;

-- A message from the provider's staff in a project conversation (at most one alert per project per hour).
CREATE OR REPLACE FUNCTION public._trg_linked_alert_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deal public.client_deals%ROWTYPE; v_subject text;
BEGIN
  IF NEW.sender_client_id IS NOT NULL OR NEW.sender_contractor_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT t.subject INTO v_subject FROM public.message_threads t WHERE t.id = NEW.thread_id;
  IF v_subject IS NULL OR v_subject NOT LIKE 'Deal:%' THEN RETURN NEW; END IF;
  SELECT * INTO v_deal FROM public.client_deals d WHERE d.id = substr(v_subject, 6)::uuid AND d.company_id = NEW.company_id;
  IF v_deal.id IS NULL OR v_deal.visibility = 'private' THEN RETURN NEW; END IF;
  PERFORM public._linked_notify_customer(v_deal.client_id, 'message', 'Message from {provider}',
    '{provider} replied about ' || coalesce(v_deal.title, 'your project') || ': ' || left(NEW.body, 140),
    'project', v_deal.id::text, 'message:' || v_deal.id || ':' || to_char(now(), 'YYYYMMDDHH24'));
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING 'linked message alert skipped: %', SQLERRM; RETURN NEW;
END $$;

-- Jobs: a new job from the provider, a team assigned, a job completed (visible jobs only).
CREATE OR REPLACE FUNCTION public._trg_linked_alert_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := NEW.client_id; v_label text := coalesce(NEW.job_code || ': ', '') || NEW.title;
BEGIN
  IF v_client IS NULL AND NEW.deal_id IS NOT NULL THEN
    SELECT d.client_id INTO v_client FROM public.client_deals d WHERE d.id = NEW.deal_id;
  END IF;
  IF v_client IS NULL OR NOT EXISTS (SELECT 1 FROM public.company_links l WHERE l.provider_client_id = v_client AND l.status = 'active') THEN
    RETURN NEW;
  END IF;
  IF public._cpc_get_job(v_client, NEW.id) IS NULL THEN RETURN NEW; END IF;   -- private to the provider
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by_link_id IS NULL THEN
      PERFORM public._linked_notify_customer(v_client, 'job_created', 'New job from {provider}',
        '{provider} created job ' || v_label || '.', 'job', NEW.id::text, 'job_created:' || NEW.id);
    END IF;
  ELSE
    IF (OLD.assignee_employee_id IS NULL AND cardinality(OLD.assigned_employee_ids) = 0)
       AND (NEW.assignee_employee_id IS NOT NULL OR cardinality(NEW.assigned_employee_ids) > 0) THEN
      PERFORM public._linked_notify_customer(v_client, 'job_assigned', '{provider} assigned a team',
        '{provider} assigned a team to job ' || v_label || '.', 'job', NEW.id::text, 'job_assigned:' || NEW.id);
    END IF;
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      PERFORM public._linked_notify_customer(v_client, 'job_completed', 'Job completed by {provider}',
        '{provider} completed job ' || v_label || '.', 'job', NEW.id::text, 'job_completed:' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING 'linked job alert skipped: %', SQLERRM; RETURN NEW;
END $$;

CREATE TRIGGER linked_alert_deal AFTER UPDATE OF quotation_sent_at ON public.client_deals
  FOR EACH ROW EXECUTE FUNCTION public._trg_linked_alert_deal();
CREATE TRIGGER linked_alert_invoice AFTER INSERT OR UPDATE OF status ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_linked_alert_invoice();
CREATE TRIGGER linked_alert_message AFTER INSERT ON public.app_messages
  FOR EACH ROW EXECUTE FUNCTION public._trg_linked_alert_message();
CREATE TRIGGER linked_alert_job AFTER INSERT OR UPDATE OF assignee_employee_id, assigned_employee_ids, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public._trg_linked_alert_job();

-- Permissions (run separately): helpers and trigger functions — no direct calls; linked_* — signed-in only.
