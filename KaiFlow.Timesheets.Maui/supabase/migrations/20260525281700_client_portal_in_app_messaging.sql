-- Client portal messages use in-app message_threads (not SMS). Notify HR via app_notifications.

ALTER TABLE public.app_messages
  ADD COLUMN IF NOT EXISTS sender_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public._deal_message_subject(p_deal_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Deal:' || p_deal_id::text;
$$;

CREATE OR REPLACE FUNCTION public._hr_participant_ids_for_deal(p_company_id uuid, p_manager_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(array_agg(DISTINCT e.id), '{}'::uuid[])
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.is_active = true
    AND (
      e.id = p_manager_id
      OR e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
    );
$$;

CREATE OR REPLACE FUNCTION public._get_or_create_deal_thread(
  p_company_id uuid,
  p_deal_id uuid,
  p_manager_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject text := public._deal_message_subject(p_deal_id);
  v_thread_id uuid;
  v_parts uuid[];
BEGIN
  SELECT t.id INTO v_thread_id
  FROM public.message_threads t
  WHERE t.company_id = p_company_id AND t.subject = v_subject
  LIMIT 1;

  v_parts := public._hr_participant_ids_for_deal(p_company_id, p_manager_id);

  IF v_thread_id IS NULL THEN
    INSERT INTO public.message_threads (
      id, company_id, subject, participant_ids, type_raw, created_at
    ) VALUES (
      gen_random_uuid(),
      p_company_id,
      v_subject,
      v_parts,
      'client_deal',
      now()
    )
    RETURNING id INTO v_thread_id;
  ELSE
    UPDATE public.message_threads
    SET participant_ids = (
      SELECT array_agg(DISTINCT x)
      FROM unnest(message_threads.participant_ids || v_parts) AS x
    )
    WHERE id = v_thread_id;
  END IF;

  RETURN v_thread_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_hr_client_portal_message(
  p_company_id uuid,
  p_deal_id uuid,
  p_thread_id uuid,
  p_client_name text,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  r record;
BEGIN
  SELECT title INTO v_title FROM public.client_deals WHERE id = p_deal_id;

  FOR r IN
    SELECT DISTINCT hr.user_id AS auth_user_id, hr.id AS employee_id
    FROM public.employees hr
    WHERE hr.company_id = p_company_id
      AND hr.is_active = true
      AND hr.user_id IS NOT NULL
      AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  LOOP
    INSERT INTO public.app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data
    ) VALUES (
      p_company_id,
      'hr',
      r.auth_user_id,
      r.employee_id,
      'client_portal_message',
      'Client message: ' || coalesce(v_title, 'Project'),
      coalesce(p_client_name, 'Client') || ': ' || left(trim(p_body), 200),
      'message_thread',
      p_thread_id::text,
      'client_portal_message:' || p_thread_id::text || ':' || r.employee_id::text || ':' || md5(left(trim(p_body), 80)),
      jsonb_build_object(
        'deal_id', p_deal_id,
        'thread_id', p_thread_id,
        'client_name', p_client_name
      )
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_app_message_client_notify_hr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_client_name text;
BEGIN
  IF NEW.sender_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_deal_id := replace(
      (SELECT subject FROM public.message_threads WHERE id = NEW.thread_id),
      'Deal:', ''
    )::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  SELECT name INTO v_client_name FROM public.clients WHERE id = NEW.sender_client_id;

  PERFORM public.notify_hr_client_portal_message(
    NEW.company_id, v_deal_id, NEW.thread_id, v_client_name, NEW.body
  );

  UPDATE public.message_threads
  SET last_message_at = NEW.created_at,
      last_message_preview = left(trim(NEW.body), 120)
  WHERE id = NEW.thread_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_message_client_notify_hr ON public.app_messages;
CREATE TRIGGER app_message_client_notify_hr
  AFTER INSERT ON public.app_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_app_message_client_notify_hr();

CREATE OR REPLACE FUNCTION public.trg_app_message_update_thread_preview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.message_threads
  SET last_message_at = NEW.created_at,
      last_message_preview = left(trim(NEW.body), 120)
  WHERE id = NEW.thread_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_message_update_thread_preview ON public.app_messages;
CREATE TRIGGER app_message_update_thread_preview
  AFTER INSERT ON public.app_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_app_message_update_thread_preview();

-- Stop SMS/email for legacy client_deal_messages replies
DROP TRIGGER IF EXISTS client_deal_messages_notify ON public.client_deal_messages;

-- Return type changed from uuid to json — drop old signature first
DROP FUNCTION IF EXISTS public.client_portal_send_message(text, text, uuid, text);

-- Client portal: send message on project thread (in-app, not SMS)
CREATE OR REPLACE FUNCTION public.client_portal_send_message(
  p_company_code text,
  p_client_code  text,
  p_deal_id      uuid,
  p_body         text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_cl   public.clients%ROWTYPE;
  v_thread_id uuid;
  v_msg public.app_messages%ROWTYPE;
  v_manager uuid;
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

  SELECT * INTO v_cl FROM public.clients WHERE id = v_deal.client_id;

  v_manager := v_deal.manager_employee_id;
  v_thread_id := public._get_or_create_deal_thread(v_deal.company_id, v_deal.id, v_manager);

  INSERT INTO public.app_messages (
    id, thread_id, sender_id, body, company_id, created_at,
    sender_client_id, sender_display_name
  ) VALUES (
    gen_random_uuid(),
    v_thread_id,
    coalesce(v_manager, v_cl.id),
    trim(p_body),
    v_deal.company_id,
    now(),
    v_cl.id,
    coalesce(nullif(trim(v_cl.name), ''), 'Client')
  )
  RETURNING * INTO v_msg;

  RETURN row_to_json(v_msg);
END;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_get_deal_messages(
  p_company_code text,
  p_client_code  text,
  p_deal_id      uuid
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_subject text;
  v_thread_id uuid;
BEGIN
  SELECT d.company_id INTO v_company_id
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RETURN '[]'::json;
  END IF;

  v_subject := public._deal_message_subject(p_deal_id);
  SELECT t.id INTO v_thread_id
  FROM public.message_threads t
  WHERE t.company_id = v_company_id AND t.subject = v_subject
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    SELECT coalesce(json_agg(row_to_json(m) ORDER BY m.created_at), '[]'::json)
    FROM public.app_messages m
    WHERE m.thread_id = v_thread_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_get_deal_messages(text, text, uuid) TO anon, authenticated;

-- Project payload: messages from in-app thread
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
      public.client_portal_get_deal_messages(p_company_code, p_client_code, p_deal_id) AS messages,
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
