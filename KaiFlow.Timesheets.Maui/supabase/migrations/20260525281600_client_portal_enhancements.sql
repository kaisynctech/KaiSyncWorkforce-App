-- Milestones, payment receipts, client messages, portal notifications, extended RPCs

ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS site_start_date date,
  ADD COLUMN IF NOT EXISTS expected_completion_date date,
  ADD COLUMN IF NOT EXISTS next_visit_date date;

ALTER TABLE public.project_client_payments
  ADD COLUMN IF NOT EXISTS receipt_url text;

CREATE TABLE IF NOT EXISTS public.client_deal_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  deal_id     uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  author      text NOT NULL CHECK (author IN ('client', 'hr')),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_deal_messages_deal
  ON public.client_deal_messages (deal_id, created_at DESC);

ALTER TABLE public.client_deal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_deal_messages_authenticated" ON public.client_deal_messages
  FOR ALL TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.employees WHERE user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.client_notification_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  deal_id       uuid REFERENCES public.client_deals(id) ON DELETE SET NULL,
  channel       text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient     text NOT NULL,
  subject       text,
  body          text NOT NULL,
  event_type    text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts      int NOT NULL DEFAULT 0,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  last_attempt_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_client_notification_deliveries_pending
  ON public.client_notification_deliveries (status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.client_notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_notification_deliveries_service" ON public.client_notification_deliveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.enqueue_client_portal_notification(
  p_deal_id    uuid,
  p_event_type text,
  p_subject    text,
  p_body       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal   public.client_deals%ROWTYPE;
  v_email  text;
  v_phone  text;
BEGIN
  SELECT d.* INTO v_deal FROM public.client_deals d WHERE d.id = p_deal_id;
  IF NOT FOUND OR v_deal.client_id IS NULL THEN
    RETURN;
  END IF;

  SELECT trim(cl.email), trim(cl.phone)
    INTO v_email, v_phone
  FROM public.clients cl
  WHERE cl.id = v_deal.client_id;

  IF coalesce(v_email, '') <> '' THEN
    INSERT INTO public.client_notification_deliveries (
      company_id, deal_id, channel, recipient, subject, body, event_type
    ) VALUES (
      v_deal.company_id, p_deal_id, 'email', v_email, p_subject, p_body, p_event_type
    );
  END IF;

  IF coalesce(v_phone, '') <> '' THEN
    INSERT INTO public.client_notification_deliveries (
      company_id, deal_id, channel, recipient, subject, body, event_type
    ) VALUES (
      v_deal.company_id, p_deal_id, 'sms', v_phone, NULL, p_body, p_event_type
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_client_deal_update_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.enqueue_client_portal_notification(
    NEW.deal_id,
    'project_update',
    'Project update: ' || (SELECT title FROM public.client_deals WHERE id = NEW.deal_id),
    coalesce(NEW.body, 'Your contractor posted a project update.')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_deal_updates_notify ON public.client_deal_updates;
CREATE TRIGGER client_deal_updates_notify
  AFTER INSERT ON public.client_deal_updates
  FOR EACH ROW EXECUTE FUNCTION public.trg_client_deal_update_notify();

CREATE OR REPLACE FUNCTION public.trg_client_payment_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title text;
BEGIN
  SELECT title INTO v_title FROM public.client_deals WHERE id = NEW.deal_id;
  PERFORM public.enqueue_client_portal_notification(
    NEW.deal_id,
    'payment_recorded',
    'Payment recorded: ' || coalesce(v_title, 'Project'),
    'A payment of R' || trim(to_char(NEW.amount, 'FM999999990.00')) ||
      ' was recorded on your project.' ||
      CASE WHEN coalesce(NEW.reference, '') <> '' THEN ' Ref: ' || NEW.reference ELSE '' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_client_payments_notify ON public.project_client_payments;
CREATE TRIGGER project_client_payments_notify
  AFTER INSERT ON public.project_client_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_client_payment_notify();

CREATE OR REPLACE FUNCTION public.trg_project_document_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title text;
BEGIN
  IF NEW.document_type = 'client_upload' THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.client_deals WHERE id = NEW.deal_id;
  PERFORM public.enqueue_client_portal_notification(
    NEW.deal_id,
    'document_added',
    'New document: ' || coalesce(v_title, 'Project'),
    'A new document was shared: ' || coalesce(NEW.document_name, 'Document') || '.'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_documents_notify ON public.project_documents;
CREATE TRIGGER project_documents_notify
  AFTER INSERT ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_project_document_notify();

CREATE OR REPLACE FUNCTION public.trg_client_deal_progress_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.progress_percent IS NOT DISTINCT FROM NEW.progress_percent THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_client_portal_notification(
    NEW.id,
    'progress_changed',
    'Progress update: ' || NEW.title,
    'Project progress is now ' || NEW.progress_percent::text || '%.'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_deals_progress_notify ON public.client_deals;
CREATE TRIGGER client_deals_progress_notify
  AFTER UPDATE OF progress_percent ON public.client_deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_client_deal_progress_notify();

CREATE OR REPLACE FUNCTION public.trg_hr_message_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title text;
BEGIN
  IF NEW.author <> 'hr' THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.client_deals WHERE id = NEW.deal_id;
  PERFORM public.enqueue_client_portal_notification(
    NEW.deal_id,
    'message_reply',
    'Reply on your project: ' || coalesce(v_title, 'Project'),
    coalesce(NEW.body, 'Your contractor sent you a message.')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_deal_messages_notify ON public.client_deal_messages;
CREATE TRIGGER client_deal_messages_notify
  AFTER INSERT ON public.client_deal_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_hr_message_notify();

CREATE OR REPLACE FUNCTION public.client_portal_send_message(
  p_company_code text,
  p_client_code  text,
  p_deal_id      uuid,
  p_body         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_id   uuid;
BEGIN
  IF trim(coalesce(p_body, '')) = '' THEN
    RAISE EXCEPTION 'MESSAGE_REQUIRED';
  END IF;

  SELECT d.* INTO v_deal
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE';
  END IF;

  INSERT INTO public.client_deal_messages (company_id, deal_id, author, body)
  VALUES (v_deal.company_id, v_deal.id, 'client', trim(p_body))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_send_message(text, text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_register_document(
  p_company_code   text,
  p_client_code    text,
  p_deal_id        uuid,
  p_document_name  text,
  p_file_url       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_id   uuid;
BEGIN
  IF trim(coalesce(p_document_name, '')) = '' OR trim(coalesce(p_file_url, '')) = '' THEN
    RAISE EXCEPTION 'DOCUMENT_REQUIRED';
  END IF;

  SELECT d.* INTO v_deal
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE';
  END IF;

  INSERT INTO public.project_documents (company_id, deal_id, document_name, document_type, file_url)
  VALUES (v_deal.company_id, v_deal.id, trim(p_document_name), 'client_upload', trim(p_file_url))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_register_document(text, text, uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_get_project(
  p_company_code text,
  p_client_code  text,
  p_deal_id      uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(t)
  FROM (
    SELECT
      d.id, d.company_id, d.client_id, d.project_code, d.title, d.status,
      d.offer_amount, d.amount_paid, d.deposit_required, d.progress_percent,
      d.agreement_notes, d.last_update_note, d.last_update_at,
      d.expected_close_date, d.site_start_date, d.expected_completion_date, d.next_visit_date,
      d.job_id, d.created_at, d.updated_at,
      d.quotation_notes, d.quotation_valid_until, d.quotation_sent_at,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'line_no', ql.line_no,
            'description', ql.description,
            'quantity', ql.quantity,
            'unit_price', ql.unit_price,
            'line_total', ql.quantity * ql.unit_price
          ) ORDER BY ql.line_no
        ), '[]'::json)
        FROM public.project_quotation_lines ql
        WHERE ql.deal_id = d.id
      ) AS quotation_lines,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'id', pd.id,
            'document_name', pd.document_name,
            'document_type', pd.document_type,
            'file_url', pd.file_url,
            'created_at', pd.created_at
          ) ORDER BY pd.created_at DESC
        ), '[]'::json)
        FROM public.project_documents pd
        WHERE pd.deal_id = d.id
      ) AS documents,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'body', u.body,
            'status_from', u.status_from,
            'status_to', u.status_to,
            'created_at', u.created_at
          ) ORDER BY u.created_at DESC
        ), '[]'::json)
        FROM public.client_deal_updates u
        WHERE u.deal_id = d.id
      ) AS activity_updates,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'id', m.id,
            'author', m.author,
            'body', m.body,
            'created_at', m.created_at
          ) ORDER BY m.created_at ASC
        ), '[]'::json)
        FROM public.client_deal_messages m
        WHERE m.deal_id = d.id
      ) AS messages,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'id', pay.id,
            'amount', pay.amount,
            'paid_at', pay.paid_at,
            'payment_method', pay.payment_method,
            'reference', pay.reference,
            'notes', pay.notes,
            'receipt_url', pay.receipt_url
          ) ORDER BY pay.paid_at DESC
        ), '[]'::json)
        FROM public.project_client_payments pay
        WHERE pay.deal_id = d.id
      ) AS payments,
      (
        SELECT COALESCE(json_agg(photo_row), '[]'::json)
        FROM (
          SELECT json_build_object(
            'job_title', j.title,
            'phase', 'before',
            'url', url
          ) AS photo_row,
          j.title AS sort_title,
          1 AS sort_phase
          FROM public.jobs j
          CROSS JOIN LATERAL unnest(coalesce(j.photo_urls_before, '{}'::text[])) AS url
          WHERE j.deal_id = d.id
            AND coalesce(j.visibility, 'inherit') IN ('all', 'inherit')
            AND trim(url) <> ''
          UNION ALL
          SELECT json_build_object(
            'job_title', j.title,
            'phase', 'after',
            'url', url
          ),
          j.title,
          2
          FROM public.jobs j
          CROSS JOIN LATERAL unnest(coalesce(j.photo_urls_after, '{}'::text[])) AS url
          WHERE j.deal_id = d.id
            AND coalesce(j.visibility, 'inherit') IN ('all', 'inherit')
            AND trim(url) <> ''
          ORDER BY sort_title, sort_phase
        ) photos
      ) AS progress_photos
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND d.id = p_deal_id
      AND d.visibility <> 'private'
    LIMIT 1
  ) t;
$$;
