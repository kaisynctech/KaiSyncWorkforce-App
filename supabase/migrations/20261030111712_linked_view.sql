-- Linked companies, stage 2 part A (approved 30 Oct 2026): the customer company sees the
-- provider's work for it inside its own app.
--
-- The client-portal rules (which jobs, projects, invoices, documents and compliance a client
-- may see) move into one shared core per function, keyed by the client record:
--   _cpc_<name>(p_client uuid, …)   caller-rights; only reached through the wrappers below
--   client_portal_<name>(codes, …)  unchanged signature and results; portal must be switched on
--   linked_<name>(company, link, …) office staff of the customer company, active link only
-- The portal and the link therefore always show the same thing.

-- ── Access through a link ───────────────────────────────────────────────────
-- The provider's client record behind an active link, for office staff of the customer company.
CREATE OR REPLACE FUNCTION public._linked_client(p_company_id uuid, p_link_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  PERFORM public._company_link_office(p_company_id);
  SELECT l.provider_client_id INTO v_client FROM public.company_links l
  WHERE l.id = p_link_id AND l.customer_company_id = p_company_id AND l.status = 'active';
  IF v_client IS NULL THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  RETURN v_client;
END $$;

-- ── Jobs ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_list_jobs(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC), '[]'::json)
  FROM (
    SELECT j.id, j.job_code, j.title, j.status, j.scheduled_start, j.scheduled_end, j.created_at,
           d.id AS deal_id, d.project_code, d.title AS project_title
    FROM public.clients cl
    JOIN public.jobs j ON j.company_id = cl.company_id
    LEFT JOIN public.client_deals d
      ON d.id = j.deal_id AND d.company_id = j.company_id AND d.client_id = cl.id AND d.visibility <> 'private'
    WHERE cl.id = p_client
      AND (j.client_id = cl.id OR d.id IS NOT NULL)
      AND j.visibility IS DISTINCT FROM 'private'
      AND NOT (j.visibility = 'inherit' AND d.id IS NULL AND EXISTS (
        SELECT 1 FROM public.client_deals hidden
        WHERE hidden.id = j.deal_id AND hidden.company_id = j.company_id
          AND hidden.client_id = cl.id AND hidden.visibility = 'private'))
  ) t;
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_job(p_client uuid, p_job_id uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT row_to_json(t)
  FROM (
    SELECT
      j.id, j.job_code, j.title, j.description, j.status, j.priority, j.address,
      s.name AS site_name, s.address AS site_address,
      j.scheduled_start, j.scheduled_end, j.opened_at, j.closed_at, j.updated_at,
      d.id AS deal_id, d.project_code, d.title AS project_title,
      COALESCE((SELECT json_agg(url) FROM unnest(COALESCE(j.photo_urls_before, '{}'::text[])) AS url WHERE trim(url) <> ''), '[]'::json) AS photos_before,
      COALESCE((SELECT json_agg(url) FROM unnest(COALESCE(j.photo_urls_after, '{}'::text[])) AS url WHERE trim(url) <> ''), '[]'::json) AS photos_after,
      COALESCE((SELECT json_agg(url) FROM unnest(COALESCE(j.photo_urls, '{}'::text[])) AS url WHERE trim(url) <> ''), '[]'::json) AS photos,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', e.id,
            'name', trim(both FROM concat_ws(' ', nullif(trim(e.name), ''), nullif(trim(e.surname), ''))),
            'on_site', (open_visit.sign_in_at IS NOT NULL OR open_punch.date_time IS NOT NULL),
            'since', CASE
              WHEN open_visit.sign_in_at IS NULL THEN open_punch.date_time
              WHEN open_punch.date_time IS NULL THEN open_visit.sign_in_at
              ELSE least(open_visit.sign_in_at, open_punch.date_time)
            END)
          ORDER BY (open_visit.sign_in_at IS NOT NULL OR open_punch.date_time IS NOT NULL) DESC, e.name, e.surname)
        FROM public.employees e
        LEFT JOIN LATERAL (
          SELECT v.sign_in_at FROM public.job_site_visits v
          WHERE v.company_id = j.company_id AND v.job_id = j.id AND v.employee_id = e.id
            AND v.party_type = 'employee' AND v.sign_out_at IS NULL
          ORDER BY v.sign_in_at DESC LIMIT 1
        ) open_visit ON true
        LEFT JOIN LATERAL (
          SELECT p.date_time FROM public.time_punches p
          WHERE p.company_id = j.company_id AND p.employee_id = e.id AND p.type = 'in' AND p.job_id = j.id
            AND p.date_time = (SELECT max(latest.date_time) FROM public.time_punches latest
                               WHERE latest.company_id = j.company_id AND latest.employee_id = e.id)
          LIMIT 1
        ) open_punch ON true
        WHERE e.company_id = j.company_id
          AND e.id = ANY (COALESCE(j.assigned_employee_ids, '{}'::uuid[])
                          || CASE WHEN j.assignee_employee_id IS NOT NULL THEN ARRAY[j.assignee_employee_id] ELSE '{}'::uuid[] END)
      ), '[]'::json) AS team,
      COALESCE((
        SELECT json_agg(json_build_object('description', ci.description, 'is_checked', ci.is_checked, 'sort_order', ci.sort_order)
                        ORDER BY ci.sort_order, ci.description)
        FROM public.job_checklist_items ci WHERE ci.job_id = j.id AND ci.company_id = j.company_id
      ), '[]'::json) AS checklist,
      COALESCE((
        SELECT json_agg(json_build_object('sign_in_at', v.sign_in_at, 'sign_out_at', v.sign_out_at,
                                          'sign_in_address', v.sign_in_address, 'sign_out_address', v.sign_out_address,
                                          'notes', v.notes) ORDER BY v.sign_in_at DESC)
        FROM public.job_site_visits v WHERE v.job_id = j.id AND v.company_id = j.company_id
      ), '[]'::json) AS visits,
      COALESCE((
        SELECT json_agg(json_build_object('id', doc.id, 'document_name', doc.document_name, 'document_type', doc.document_type,
                                          'file_url', doc.file_url, 'created_at', doc.created_at) ORDER BY doc.created_at DESC)
        FROM public.job_documents doc WHERE doc.job_id = j.id AND doc.company_id = j.company_id
      ), '[]'::json) AS documents
    FROM public.clients cl
    JOIN public.jobs j ON j.company_id = cl.company_id
    LEFT JOIN public.sites s ON s.id = j.site_id AND s.company_id = j.company_id
    LEFT JOIN public.client_deals d
      ON d.id = j.deal_id AND d.company_id = j.company_id AND d.client_id = cl.id AND d.visibility <> 'private'
    WHERE cl.id = p_client AND j.id = p_job_id
      AND (j.client_id = cl.id OR d.id IS NOT NULL)
      AND j.visibility IS DISTINCT FROM 'private'
      AND NOT (j.visibility = 'inherit' AND d.id IS NULL AND EXISTS (
        SELECT 1 FROM public.client_deals hidden
        WHERE hidden.id = j.deal_id AND hidden.company_id = j.company_id
          AND hidden.client_id = cl.id AND hidden.visibility = 'private'))
  ) t;
$$;

CREATE OR REPLACE FUNCTION public._cpc_list_job_reports(p_client uuid, p_job_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF public._cpc_get_job(p_client, p_job_id) IS NULL THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id,
      'author', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
      'report_date', r.report_date, 'start_time', r.start_time, 'end_time', r.end_time,
      'work_performed', r.work_performed, 'materials_used', r.materials_used,
      'marks_job_complete', r.marks_job_complete
    ) ORDER BY r.report_date DESC, r.created_at DESC)
    FROM public.job_reports r
    LEFT JOIN public.employees e ON e.id = r.employee_id
    WHERE r.job_id = p_job_id AND r.visible_to_client
  ), '[]'::json);
END $$;

-- ── Projects, quotes and project messages ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_list_projects(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
  FROM (
    SELECT d.id, d.company_id, d.client_id, d.project_code, d.title, d.status,
      d.offer_amount, d.amount_paid, d.progress_percent, d.agreement_notes,
      d.last_update_note, d.last_update_at, d.expected_close_date, d.job_id,
      d.created_at, d.updated_at,
      (SELECT count(*)::int FROM public.jobs j WHERE j.deal_id = d.id AND j.visibility IS DISTINCT FROM 'private') AS job_count
    FROM public.clients cl
    JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
    WHERE cl.id = p_client AND d.visibility <> 'private'
  ) t;
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_deal_messages(p_client uuid, p_deal_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_company_id uuid; v_thread_id uuid;
BEGIN
  SELECT d.company_id INTO v_company_id
  FROM public.clients cl JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
  WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RETURN '[]'::json; END IF;
  SELECT t.id INTO v_thread_id FROM public.message_threads t
  WHERE t.company_id = v_company_id AND t.subject = public._deal_message_subject(p_deal_id) LIMIT 1;
  IF v_thread_id IS NULL THEN RETURN '[]'::json; END IF;
  RETURN (
    SELECT coalesce(json_agg(json_build_object('id', m.id, 'body', m.body, 'created_at', m.created_at,
                                               'sender_client_id', m.sender_client_id) ORDER BY m.created_at), '[]'::json)
    FROM public.app_messages m WHERE m.thread_id = v_thread_id
  );
END $$;

CREATE OR REPLACE FUNCTION public._cpc_get_project(p_client uuid, p_deal_id uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT row_to_json(t)
  FROM (
    SELECT
      d.id, d.company_id, d.client_id, d.project_code, d.title, d.status,
      d.offer_amount, d.amount_paid, d.deposit_required, d.progress_percent,
      d.agreement_notes, d.last_update_note, d.last_update_at,
      d.expected_close_date, d.site_start_date, d.expected_completion_date, d.next_visit_date,
      d.job_id, d.created_at, d.updated_at,
      COALESCE(mq.scope_notes, d.quotation_notes) AS quotation_notes,
      COALESCE(mq.valid_until, d.quotation_valid_until) AS quotation_valid_until,
      COALESCE(mq.sent_at, d.quotation_sent_at) AS quotation_sent_at,
      (CASE
        WHEN mq.id IS NOT NULL THEN (
          SELECT COALESCE(json_agg(json_build_object(
            'line_no', cql.sort_order + 1, 'description', cql.description, 'quantity', cql.quantity,
            'unit_price', cql.unit_sell_price, 'line_total', cql.quantity * cql.unit_sell_price
          ) ORDER BY cql.sort_order), '[]'::json)
          FROM public.commercial_quote_lines cql
          WHERE cql.quote_id = mq.id AND COALESCE(cql.is_excluded, false) = false)
        ELSE (
          SELECT COALESCE(json_agg(json_build_object(
            'line_no', ql.line_no, 'description', ql.description, 'quantity', ql.quantity,
            'unit_price', ql.unit_price, 'line_total', ql.quantity * ql.unit_price
          ) ORDER BY ql.line_no), '[]'::json)
          FROM public.project_quotation_lines ql WHERE ql.deal_id = d.id)
      END) AS quotation_lines,
      (SELECT COALESCE(json_agg(json_build_object('id', pd.id, 'document_name', pd.document_name,
                'document_type', pd.document_type, 'file_url', pd.file_url, 'created_at', pd.created_at)
              ORDER BY pd.created_at DESC), '[]'::json)
       FROM public.project_documents pd WHERE pd.deal_id = d.id) AS documents,
      (SELECT COALESCE(json_agg(json_build_object('body', u.body, 'status_from', u.status_from,
                'status_to', u.status_to, 'created_at', u.created_at) ORDER BY u.created_at DESC), '[]'::json)
       FROM public.client_deal_updates u WHERE u.deal_id = d.id) AS activity_updates,
      public._cpc_get_deal_messages(p_client, p_deal_id) AS messages,
      (SELECT COALESCE(json_agg(json_build_object('id', pay.id, 'amount', pay.amount, 'paid_at', pay.paid_at,
                'payment_method', pay.payment_method, 'reference', pay.reference, 'notes', pay.notes,
                'receipt_url', pay.receipt_url) ORDER BY pay.paid_at DESC), '[]'::json)
       FROM public.project_client_payments pay WHERE pay.deal_id = d.id) AS payments,
      (SELECT COALESCE(json_agg(photo_row), '[]'::json)
       FROM (
         SELECT json_build_object('job_title', j.title, 'phase', 'before', 'url', url) AS photo_row,
                j.title AS sort_title, 1 AS sort_phase
         FROM public.jobs j CROSS JOIN LATERAL unnest(coalesce(j.photo_urls_before, '{}'::text[])) AS url
         WHERE j.deal_id = d.id AND coalesce(j.visibility, 'inherit') IN ('all', 'inherit') AND trim(url) <> ''
         UNION ALL
         SELECT json_build_object('job_title', j.title, 'phase', 'after', 'url', url), j.title, 2
         FROM public.jobs j CROSS JOIN LATERAL unnest(coalesce(j.photo_urls_after, '{}'::text[])) AS url
         WHERE j.deal_id = d.id AND coalesce(j.visibility, 'inherit') IN ('all', 'inherit') AND trim(url) <> ''
         ORDER BY sort_title, sort_phase
       ) photos) AS progress_photos
    FROM public.clients cl
    JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
    LEFT JOIN LATERAL (
      SELECT q.id, q.scope_notes, q.valid_until, q.sent_at, q.total_amount
      FROM public.commercial_quotes q
      WHERE q.deal_id = d.id AND q.company_id = d.company_id AND q.status IN ('sent', 'viewed', 'accepted')
      ORDER BY CASE q.status WHEN 'accepted' THEN 1 WHEN 'viewed' THEN 2 WHEN 'sent' THEN 3 ELSE 4 END,
               q.updated_at DESC NULLS LAST
      LIMIT 1
    ) mq ON true
    WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private'
  ) t;
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_quotation_response(p_client uuid, p_deal_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_row public.client_deals%ROWTYPE;
BEGIN
  SELECT d.* INTO v_row
  FROM public.clients cl JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
  WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  RETURN json_build_object('quotation_response', v_row.quotation_response, 'quotation_response_note', v_row.quotation_response_note,
                           'quotation_response_at', v_row.quotation_response_at,
                           'quotation_response_storage_path', v_row.quotation_response_storage_path);
END $$;

CREATE OR REPLACE FUNCTION public._cpc_list_message_inbox(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.last_message_at DESC NULLS LAST), '[]'::json)
  FROM (
    SELECT d.id AS deal_id, d.title AS project_title, d.project_code, t.last_message_at, t.last_message_preview,
      (SELECT m.sender_client_id IS NULL FROM public.app_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_from_hr
    FROM public.clients cl
    JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
    JOIN public.message_threads t ON t.company_id = d.company_id AND t.subject = public._deal_message_subject(d.id)
    WHERE cl.id = p_client AND d.visibility <> 'private' AND t.last_message_at IS NOT NULL
  ) x;
$$;

-- ── Invoices, statement, letterhead, details ───────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_list_invoices(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.issue_date DESC), '[]'::json)
  FROM (
    SELECT i.id, i.company_id, i.client_id, i.invoice_number, i.status, i.currency,
      i.subtotal, i.vat_rate, i.vat_amount, i.total_amount, i.amount_paid, i.balance_due,
      i.issue_date, i.due_date, i.paid_date, i.notes
    FROM public.clients cl
    JOIN public.finance_invoices i ON i.client_id = cl.id AND i.company_id = cl.company_id
    WHERE cl.id = p_client AND i.status NOT IN ('draft', 'cancelled')
  ) t;
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_invoice(p_client uuid, p_invoice_id uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT json_build_object(
    'id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'issue_date', i.issue_date, 'due_date', i.due_date, 'notes', i.notes,
    'subtotal', i.subtotal, 'vat_amount', i.vat_amount, 'total_amount', i.total_amount,
    'amount_paid', i.amount_paid, 'balance_due', i.balance_due,
    'client_name', c2.name, 'client_email', c2.email, 'company_name', co.name,
    'lines', coalesce((
      SELECT json_agg(json_build_object('description', l.description, 'qty', l.quantity, 'unit_price', l.unit_price,
                                        'vat_amount', l.vat_amount, 'total', l.total_amount) ORDER BY l.line_no)
      FROM public.finance_invoice_lines l WHERE l.invoice_id = i.id AND l.company_id = i.company_id
    ), '[]'::json)
  )
  FROM public.clients c2
  JOIN public.finance_invoices i ON i.client_id = c2.id AND i.company_id = c2.company_id AND i.id = p_invoice_id
  JOIN public.companies co ON co.id = c2.company_id
  WHERE c2.id = p_client AND i.status NOT IN ('draft', 'cancelled');
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_statement(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  WITH cl AS (
    SELECT c.id AS client_id, c.company_id FROM public.clients c WHERE c.id = p_client
  ),
  inv AS (
    SELECT i.* FROM public.finance_invoices i JOIN cl ON i.client_id = cl.client_id AND i.company_id = cl.company_id
    WHERE i.status NOT IN ('draft', 'cancelled', 'voided') AND i.voided_at IS NULL
  ),
  pay AS (
    SELECT t.source_id AS invoice_id, t.transaction_date, t.created_at, t.amount, t.reference_number, t.payment_method
    FROM public.finance_transactions t JOIN inv ON inv.id = t.source_id AND inv.company_id = t.company_id
    WHERE t.source_table = 'finance_invoices' AND t.direction = 'incoming'
  ),
  entries AS (
    SELECT coalesce(inv.issue_date, inv.created_at::date) AS entry_date, inv.created_at AS sort_at, 1 AS ord,
           'invoice' AS kind, inv.id AS invoice_id, inv.invoice_number AS reference,
           'Invoice ' || coalesce(inv.invoice_number, '') AS description,
           inv.total_amount AS debit, 0::numeric AS credit, inv.due_date, inv.status
    FROM inv
    UNION ALL
    SELECT coalesce(pay.transaction_date, pay.created_at::date), pay.created_at, 2,
           'payment', pay.invoice_id, coalesce(pay.reference_number, inv.invoice_number),
           'Payment received' || coalesce(' (' || nullif(pay.payment_method, '') || ')', ''),
           0, pay.amount, NULL, NULL
    FROM pay JOIN inv ON inv.id = pay.invoice_id
    UNION ALL
    SELECT coalesce(inv.paid_date, inv.issue_date, inv.created_at::date), inv.created_at, 3,
           'payment', inv.id, inv.invoice_number, 'Payment received',
           0, inv.amount_paid - coalesce((SELECT sum(p.amount) FROM pay p WHERE p.invoice_id = inv.id), 0), NULL, NULL
    FROM inv
    WHERE inv.amount_paid - coalesce((SELECT sum(p.amount) FROM pay p WHERE p.invoice_id = inv.id), 0) > 0.009
    UNION ALL
    SELECT coalesce(cn.issue_date, cn.created_at::date), cn.created_at, 4,
           'credit_note', cn.invoice_id, cn.credit_note_number,
           'Credit note' || coalesce(' — ' || nullif(cn.reason_notes, ''), ''),
           0, cn.total_amount, NULL, cn.status
    FROM public.credit_notes cn JOIN cl ON cn.client_id = cl.client_id AND cn.company_id = cl.company_id
    WHERE coalesce(cn.status, '') NOT IN ('draft', 'void', 'voided', 'cancelled') AND cn.voided_at IS NULL
    UNION ALL
    SELECT coalesce(cn.issue_date, cn.created_at::date), cn.created_at, 5,
           'refund', cn.invoice_id, cn.credit_note_number, 'Refund paid to you',
           cn.refund_amount, 0, NULL, cn.status
    FROM public.credit_notes cn JOIN cl ON cn.client_id = cl.client_id AND cn.company_id = cl.company_id
    WHERE coalesce(cn.status, '') NOT IN ('draft', 'void', 'voided', 'cancelled') AND cn.voided_at IS NULL
      AND coalesce(cn.refund_amount, 0) > 0
  )
  SELECT coalesce(json_agg(row_to_json(e) ORDER BY e.entry_date, e.sort_at, e.ord), '[]'::json)
  FROM entries e;
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_letterhead(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public._company_letterhead_json(c.company_id, true) FROM public.clients c WHERE c.id = p_client LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_profile(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT json_build_object(
    'id', cl.id, 'company_id', cl.company_id, 'client_code', cl.client_code,
    'name', cl.name, 'legal_name', cl.legal_name, 'company_number', cl.company_number,
    'vat_number', cl.vat_number, 'contact_person', cl.contact_person,
    'email', cl.email, 'phone', cl.phone, 'mobile', cl.mobile, 'direct_line', cl.direct_line,
    'fax', cl.fax, 'website', cl.website, 'address', cl.address, 'billing_address', cl.billing_address,
    'account_number', cl.account_number, 'payment_terms_days', cl.payment_terms_days,
    'credit_limit', cl.credit_limit, 'tax_exempt', cl.tax_exempt,
    'contacts', coalesce((
      SELECT json_agg(json_build_object('id', cc.id, 'name', cc.name, 'email', cc.email,
                                        'include_in_emails', cc.include_in_emails) ORDER BY cc.sort_order, cc.created_at)
      FROM public.client_contacts cc WHERE cc.client_id = cl.id AND cc.company_id = cl.company_id
    ), '[]'::json)
  )
  FROM public.clients cl WHERE cl.id = p_client;
$$;

-- ── Compliance and requested documents ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_get_compliance(p_client uuid)
RETURNS json LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_client uuid; v_company uuid; v_pc public.party_compliance%ROWTYPE;
BEGIN
  SELECT c.id, c.company_id INTO v_client, v_company FROM public.clients c WHERE c.id = p_client;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  v_pc := public.evaluate_party_compliance(v_company, 'client', v_client);
  RETURN json_build_object(
    'summary', json_build_object('status', v_pc.status, 'score', v_pc.score, 'required_count', v_pc.required_count,
      'complete_count', v_pc.complete_count, 'missing_count', v_pc.missing_count, 'pending_count', v_pc.pending_count,
      'expiring_count', v_pc.expiring_count, 'expired_count', v_pc.expired_count, 'rejected_count', v_pc.rejected_count,
      'has_pack', v_pc.pack_id IS NOT NULL),
    'upload_prefix', public._compliance_path_prefix(v_company, 'client', v_client),
    'items', coalesce((SELECT json_agg(json_build_object(
        'document_type_code', i.document_type_code, 'direction', i.direction, 'requirement', i.requirement,
        'validity_days', i.validity_days, 'expiry_required', i.expiry_required, 'notes', i.notes,
        'label', coalesce((SELECT t.label FROM public.compliance_document_types t WHERE t.code = i.document_type_code
                           AND (t.company_id = v_company OR t.company_id IS NULL) ORDER BY t.company_id NULLS LAST LIMIT 1), i.document_type_code))
        ORDER BY i.sort_order)
      FROM public.compliance_pack_items i WHERE i.pack_id = v_pc.pack_id AND NOT i.is_archived), '[]'::json),
    'documents', coalesce((SELECT json_agg(row_to_json(d) ORDER BY d.created_at DESC) FROM (
        SELECT cd.id, cd.document_type_code, cd.direction, cd.document_name, cd.storage_path, cd.issue_date, cd.expiry_date,
               cd.status, cd.is_current, cd.rejected_reason, cd.uploaded_by_kind, cd.created_at, cd.reviewed_at
        FROM public.compliance_documents cd
        WHERE cd.company_id = v_company AND cd.party_kind = 'client' AND cd.party_id = v_client
          AND (cd.direction = 'from_party' OR (cd.direction = 'to_party' AND cd.status = 'approved' AND cd.is_current))
        ORDER BY cd.created_at DESC LIMIT 200) d), '[]'::json)
  );
END $$;

CREATE OR REPLACE FUNCTION public._cpc_get_compliance_documents(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(json_agg(row_to_json(d) ORDER BY d.created_at DESC), '[]'::json) FROM (
    SELECT cd.id, cd.company_id, cd.client_id, cd.document_type, cd.document_name, cd.file_url, cd.storage_path,
           cd.approval_status, cd.rejected_reason, cd.is_required, cd.is_current, cd.uploaded_by_role,
           cd.expiry_date, cd.direction, cd.created_at, cd.updated_at
    FROM public.clients x
    JOIN public.contractor_documents cd ON cd.client_id = x.id AND cd.company_id = x.company_id
    WHERE x.id = p_client AND cd.is_current AND (cd.direction = 'from_party' OR cd.approval_status = 'approved')) d;
$$;

CREATE OR REPLACE FUNCTION public._cpc_get_compliance_pack(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(json_agg(json_build_object('document_type', i.document_type, 'requirement', i.requirement,
           'sort_order', i.sort_order, 'direction', i.direction)
         ORDER BY CASE WHEN i.requirement = 'required' THEN 0 ELSE 1 END, i.sort_order), '[]'::json)
  FROM public.clients c
  JOIN public.contractor_compliance_packs p ON p.id = c.compliance_pack_id AND NOT coalesce(p.is_archived, false)
  JOIN public.contractor_compliance_pack_items i ON i.pack_id = p.id AND NOT i.is_archived
  WHERE c.id = p_client;
$$;

CREATE OR REPLACE FUNCTION public._cpc_list_document_requests(p_client uuid)
RETURNS json LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_client uuid; v_company uuid;
BEGIN
  SELECT c.id, c.company_id INTO v_client, v_company FROM public.clients c WHERE c.id = p_client;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  RETURN COALESCE((
    SELECT json_agg(row_to_json(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT id, document_name, document_type, request_note, status, review_note, storage_path, submitted_at, created_at
      FROM public.client_document_requests
      WHERE client_id = v_client AND company_id = v_company
    ) x
  ), '[]'::json);
END $$;

-- ── Files: short-lived read grants for files the client may see ────────────
CREATE OR REPLACE FUNCTION public._cpc_grant_media_read(p_client uuid, p_paths text[], p_grantee text)
RETURNS text[] LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_client uuid; v_company uuid; v_path text; v_p text[]; v_ok boolean; v_out text[] := '{}';
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  SELECT c.id, c.company_id INTO v_client, v_company FROM public.clients c WHERE c.id = p_client;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF coalesce(array_length(p_paths, 1), 0) > 200 THEN RAISE EXCEPTION 'too_many_paths'; END IF;
  FOREACH v_path IN ARRAY coalesce(p_paths, '{}'::text[]) LOOP
    v_path := trim(both '/' from trim(coalesce(v_path, '')));
    CONTINUE WHEN v_path = '' OR v_path LIKE '%..%';
    v_p := string_to_array(v_path, '/');
    v_ok := false;
    IF v_p[2] = v_company::text THEN
      IF v_p[1] = 'company_logos' THEN
        v_ok := true;
      ELSIF v_p[1] = 'client_documents' THEN
        v_ok := v_p[3] = v_client::text;
      ELSIF v_p[1] = 'project_documents' AND v_p[3] ~* v_uuid THEN
        v_ok := EXISTS (SELECT 1 FROM public.client_deals d
                        WHERE d.id = v_p[3]::uuid AND d.company_id = v_company
                          AND d.client_id = v_client AND d.visibility <> 'private');
      ELSIF v_p[1] IN ('job_photos', 'job_documents') AND v_p[3] ~* v_uuid THEN
        v_ok := public._cpc_get_job(v_client, v_p[3]::uuid) IS NOT NULL;
      END IF;
    END IF;
    IF v_ok THEN
      PERFORM public._media_write_read_grant(v_path, v_company, p_grantee);
      v_out := v_out || v_path;
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- ── Portal wrappers (same names, arguments and results as before) ──────────
CREATE OR REPLACE FUNCTION public.client_portal_list_jobs(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_list_jobs(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_job(p_company_code text, p_client_code text, p_job_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_job(x.client_id, p_job_id) FROM public._client_portal_client(p_company_code, p_client_code) x;
$$;
CREATE OR REPLACE FUNCTION public.client_portal_list_job_reports(p_company_code text, p_client_code text, p_job_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_list_job_reports(x.client_id, p_job_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_list_projects(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_list_projects(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_deal_messages(p_company_code text, p_client_code text, p_deal_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_get_deal_messages(x.client_id, p_deal_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_project(p_company_code text, p_client_code text, p_deal_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_project(x.client_id, p_deal_id) FROM public._client_portal_client(p_company_code, p_client_code) x;
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_quotation_response(p_company_code text, p_client_code text, p_deal_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  SELECT x.client_id INTO v_client FROM public._client_portal_client(p_company_code, p_client_code) x;
  IF v_client IS NULL THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  RETURN public._cpc_get_quotation_response(v_client, p_deal_id);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_list_message_inbox(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_list_message_inbox(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_list_invoices(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_list_invoices(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_invoice(p_company_code text, p_client_code text, p_invoice_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_invoice(x.client_id, p_invoice_id) FROM public._client_portal_client(p_company_code, p_client_code) x;
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_statement(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_get_statement(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_letterhead(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_letterhead(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_profile(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_profile(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x;
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_compliance(p_company_code text, p_client_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  SELECT x.client_id INTO v_client FROM public._client_portal_client(p_company_code, p_client_code) x;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  RETURN public._cpc_get_compliance(v_client);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_get_compliance_documents(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_get_compliance_documents(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_compliance_pack(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT public._cpc_get_compliance_pack(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x), '[]'::json);
$$;
CREATE OR REPLACE FUNCTION public.client_portal_list_document_requests(p_company_code text, p_client_code text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  SELECT x.client_id INTO v_client FROM public._client_portal_client(p_company_code, p_client_code) x;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  RETURN public._cpc_list_document_requests(v_client);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_grant_media_read(p_company_code text, p_client_code text, p_paths text[])
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  SELECT x.client_id INTO v_client FROM public._client_portal_client(p_company_code, p_client_code) x;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  RETURN public._cpc_grant_media_read(v_client, p_paths, 'client:' || v_client::text);
END $$;

-- ── Linked wrappers: the customer company's office staff, active link only ─
CREATE OR REPLACE FUNCTION public.linked_list_jobs(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_list_jobs(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_job(p_company_id uuid, p_link_id uuid, p_job_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_job(public._linked_client(p_company_id, p_link_id), p_job_id);
$$;
CREATE OR REPLACE FUNCTION public.linked_list_job_reports(p_company_id uuid, p_link_id uuid, p_job_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_list_job_reports(public._linked_client(p_company_id, p_link_id), p_job_id);
$$;
CREATE OR REPLACE FUNCTION public.linked_list_projects(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_list_projects(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_project(p_company_id uuid, p_link_id uuid, p_deal_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_project(public._linked_client(p_company_id, p_link_id), p_deal_id);
$$;
CREATE OR REPLACE FUNCTION public.linked_get_quotation_response(p_company_id uuid, p_link_id uuid, p_deal_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_quotation_response(public._linked_client(p_company_id, p_link_id), p_deal_id);
$$;
CREATE OR REPLACE FUNCTION public.linked_list_message_inbox(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_list_message_inbox(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_list_invoices(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_list_invoices(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_invoice(p_company_id uuid, p_link_id uuid, p_invoice_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_invoice(public._linked_client(p_company_id, p_link_id), p_invoice_id);
$$;
CREATE OR REPLACE FUNCTION public.linked_get_statement(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_statement(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_letterhead(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_letterhead(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_profile(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_profile(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_compliance(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_compliance(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_compliance_documents(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_compliance_documents(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_get_compliance_pack(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_compliance_pack(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_list_document_requests(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_list_document_requests(public._linked_client(p_company_id, p_link_id));
$$;
CREATE OR REPLACE FUNCTION public.linked_grant_media_read(p_company_id uuid, p_link_id uuid, p_paths text[])
RETURNS text[] LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_grant_media_read(public._linked_client(p_company_id, p_link_id), p_paths, 'link:' || p_link_id::text);
$$;

-- The shared cores and _linked_client are only for the wrappers above (run separately: REVOKE
-- EXECUTE … FROM PUBLIC, anon, authenticated on every _cpc_* function and _linked_client).
