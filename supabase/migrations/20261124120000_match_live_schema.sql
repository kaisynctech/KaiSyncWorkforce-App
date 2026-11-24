-- 20261124120000_match_live_schema
-- Generated on 2026-11-24 from the live database (project vcivtjwreybaxgtdhtou).
-- Brings the repository to exactly what production runs. Every statement here already matches production,
-- so on production this migration is recorded as applied, not run. It covers:
--   1. 14 older tables that were created outside the migration files
--   2. 100 functions whose live code differs from (or is missing in) the migration files
--   3. 11 security policies created outside the migration files
--   4. old function versions that live no longer has

-- Some older functions still refer to tables that were removed long ago (hr_users, visibility_grants, ...).
-- The app does not call them; they are kept exactly as production has them. Body checks are switched off so a
-- fresh rebuild does not stop on them (pg_dump does the same).
SET check_function_bodies = false;

-- 1. Tables ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_release_config (
  config_key text DEFAULT 'global'::text NOT NULL,
  is_enabled boolean DEFAULT true NOT NULL,
  latest_version text DEFAULT '0.1.0'::text NOT NULL,
  minimum_supported_version text,
  force_update boolean DEFAULT false NOT NULL,
  update_url_android text,
  update_url_ios text,
  update_url_web text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT app_release_config_pkey PRIMARY KEY (config_key)
);
ALTER TABLE public.app_release_config ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.app_release_config TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.app_release_config TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.app_release_config TO service_role;

CREATE SEQUENCE IF NOT EXISTS public.client_portal_tokens_id_seq;
CREATE TABLE IF NOT EXISTS public.client_portal_tokens (
  id bigint DEFAULT nextval('client_portal_tokens_id_seq'::regclass) NOT NULL,
  company_id bigint NOT NULL,
  client_id bigint NOT NULL,
  token text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  last_opened_at timestamp with time zone,
  open_count integer DEFAULT 0 NOT NULL,
  created_by_hr_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT client_portal_tokens_token_key UNIQUE (token),
  CONSTRAINT client_portal_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT client_portal_tokens_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text, 'expired'::text])))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_portal_tokens_active_client ON public.client_portal_tokens USING btree (company_id, client_id) WHERE (status = 'active'::text);
CREATE INDEX IF NOT EXISTS idx_client_portal_tokens_lookup ON public.client_portal_tokens USING btree (token, status, expires_at);
ALTER TABLE public.client_portal_tokens ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.client_portal_tokens TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.client_portal_tokens TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.client_portal_tokens TO service_role;

CREATE SEQUENCE IF NOT EXISTS public.client_portal_events_id_seq;
CREATE TABLE IF NOT EXISTS public.client_portal_events (
  id bigint DEFAULT nextval('client_portal_events_id_seq'::regclass) NOT NULL,
  company_id bigint NOT NULL,
  client_id bigint NOT NULL,
  token_id bigint,
  event_type text NOT NULL,
  target_type text NOT NULL,
  target_id bigint,
  details jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT client_portal_events_pkey PRIMARY KEY (id),
  CONSTRAINT client_portal_events_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.client_portal_tokens(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_client_portal_events_company_client ON public.client_portal_events USING btree (company_id, client_id, created_at DESC);
ALTER TABLE public.client_portal_events ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.client_portal_events TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.client_portal_events TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.client_portal_events TO service_role;

CREATE TABLE IF NOT EXISTS public.company_portal_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL,
  host_company_id uuid NOT NULL,
  other_company_id uuid NOT NULL,
  client_id uuid,
  contractor_id uuid,
  status text DEFAULT 'pending'::text NOT NULL,
  requested_by_company_id uuid NOT NULL,
  decided_by uuid,
  decided_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT company_portal_links_pkey PRIMARY KEY (id),
  CONSTRAINT company_portal_links_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL,
  CONSTRAINT company_portal_links_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.contractors(id) ON DELETE SET NULL,
  CONSTRAINT company_portal_links_host_company_id_fkey FOREIGN KEY (host_company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT company_portal_links_other_company_id_fkey FOREIGN KEY (other_company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT company_portal_links_requested_by_company_id_fkey FOREIGN KEY (requested_by_company_id) REFERENCES public.companies(id),
  CONSTRAINT company_portal_links_distinct_chk CHECK ((host_company_id <> other_company_id)),
  CONSTRAINT company_portal_links_kind_chk CHECK ((kind = ANY (ARRAY['customer'::text, 'hired'::text]))),
  CONSTRAINT company_portal_links_record_chk CHECK ((((kind = 'customer'::text) AND (contractor_id IS NULL)) OR ((kind = 'hired'::text) AND (client_id IS NULL)))),
  CONSTRAINT company_portal_links_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'cancelled'::text])))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_portal_links_open ON public.company_portal_links USING btree (kind, host_company_id, other_company_id) WHERE (status = ANY (ARRAY['pending'::text, 'active'::text]));
CREATE INDEX IF NOT EXISTS idx_company_portal_links_other ON public.company_portal_links USING btree (other_company_id, status);
CREATE INDEX IF NOT EXISTS idx_company_portal_links_host ON public.company_portal_links USING btree (host_company_id, status);
ALTER TABLE public.company_portal_links ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.company_portal_links TO service_role;

CREATE TABLE IF NOT EXISTS public.form_approvals (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  company_id bigint NOT NULL,
  submission_id bigint NOT NULL,
  step_order integer DEFAULT 1 NOT NULL,
  required_role text DEFAULT 'manager'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  approver_user_id uuid,
  comments text,
  acted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT form_approvals_submission_id_step_order_key UNIQUE (submission_id, step_order),
  CONSTRAINT form_approvals_pkey PRIMARY KEY (id),
  CONSTRAINT form_approvals_approver_user_id_fkey FOREIGN KEY (approver_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT form_approvals_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.form_submissions(id) ON DELETE CASCADE,
  CONSTRAINT form_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);
CREATE INDEX IF NOT EXISTS idx_form_approvals_submission ON public.form_approvals USING btree (submission_id, step_order);
ALTER TABLE public.form_approvals ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.form_approvals TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.form_approvals TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.form_approvals TO service_role;

CREATE TABLE IF NOT EXISTS public.handover_packs (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  company_id bigint NOT NULL,
  job_id bigint NOT NULL,
  generated_pdf_url text,
  checklist_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  shared_with_email text,
  shared_at timestamp with time zone,
  download_token text,
  download_expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT handover_packs_job_id_key UNIQUE (job_id),
  CONSTRAINT handover_packs_pkey PRIMARY KEY (id)
);
ALTER TABLE public.handover_packs ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.handover_packs TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.handover_packs TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.handover_packs TO service_role;

CREATE TABLE IF NOT EXISTS public.integration_endpoints (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  company_id bigint NOT NULL,
  provider text NOT NULL,
  config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT integration_endpoints_pkey PRIMARY KEY (id)
);
ALTER TABLE public.integration_endpoints ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.integration_endpoints TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.integration_endpoints TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.integration_endpoints TO service_role;

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  company_id bigint NOT NULL,
  recipient_user_id uuid NOT NULL,
  channel text DEFAULT 'in_app'::text NOT NULL,
  source text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notification_queue_pkey PRIMARY KEY (id),
  CONSTRAINT notification_queue_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT notification_queue_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'email'::text, 'webhook'::text]))),
  CONSTRAINT notification_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);
CREATE INDEX IF NOT EXISTS idx_notification_queue_company_recipient ON public.notification_queue USING btree (company_id, recipient_user_id, status, created_at DESC);
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notification_queue TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notification_queue TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notification_queue TO service_role;

CREATE SEQUENCE IF NOT EXISTS public.operational_escalation_rules_id_seq;
CREATE TABLE IF NOT EXISTS public.operational_escalation_rules (
  id bigint DEFAULT nextval('operational_escalation_rules_id_seq'::regclass) NOT NULL,
  company_id bigint NOT NULL,
  rule_key text NOT NULL,
  is_enabled boolean DEFAULT true NOT NULL,
  threshold_hours numeric(10,2) DEFAULT 2 NOT NULL,
  severity text DEFAULT 'medium'::text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT operational_escalation_rules_key_uniq UNIQUE (company_id, rule_key),
  CONSTRAINT operational_escalation_rules_pkey PRIMARY KEY (id),
  CONSTRAINT operational_escalation_rules_severity_chk CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);
ALTER TABLE public.operational_escalation_rules ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.operational_escalation_rules TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.operational_escalation_rules TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.operational_escalation_rules TO service_role;

CREATE SEQUENCE IF NOT EXISTS public.operational_escalation_events_id_seq;
CREATE TABLE IF NOT EXISTS public.operational_escalation_events (
  id bigint DEFAULT nextval('operational_escalation_events_id_seq'::regclass) NOT NULL,
  company_id bigint NOT NULL,
  rule_id bigint,
  ref_type text NOT NULL,
  ref_id text NOT NULL,
  severity text DEFAULT 'medium'::text NOT NULL,
  title text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  CONSTRAINT operational_escalation_events_pkey PRIMARY KEY (id),
  CONSTRAINT operational_escalation_events_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.operational_escalation_rules(id) ON DELETE SET NULL,
  CONSTRAINT operational_escalation_events_severity_chk CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT operational_escalation_events_status_chk CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);
CREATE INDEX IF NOT EXISTS idx_operational_escalation_events_company_open ON public.operational_escalation_events USING btree (company_id, status, created_at DESC);
ALTER TABLE public.operational_escalation_events ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.operational_escalation_events TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.operational_escalation_events TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.operational_escalation_events TO service_role;

CREATE TABLE IF NOT EXISTS public.scheduled_exports (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  company_id bigint NOT NULL,
  export_type text NOT NULL,
  format text NOT NULL,
  cron_expr text NOT NULL,
  destination_email text,
  destination_webhook text,
  is_active boolean DEFAULT true NOT NULL,
  last_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT scheduled_exports_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_exports_format_check CHECK ((format = ANY (ARRAY['csv'::text, 'xlsx'::text, 'pdf'::text])))
);
ALTER TABLE public.scheduled_exports ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.scheduled_exports TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.scheduled_exports TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.scheduled_exports TO service_role;

CREATE TABLE IF NOT EXISTS public.shift_assignments (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  company_id bigint NOT NULL,
  shift_id bigint NOT NULL,
  employee_id bigint NOT NULL,
  status text DEFAULT 'offered'::text NOT NULL,
  score numeric(10,2),
  score_reason text,
  offered_at timestamp with time zone DEFAULT now() NOT NULL,
  responded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT shift_assignments_shift_id_employee_id_key UNIQUE (shift_id, employee_id),
  CONSTRAINT shift_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT shift_assignments_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE,
  CONSTRAINT shift_assignments_status_check CHECK ((status = ANY (ARRAY['offered'::text, 'accepted'::text, 'declined'::text, 'no_show'::text, 'completed'::text])))
);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_company_employee ON public.shift_assignments USING btree (company_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift_status ON public.shift_assignments USING btree (shift_id, status);
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shift_assignments TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shift_assignments TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shift_assignments TO service_role;

CREATE TABLE IF NOT EXISTS public.submission_recipients (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  company_id bigint NOT NULL,
  submission_type text NOT NULL,
  submission_id bigint NOT NULL,
  recipient_user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT submission_recipients_submission_type_submission_id_recipie_key UNIQUE (submission_type, submission_id, recipient_user_id),
  CONSTRAINT submission_recipients_pkey PRIMARY KEY (id),
  CONSTRAINT submission_recipients_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT submission_recipients_submission_type_check CHECK ((submission_type = ANY (ARRAY['incident'::text, 'job_request'::text])))
);
CREATE INDEX IF NOT EXISTS idx_submission_recipients_company_recipient ON public.submission_recipients USING btree (company_id, recipient_user_id, created_at DESC);
ALTER TABLE public.submission_recipients ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.submission_recipients TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.submission_recipients TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.submission_recipients TO service_role;

CREATE TABLE IF NOT EXISTS public.xero_oauth_states (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  state text NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL,
  CONSTRAINT xero_oauth_states_state_key UNIQUE (state),
  CONSTRAINT xero_oauth_states_pkey PRIMARY KEY (id),
  CONSTRAINT xero_oauth_states_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT xero_oauth_states_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE
);
ALTER TABLE public.xero_oauth_states ENABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.xero_oauth_states TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.xero_oauth_states TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.xero_oauth_states TO service_role;

-- 2. Functions (exact live definitions and EXECUTE rights) ----------------
CREATE OR REPLACE FUNCTION public._assert_worker_access(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'company_id and employee_id are required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id          = p_employee_id
        AND e.company_id  = p_company_id
        AND e.user_id     = auth.uid()
    ) THEN
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.employees hr
      WHERE hr.user_id     = auth.uid()
        AND hr.company_id  = p_company_id
        AND hr.access_level IN ('hr', 'owner', 'manager')
        AND hr.is_active   = true
    ) THEN
      RETURN;
    END IF;

    IF p_session_token IS NOT NULL
       AND length(trim(p_session_token)) > 0
       AND public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token) THEN
      UPDATE public.employee_code_sessions
      SET last_seen_at = now()
      WHERE session_token = p_session_token;
      RETURN;
    END IF;

    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'jwt_not_linked_to_employee';
  END IF;

  IF p_session_token IS NULL OR length(trim(p_session_token)) = 0 THEN
    PERFORM public.employee_validate_session(
      p_company_id, p_employee_id, coalesce(p_session_token, '')
    );
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'session_token_required';
  END IF;

  IF NOT public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token) THEN
    PERFORM public.employee_validate_session(p_company_id, p_employee_id, p_session_token);
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'invalid_or_expired_session';
  END IF;

  UPDATE public.employee_code_sessions
  SET last_seen_at = now()
  WHERE session_token = p_session_token;
END;
$function$;
REVOKE ALL ON FUNCTION public._assert_worker_access(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_worker_access(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._assert_worker_access(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public._assert_worker_access(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public._cpc_get_invoice(p_client uuid, p_invoice_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'issue_date', i.issue_date, 'due_date', i.due_date, 'notes', i.notes,
    'subtotal', i.subtotal, 'vat_amount', i.vat_amount, 'total_amount', i.total_amount,
    'amount_paid', i.amount_paid, 'balance_due', i.balance_due, 'currency', i.currency,
    'client_name', c2.name, 'client_legal_name', nullif(trim(c2.legal_name), ''), 'client_email', c2.email,
    'client_address', coalesce(nullif(trim(c2.billing_address), ''), nullif(trim(c2.address), '')),
    'client_vat_number', nullif(trim(c2.vat_number), ''),
    'company_name', co.name,
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
$function$;
REVOKE ALL ON FUNCTION public._cpc_get_invoice(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._cpc_get_invoice(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._cpc_get_project(p_client uuid, p_deal_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT row_to_json(t)
  FROM (
    SELECT
      d.id, d.company_id, d.client_id, d.project_code, d.title, d.status,
      d.offer_amount, d.amount_paid, d.deposit_required, d.progress_percent,
      d.agreement_notes, d.last_update_note, d.last_update_at,
      d.expected_close_date, d.site_start_date, d.expected_completion_date, d.next_visit_date,
      d.job_id, d.created_at, d.updated_at, mq.id AS quote_id, mq.quote_number, mq.currency AS quote_currency, mq.status AS quote_status, mq.subtotal AS quote_subtotal, mq.vat_amount AS quote_vat, mq.total_amount AS quote_total,
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
      SELECT q.id, q.scope_notes, q.valid_until, q.sent_at, q.total_amount, q.quote_number, q.currency, q.status, q.subtotal, q.vat_amount
      FROM public.commercial_quotes q
      WHERE q.deal_id = d.id AND q.company_id = d.company_id AND q.status IN ('sent', 'viewed', 'accepted')
      ORDER BY CASE q.status WHEN 'accepted' THEN 1 WHEN 'viewed' THEN 2 WHEN 'sent' THEN 3 ELSE 4 END,
               q.updated_at DESC NULLS LAST
      LIMIT 1
    ) mq ON true
    WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private'
  ) t;
$function$;
REVOKE ALL ON FUNCTION public._cpc_get_project(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._cpc_get_project(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._doc_max_used(p_company_id uuid, p_kind text, p_period text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v bigint; w bigint;
BEGIN
  IF p_kind = 'invoice' THEN
    SELECT max(coalesce(substring(invoice_number FROM '^INV-\d{4}-(\d+)$'), substring(invoice_number FROM '^INV(\d+)$'))::bigint) INTO v
      FROM public.finance_invoices WHERE company_id = p_company_id AND invoice_number ~ '^INV(-\d{4}-)?\d+$';
  ELSIF p_kind = 'quote' THEN
    SELECT max(coalesce(substring(quote_number FROM '^QT-\d{4}-(\d+)$'), substring(quote_number FROM '^QU(\d+)$'))::bigint) INTO v
      FROM public.commercial_quotes WHERE company_id = p_company_id AND quote_number ~ '^(QT-\d{4}-|QU)\d+$';
  ELSIF p_kind = 'credit_note' THEN
    SELECT max(substring(credit_note_number FROM '^CN-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.credit_notes WHERE company_id = p_company_id AND credit_note_number ~ '^CN-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'purchase_order' THEN
    SELECT max(substring(po_number FROM '^PO-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.purchase_orders WHERE company_id = p_company_id AND po_number ~ '^PO-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'rfq' THEN
    SELECT max(substring(rfq_number FROM '^RFQ-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.rfqs WHERE company_id = p_company_id AND rfq_number ~ '^RFQ-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'grn' THEN
    SELECT max(substring(grn_number FROM '^GRN-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.goods_received_notes WHERE company_id = p_company_id AND grn_number ~ '^GRN-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'contractor_quote' THEN
    SELECT max(coalesce(substring(quote_number FROM '^CQ(\d+)$'), substring(quote_number FROM '^QT-.*-(\d+)$'))::bigint) INTO v
      FROM public.contractor_quotes WHERE company_id = p_company_id AND quote_number ~ '^(CQ\d+|QT-.*-\d+)$';
  ELSIF p_kind = 'bill' THEN
    SELECT max(substring(bill_number FROM '^BILL(\d+)$')::bigint) INTO v
      FROM public.supplier_invoices WHERE company_id = p_company_id AND bill_number ~ '^BILL\d+$';
  ELSIF p_kind = 'receipt' THEN
    SELECT max(substring(receipt_number FROM '^REC(\d+)$')::bigint) INTO v
      FROM public.finance_transactions WHERE company_id = p_company_id AND receipt_number ~ '^REC\d+$';
  ELSIF p_kind = 'remittance' THEN
    SELECT max(substring(remittance_number FROM '^REM(\d+)$')::bigint) INTO v
      FROM public.supplier_invoices WHERE company_id = p_company_id AND remittance_number ~ '^REM\d+$';
    SELECT max(substring(remittance_number FROM '^REM(\d+)$')::bigint) INTO w
      FROM public.contractor_payouts WHERE company_id = p_company_id AND remittance_number ~ '^REM\d+$';
    v := greatest(coalesce(v, 0), coalesce(w, 0));
  ELSE
    SELECT max(coalesce(substring(job_code FROM '-J(\d+)$'), substring(job_code FROM '^J(\d{4,5})$'))::bigint) INTO v
      FROM public.jobs WHERE company_id = p_company_id AND (job_code ~ '-J\d+$' OR job_code ~ '^J\d{4,5}$');
  END IF;
  RETURN coalesce(v, 0);
END $function$;
REVOKE ALL ON FUNCTION public._doc_max_used(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._doc_max_used(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public._employee_session_is_valid(p_company_id uuid, p_employee_id uuid, p_session_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_code_sessions s
    WHERE s.session_token = p_session_token
      AND s.company_id   = p_company_id
      AND s.employee_id  = p_employee_id
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
  );
$function$;
REVOKE ALL ON FUNCTION public._employee_session_is_valid(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._employee_session_is_valid(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._employee_session_is_valid(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public._employee_session_is_valid(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public._employee_session_is_valid(uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public._ins_ageing(p_co uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH o AS (
    SELECT i.client_id, i.balance_due * coalesce(i.exchange_rate, 1) b, current_date - coalesce(i.due_date, i.issue_date) late
    FROM finance_invoices i
    WHERE i.company_id = p_co AND i.status IN ('sent', 'viewed', 'partially_paid', 'overdue') AND i.balance_due > 0.009
      AND coalesce(i.invoice_type, 'standard') NOT IN ('rent', 'stay'))
  SELECT jsonb_build_object(
    'outstanding', coalesce((SELECT sum(b) FROM o), 0),
    'overdue', coalesce((SELECT sum(b) FROM o WHERE late > 0), 0),
    'buckets', jsonb_build_array(
      jsonb_build_object('name', 'Not yet due', 'amount', coalesce((SELECT sum(b) FROM o WHERE late <= 0), 0)),
      jsonb_build_object('name', '1–30 days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late BETWEEN 1 AND 30), 0)),
      jsonb_build_object('name', '31–60 days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late BETWEEN 31 AND 60), 0)),
      jsonb_build_object('name', '61–90 days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late BETWEEN 61 AND 90), 0)),
      jsonb_build_object('name', '90+ days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late > 90), 0))),
    'debtors', coalesce((SELECT jsonb_agg(x ORDER BY x.total DESC) FROM (
      SELECT c.id client_id, coalesce(c.name, 'No client') AS name, round(sum(b), 2) total,
             round(coalesce(sum(b) FILTER (WHERE late <= 0), 0), 2) current,
             round(coalesce(sum(b) FILTER (WHERE late BETWEEN 1 AND 30), 0), 2) d30,
             round(coalesce(sum(b) FILTER (WHERE late BETWEEN 31 AND 60), 0), 2) d60,
             round(coalesce(sum(b) FILTER (WHERE late BETWEEN 61 AND 90), 0), 2) d90,
             round(coalesce(sum(b) FILTER (WHERE late > 90), 0), 2) d90plus,
             count(*) invoices, max(late) oldest_days
      FROM o LEFT JOIN clients c ON c.id = o.client_id GROUP BY 1, 2) x), '[]'::jsonb))
$function$;
REVOKE ALL ON FUNCTION public._ins_ageing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._ins_ageing(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._ins_money(p_co uuid, p_from date, p_to date, p_full boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; f timestamptz := _ins_day_start(p_from) - interval '5 hours'; t timestamptz := _ins_day_start(p_to + 1) - interval '5 hours';
BEGIN
  WITH inv AS (SELECT * FROM finance_invoices WHERE company_id = p_co AND issue_date BETWEEN p_from AND p_to
                 AND status NOT IN ('draft', 'cancelled', 'voided') AND coalesce(invoice_type, 'standard') NOT IN ('rent', 'stay')),
  q AS (SELECT * FROM commercial_quotes WHERE company_id = p_co)
  SELECT jsonb_build_object(
    'quotes_sent', (SELECT count(*) FROM q WHERE sent_at >= f AND sent_at < t),
    'quotes_sent_value', (SELECT coalesce(sum(total_amount * coalesce(exchange_rate, 1)), 0) FROM q WHERE sent_at >= f AND sent_at < t),
    'quotes_won', (SELECT count(*) FROM q WHERE accepted_at >= f AND accepted_at < t),
    'quotes_won_value', (SELECT coalesce(sum(total_amount * coalesce(exchange_rate, 1)), 0) FROM q WHERE accepted_at >= f AND accepted_at < t),
    'quotes_lost', (SELECT count(*) FROM q WHERE declined_at >= f AND declined_at < t),
    'win_rate', (SELECT CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE accepted_at IS NOT NULL)::numeric / count(*) * 100, 1) END
                   FROM q WHERE (accepted_at >= f AND accepted_at < t) OR (declined_at >= f AND declined_at < t)),
    'invoiced', (SELECT coalesce(sum(total_amount * coalesce(exchange_rate, 1)), 0) FROM inv),
    'invoices', (SELECT count(*) FROM inv),
    'collected', (SELECT coalesce(sum(amount * coalesce((SELECT fi.exchange_rate FROM finance_invoices fi WHERE fi.id = finance_transactions.source_id), 1)), 0) FROM finance_transactions WHERE company_id = p_co AND transaction_type = 'invoice'
                    AND direction = 'incoming' AND source_table = 'finance_invoices' AND transaction_date BETWEEN p_from AND p_to),
    'avg_days_to_pay', (SELECT round(avg(paid_date - issue_date)::numeric, 1) FROM finance_invoices WHERE company_id = p_co
                          AND status = 'paid' AND paid_date BETWEEN p_from AND p_to AND paid_date >= issue_date))
  INTO v;
  IF NOT p_full THEN RETURN jsonb_build_object('kpis', v); END IF;
  RETURN jsonb_build_object('kpis', v,
    'monthly', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'invoiced', i, 'collected', c, 'won', w) ORDER BY m) FROM (
        SELECT m, sum(i) i, sum(c) c, sum(w) w FROM (
          SELECT date_trunc('month', issue_date)::date m, total_amount * coalesce(exchange_rate, 1) i, 0 c, 0 w FROM finance_invoices
            WHERE company_id = p_co AND issue_date BETWEEN p_from AND p_to AND status NOT IN ('draft', 'cancelled', 'voided')
              AND coalesce(invoice_type, 'standard') NOT IN ('rent', 'stay')
          UNION ALL SELECT date_trunc('month', transaction_date)::date, 0, amount * coalesce((SELECT fi.exchange_rate FROM finance_invoices fi WHERE fi.id = finance_transactions.source_id), 1), 0 FROM finance_transactions
            WHERE company_id = p_co AND transaction_type = 'invoice' AND direction = 'incoming' AND source_table = 'finance_invoices'
              AND transaction_date BETWEEN p_from AND p_to
          UNION ALL SELECT date_trunc('month', accepted_at AT TIME ZONE 'Africa/Johannesburg')::date, 0, 0, total_amount * coalesce(exchange_rate, 1) FROM commercial_quotes
            WHERE company_id = p_co AND accepted_at >= f AND accepted_at < t) u GROUP BY m) x), '[]'::jsonb),
    'weekly', coalesce((SELECT jsonb_agg(jsonb_build_object('week', m, 'invoiced', i, 'collected', c, 'won', w) ORDER BY m) FROM (
        SELECT m, sum(i) i, sum(c) c, sum(w) w FROM (
          SELECT date_trunc('week', issue_date)::date m, total_amount * coalesce(exchange_rate, 1) i, 0 c, 0 w FROM finance_invoices
            WHERE company_id = p_co AND issue_date BETWEEN p_from AND p_to AND status NOT IN ('draft', 'cancelled', 'voided')
              AND coalesce(invoice_type, 'standard') NOT IN ('rent', 'stay')
          UNION ALL SELECT date_trunc('week', transaction_date)::date, 0, amount * coalesce((SELECT fi.exchange_rate FROM finance_invoices fi WHERE fi.id = finance_transactions.source_id), 1), 0 FROM finance_transactions
            WHERE company_id = p_co AND transaction_type = 'invoice' AND direction = 'incoming' AND source_table = 'finance_invoices'
              AND transaction_date BETWEEN p_from AND p_to
          UNION ALL SELECT date_trunc('week', accepted_at AT TIME ZONE 'Africa/Johannesburg')::date, 0, 0, total_amount * coalesce(exchange_rate, 1) FROM commercial_quotes
            WHERE company_id = p_co AND accepted_at >= f AND accepted_at < t) u GROUP BY m) x), '[]'::jsonb),
    'by_client', coalesce((SELECT jsonb_agg(x ORDER BY x.invoiced DESC) FROM (
        SELECT coalesce(c.name, 'No client') AS name, round(sum(i.total_amount * coalesce(i.exchange_rate, 1)), 2) invoiced, count(*) invoices,
               round(sum(i.amount_paid * coalesce(i.exchange_rate, 1)), 2) paid
        FROM finance_invoices i LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.company_id = p_co AND i.issue_date BETWEEN p_from AND p_to AND i.status NOT IN ('draft', 'cancelled', 'voided')
          AND coalesce(i.invoice_type, 'standard') NOT IN ('rent', 'stay')
        GROUP BY 1 ORDER BY 2 DESC LIMIT 15) x), '[]'::jsonb),
    'quote_status', coalesce((SELECT jsonb_agg(jsonb_build_object('name', status, 'count', n, 'value', qv) ORDER BY n DESC) FROM (
        SELECT status, count(*) n, round(sum(total_amount * coalesce(exchange_rate, 1)), 2) qv FROM commercial_quotes
        WHERE company_id = p_co AND created_at >= f AND created_at < t GROUP BY 1) x), '[]'::jsonb),
    'lost_reasons', coalesce((SELECT jsonb_agg(jsonb_build_object('name', r, 'count', n) ORDER BY n DESC) FROM (
        SELECT coalesce(nullif(trim(declined_reason), ''), 'No reason given') r, count(*) n FROM commercial_quotes
        WHERE company_id = p_co AND declined_at >= f AND declined_at < t GROUP BY 1) x), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public._ins_money(uuid,date,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._ins_money(uuid,date,date,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._ins_people(p_co uuid, p_from date, p_to date, p_branch text, p_dept text, p_full boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_head int;
BEGIN
  SELECT count(*) INTO v_head FROM employees e
   WHERE e.company_id = p_co AND e.is_active AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept);
  RETURN (
    WITH pd AS MATERIALIZED (SELECT * FROM _ins_person_days(p_co, p_from, p_to, p_branch, p_dept)),
    ld AS MATERIALIZED (SELECT * FROM _ins_leave_days(p_co, p_from, p_to, p_branch, p_dept)),
    workdays AS (SELECT d FROM pd WHERE extract(isodow FROM d) < 6 GROUP BY d HAVING count(*) >= greatest(1, ceil(v_head * 0.2))),
    k AS (
      SELECT count(*) FILTER (WHERE pd.d IN (SELECT d FROM workdays)) present_days,
             count(*) FILTER (WHERE pd.late) late_days, count(*) all_days,
             coalesce(sum(pd.hours), 0) hours, coalesce(sum(pd.overtime), 0) overtime,
             coalesce(sum(pd.minutes_late), 0) minutes_late
      FROM pd),
    lv AS (SELECT count(*) leave_days, count(*) FILTER (WHERE d IN (SELECT d FROM workdays)) leave_on_workdays FROM ld),
    ex AS (SELECT greatest((SELECT count(*) FROM workdays) * v_head - (SELECT leave_on_workdays FROM lv), 0) expected),
    kp AS (
      SELECT jsonb_build_object(
        'headcount', v_head,
        'work_days', (SELECT count(*) FROM workdays),
        'present_days', k.present_days,
        'expected_days', ex.expected,
        'attendance_rate', CASE WHEN ex.expected > 0 THEN round(least(k.present_days::numeric / ex.expected, 1) * 100, 1) END,
        'absent_days', greatest(ex.expected - k.present_days, 0),
        'late_days', k.late_days,
        'late_rate', CASE WHEN k.all_days > 0 THEN round(k.late_days::numeric / k.all_days * 100, 1) END,
        'avg_minutes_late', CASE WHEN k.late_days > 0 THEN round(k.minutes_late::numeric / k.late_days) END,
        'hours', round(k.hours, 1),
        'overtime_hours', round(k.overtime, 1),
        'leave_days', lv.leave_days) j
      FROM k, lv, ex)
    SELECT CASE WHEN NOT p_full THEN jsonb_build_object('kpis', (SELECT j FROM kp)) ELSE jsonb_build_object(
      'kpis', (SELECT j FROM kp),
      'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('d', d, 'present', present, 'late', late, 'hours', round(hours, 1),
                                                              'overtime', round(overtime, 1)) ORDER BY d)
        FROM (SELECT d, count(*) present, count(*) FILTER (WHERE late) late, sum(hours) hours, sum(overtime) overtime
              FROM pd GROUP BY d) x), '[]'::jsonb),
      'by_department', coalesce((SELECT jsonb_agg(x ORDER BY x.hours DESC) FROM (
         SELECT coalesce(nullif(btrim(e.department), ''), 'No department') AS name, count(DISTINCT e.id) headcount,
                count(pd.employee_id) present_days, count(pd.employee_id) FILTER (WHERE pd.late) late_days,
                round(coalesce(sum(pd.hours), 0), 1) hours, round(coalesce(sum(pd.overtime), 0), 1) overtime
         FROM employees e LEFT JOIN pd ON pd.employee_id = e.id
         WHERE e.company_id = p_co AND e.is_active AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept)
         GROUP BY 1) x), '[]'::jsonb),
      'by_branch', coalesce((SELECT jsonb_agg(x ORDER BY x.hours DESC) FROM (
         SELECT coalesce(nullif(btrim(e.branch), ''), 'No site') AS name, count(DISTINCT e.id) headcount,
                count(pd.employee_id) present_days, count(pd.employee_id) FILTER (WHERE pd.late) late_days,
                round(coalesce(sum(pd.hours), 0), 1) hours, round(coalesce(sum(pd.overtime), 0), 1) overtime
         FROM employees e LEFT JOIN pd ON pd.employee_id = e.id
         WHERE e.company_id = p_co AND e.is_active AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept)
         GROUP BY 1) x), '[]'::jsonb),
      'leave_by_type', coalesce((SELECT jsonb_agg(jsonb_build_object('type', leave_type, 'days', n) ORDER BY n DESC)
         FROM (SELECT leave_type, count(*) n FROM ld GROUP BY 1) x), '[]'::jsonb),
      'top_late', coalesce((SELECT jsonb_agg(x ORDER BY x.late_days DESC, x.minutes_late DESC) FROM (
         SELECT e.id employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name, e.department,
                count(*) late_days, sum(pd.minutes_late) minutes_late
         FROM pd JOIN employees e ON e.id = pd.employee_id WHERE pd.late
         GROUP BY 1, 2, 3 ORDER BY 4 DESC, 5 DESC LIMIT 10) x), '[]'::jsonb),
      'top_overtime', coalesce((SELECT jsonb_agg(x ORDER BY x.overtime DESC) FROM (
         SELECT e.id employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name, e.department,
                round(sum(pd.overtime), 1) overtime
         FROM pd JOIN employees e ON e.id = pd.employee_id
         GROUP BY 1, 2, 3 HAVING sum(pd.overtime) > 0 ORDER BY 4 DESC LIMIT 10) x), '[]'::jsonb)) END);
END $function$;
REVOKE ALL ON FUNCTION public._ins_people(uuid,date,date,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._ins_people(uuid,date,date,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._ins_person_days_v2(p_co uuid, p_from date, p_to date, p_branch text, p_dept text)
 RETURNS TABLE(employee_id uuid, d date, first_in timestamp with time zone, last_out timestamp with time zone, late boolean, minutes_late integer, hours numeric, overtime numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_lo timestamptz := _ins_day_start(p_from); v_hi timestamptz := _ins_day_start(p_to + 1);
BEGIN
  RETURN QUERY EXECUTE $q$
  WITH emp AS MATERIALIZED (
    SELECT e.id, coalesce(t.start_time, time '07:00') st, coalesce(t.end_time, time '16:00') et, coalesce(t.break_minutes, 0) brk
    FROM employees e LEFT JOIN employee_shift_templates t ON t.id = e.shift_template_id
    WHERE e.company_id = $1 AND e.is_active
      AND ($4::text IS NULL OR e.branch = $4) AND ($5::text IS NULL OR e.department = $5)
  ), pd AS MATERIALIZED (
    SELECT p.employee_id, ((p.date_time AT TIME ZONE 'Africa/Johannesburg') - interval '5 hours')::date d,
           min(p.date_time) FILTER (WHERE p.type = 'in') first_in, max(p.date_time) FILTER (WHERE p.type = 'out') last_out
    FROM time_punches p
    WHERE p.company_id = $1 AND p.date_time >= $2 AND p.date_time < $3
      AND p.employee_id IN (SELECT id FROM emp)
    GROUP BY 1, 2
  )
  SELECT pd.employee_id, pd.d, pd.first_in, pd.last_out,
         coalesce(m.after_start BETWEEN 6 AND 360, false),
         CASE WHEN m.after_start BETWEEN 6 AND 360 THEN m.after_start ELSE 0 END,
         h.hours,
         greatest(h.hours - (extract(epoch FROM (emp.et - emp.st + CASE WHEN emp.et < emp.st THEN interval '24 hours' ELSE interval '0' END)) / 3600
                             - emp.brk / 60.0), 0)::numeric
  FROM pd JOIN emp ON emp.id = pd.employee_id
  CROSS JOIN LATERAL (SELECT CASE WHEN pd.first_in IS NULL THEN NULL ELSE
           ((extract(epoch FROM ((pd.first_in AT TIME ZONE 'Africa/Johannesburg')::time - emp.st)) / 60)::int + 1440) % 1440 END after_start) m
  CROSS JOIN LATERAL (SELECT CASE WHEN pd.first_in IS NOT NULL AND pd.last_out > pd.first_in
                                       AND pd.last_out - pd.first_in < interval '20 hours'
                                  THEN round((extract(epoch FROM pd.last_out - pd.first_in) / 3600 - emp.brk / 60.0)::numeric, 2)
                                  ELSE 0 END hours) h
  $q$ USING p_co, v_lo, v_hi, p_branch, p_dept;
END $function$;
REVOKE ALL ON FUNCTION public._ins_person_days_v2(uuid,date,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._ins_person_days_v2(uuid,date,date,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public._quote_to_draft_invoice(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'From quote ' || coalesce(q.quote_number, '') || ' (accepted).')
  RETURNING id INTO v_id;
  INSERT INTO public.finance_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, subtotal,
    vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type, item_type, source_id, unit)
  SELECT q.company_id, v_id, row_number() OVER (ORDER BY l.sort_order, l.created_at),
    coalesce(nullif(trim(l.description), ''), q.title) || CASE WHEN coalesce(l.discount_percent, 0) > 0 THEN ' (' || trim_scale(l.discount_percent)::text || '% discount)' ELSE '' END, coalesce(l.quantity, 1), CASE WHEN coalesce(l.discount_percent, 0) > 0 AND coalesce(l.quantity, 0) > 0 THEN round(coalesce(l.subtotal_sell, 0) / l.quantity, 4) ELSE coalesce(l.unit_sell_price, 0) END,
    coalesce(l.subtotal_sell, 0), coalesce(l.vat_rate, v_rate), coalesce(l.vat_amount, 0), coalesce(l.line_total, 0), false,
    CASE WHEN v_rate > 0 THEN 'standard' ELSE 'exempt' END,
    CASE WHEN l.job_service_id IS NOT NULL THEN 'service' WHEN l.inventory_item_id IS NOT NULL THEN 'inventory'
         WHEN l.catalogue_item_id IS NOT NULL THEN 'catalogue' ELSE 'custom' END,
    coalesce(l.job_service_id, l.inventory_item_id, l.catalogue_item_id), l.unit
  FROM public.commercial_quote_lines l
  WHERE l.quote_id = q.id AND NOT coalesce(l.is_excluded, false);
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public._quote_to_draft_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._quote_to_draft_invoice(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._recurring_generate(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.recurring_invoices%ROWTYPE; v_id uuid; v_sub numeric := 0; v_vat numeric; v_terms int; l jsonb; n int := 0;
  v_qty numeric; v_price numeric; v_line numeric; v_tax text;
BEGIN
  SELECT * INTO r FROM public.recurring_invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT r.active THEN RAISE EXCEPTION 'RECURRING_NOT_ACTIVE'; END IF;
  IF jsonb_array_length(r.lines) = 0 THEN RAISE EXCEPTION 'NO_LINES'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
    v_sub := v_sub + round(coalesce((l->>'quantity')::numeric, 1) * coalesce((l->>'unit_price')::numeric, 0), 2);
  END LOOP;
  v_vat := round(v_sub * r.vat_rate, 2);
  v_tax := CASE WHEN r.vat_rate > 0 THEN 'standard' ELSE 'exempt' END;
  SELECT coalesce(r.payment_terms_days, c.payment_terms_days, 30) INTO v_terms FROM public.clients c WHERE c.id = r.client_id;
  INSERT INTO public.finance_invoices (company_id, client_id, invoice_number, status, currency, subtotal, vat_rate, vat_amount,
    total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type, issue_date, due_date, invoice_type, notes, sent_at)
  VALUES (r.company_id, r.client_id, NULL, 'draft', 'ZAR', v_sub, r.vat_rate, v_vat, v_sub + v_vat, 0, v_sub + v_vat, false,
    v_tax, current_date, current_date + coalesce(v_terms, 30), 'standard', r.notes, NULL)
  RETURNING id INTO v_id;
  FOR l IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
    n := n + 1;
    v_qty := coalesce((l->>'quantity')::numeric, 1);
    v_price := coalesce((l->>'unit_price')::numeric, 0);
    v_line := round(v_qty * v_price, 2);
    INSERT INTO public.finance_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, subtotal,
      vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type, item_type, source_id, unit)
    VALUES (r.company_id, v_id, n, coalesce(nullif(trim(l->>'description'), ''), r.title), v_qty, v_price, v_line,
      r.vat_rate, round(v_line * r.vat_rate, 2), v_line + round(v_line * r.vat_rate, 2), false, v_tax,
      coalesce(nullif(l->>'item_type', ''), 'custom'), nullif(l->>'source_id', '')::uuid, nullif(l->>'unit', ''));
  END LOOP;
  IF r.auto_send THEN
    UPDATE public.finance_invoices SET status = 'sent', sent_at = now() WHERE id = v_id;
  END IF;
  UPDATE public.recurring_invoices SET runs = runs + 1, last_run_at = now(), last_invoice_id = v_id, last_error = NULL,
    next_run = public._recurring_next(greatest(next_run, current_date), frequency), updated_at = now(),
    active = CASE WHEN end_date IS NOT NULL AND public._recurring_next(greatest(next_run, current_date), frequency) > end_date THEN false ELSE active END
  WHERE id = r.id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public._recurring_generate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._recurring_generate(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._sync_contractor_party(p_contractor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_pack uuid;
BEGIN
  SELECT id, company_id, compliance_pack_id INTO c FROM public.contractors WHERE id = p_contractor_id;
  IF c.id IS NULL THEN RETURN; END IF;
  IF c.compliance_pack_id IS NOT NULL THEN v_pack := public._sync_contractor_pack(c.compliance_pack_id); END IF;

  INSERT INTO public.party_compliance (company_id, party_kind, party_id, pack_id)
  VALUES (c.company_id, 'contractor', c.id, v_pack)
  ON CONFLICT (company_id, party_kind, party_id) DO UPDATE SET pack_id = EXCLUDED.pack_id, updated_at = now();

  INSERT INTO public.compliance_documents (company_id, party_kind, party_id, document_type_code, direction, document_name,
    storage_path, issue_date, expiry_date, status, is_current, reviewed_by, reviewed_at, rejected_reason,
    uploaded_by_kind, notes, legacy_source, legacy_id, created_at, updated_at)
  SELECT d.company_id, 'contractor', d.contractor_id,
         CASE WHEN EXISTS (SELECT 1 FROM public.compliance_document_types t WHERE t.code = d.document_type) THEN d.document_type ELSE 'other' END,
         'from_party', coalesce(nullif(trim(d.document_name), ''), d.document_type),
         coalesce(nullif(trim(d.storage_path), ''),
                  substring(d.file_url from '/object/(?:public|sign|authenticated)/workforce-media/([^?]+)'),
                  'legacy/' || d.id::text),
         d.issue_date, d.expiry_date,
         CASE WHEN d.approval_status IN ('pending', 'approved', 'rejected') THEN d.approval_status ELSE 'pending' END,
         coalesce(d.is_current, true), d.approved_by, d.approved_at, d.rejected_reason,
         CASE WHEN d.uploaded_by_role = 'contractor_portal' THEN 'contractor_portal' ELSE 'hr' END,
         d.notes, 'contractor_documents', d.id, d.created_at, now()
  FROM public.contractor_documents d
  WHERE d.contractor_id = c.id AND d.company_id = c.company_id
  ON CONFLICT (legacy_source, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
    document_type_code = EXCLUDED.document_type_code, document_name = EXCLUDED.document_name,
    storage_path = EXCLUDED.storage_path, issue_date = EXCLUDED.issue_date, expiry_date = EXCLUDED.expiry_date,
    status = EXCLUDED.status, is_current = EXCLUDED.is_current, reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at, rejected_reason = EXCLUDED.rejected_reason, notes = EXCLUDED.notes,
    updated_at = now();

  UPDATE public.compliance_documents cd SET is_current = false, status = 'superseded', updated_at = now()
  WHERE cd.party_kind = 'contractor' AND cd.party_id = c.id AND cd.legacy_source = 'contractor_documents'
    AND cd.status <> 'superseded'
    AND NOT EXISTS (SELECT 1 FROM public.contractor_documents d WHERE d.id = cd.legacy_id);

  PERFORM public.evaluate_party_compliance(c.company_id, 'contractor', c.id);
END;
$function$;
REVOKE ALL ON FUNCTION public._sync_contractor_party(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sync_contractor_party(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._trg_invoice_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_issued_now boolean := NEW.status NOT IN ('draft', 'cancelled', 'voided');
  v_issued_before boolean := TG_OP = 'UPDATE' AND OLD.status NOT IN ('draft', 'cancelled', 'voided');
  v_booked numeric;
  v_ref text := coalesce(NEW.invoice_number, NEW.id::text);
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(debit - credit), 0) INTO v_booked FROM public.customer_ledger_entries
   WHERE source_table = 'finance_invoices' AND source_id = NEW.id AND entry_type IN ('invoice', 'invoice_adjustment', 'invoice_cancelled');

  IF v_issued_now AND NOT EXISTS (SELECT 1 FROM public.customer_ledger_entries
       WHERE source_table = 'finance_invoices' AND source_id = NEW.id AND entry_type = 'invoice') THEN
    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
      description, debit, credit, entry_date, created_by)
    VALUES (NEW.company_id, NEW.client_id, 'invoice', 'finance_invoices', NEW.id, NEW.invoice_number,
      'Invoice ' || v_ref, coalesce(NEW.total_amount, 0), 0, coalesce(NEW.issue_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date), auth.uid());
  ELSIF v_issued_now AND v_issued_before AND round(coalesce(NEW.total_amount, 0) - v_booked, 2) <> 0 THEN
    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
      description, debit, credit, entry_date, created_by)
    VALUES (NEW.company_id, NEW.client_id, 'invoice_adjustment', 'finance_invoices', NEW.id, NEW.invoice_number,
      'Invoice ' || v_ref || ' total changed',
      greatest(coalesce(NEW.total_amount, 0) - v_booked, 0), greatest(v_booked - coalesce(NEW.total_amount, 0), 0),
      (now() AT TIME ZONE 'Africa/Johannesburg')::date, auth.uid());
  ELSIF NOT v_issued_now AND v_issued_before AND NEW.status IN ('cancelled', 'voided') AND v_booked > 0 THEN
    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
      description, debit, credit, entry_date, created_by)
    VALUES (NEW.company_id, NEW.client_id, 'invoice_cancelled', 'finance_invoices', NEW.id, NEW.invoice_number,
      'Invoice ' || v_ref || ' ' || NEW.status, 0, v_booked, (now() AT TIME ZONE 'Africa/Johannesburg')::date, auth.uid());
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public._trg_invoice_ledger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._trg_invoice_ledger() TO service_role;

CREATE OR REPLACE FUNCTION public._trg_linked_alert_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_client uuid := NEW.client_id; v_label text := coalesce(NEW.job_code || ': ', '') || NEW.title;
BEGIN
  IF v_client IS NULL AND NEW.deal_id IS NOT NULL THEN
    SELECT d.client_id INTO v_client FROM public.client_deals d WHERE d.id = NEW.deal_id;
  END IF;
  IF v_client IS NULL OR NOT EXISTS (SELECT 1 FROM public.company_links l WHERE l.provider_client_id = v_client AND l.status = 'active') THEN
    RETURN NEW;
  END IF;
  IF public._cpc_get_job(v_client, NEW.id) IS NULL THEN RETURN NEW; END IF;
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
END $function$;
REVOKE ALL ON FUNCTION public._trg_linked_alert_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._trg_linked_alert_job() TO service_role;

CREATE OR REPLACE FUNCTION public.backfill_punch_address(p_company_id uuid, p_punch_id uuid, p_address text, p_session_token text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp uuid;
  v_addr text := nullif(btrim(p_address), '');
BEGIN
  IF v_addr IS NULL THEN
    RAISE EXCEPTION 'Address is required' USING ERRCODE = 'P0001';
  END IF;

  IF v_addr ~ '^-?[0-9]{1,3}\.[0-9]+\s*,\s*-?[0-9]{1,3}\.[0-9]+$' THEN
    RAISE EXCEPTION 'Address must be a place name, not coordinates' USING ERRCODE = 'P0001';
  END IF;

  SELECT employee_id INTO v_emp
  FROM public.time_punches
  WHERE id = p_punch_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Punch not found' USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    PERFORM public._assert_worker_access(p_company_id, v_emp, p_session_token);
  EXCEPTION WHEN OTHERS THEN
    IF auth.uid() IS NULL OR get_my_role(p_company_id) NOT IN ('owner', 'hr', 'manager') THEN
      RAISE;
    END IF;
  END;

  UPDATE public.time_punches
  SET address = v_addr
  WHERE id = p_punch_id
    AND company_id = p_company_id
    AND (
      address IS NULL
      OR btrim(address) = ''
      OR address ~ '^-?[0-9]{1,3}\.[0-9]+\s*,\s*-?[0-9]{1,3}\.[0-9]+$'
    );

  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.backfill_punch_address(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_punch_address(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_punch_address(uuid,uuid,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.backfill_punch_address(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.billing_change_plan(p_company_id uuid, p_plan_code text, p_cycle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.saas_company_subscriptions%ROWTYPE; cur public.saas_plans%ROWTYPE; nw public.saas_plans%ROWTYPE;
  k record; per record; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_anchor date; v_days int; v_left int; v_months_left int; v_old numeric; v_new numeric; v_amount numeric; v_credit numeric;
  st public.billing_settings%ROWTYPE; v_bill uuid; v_mode text;
BEGIN
  IF NOT public.billing_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_cycle NOT IN ('monthly', 'annual') THEN RAISE EXCEPTION 'BAD_CYCLE'; END IF;
  SELECT * INTO nw FROM public.saas_plans WHERE code = p_plan_code AND is_public AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_AVAILABLE'; END IF;
  SELECT * INTO s FROM public.saas_company_subscriptions WHERE company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_SUBSCRIPTION'; END IF;
  SELECT * INTO k FROM public.kaiflow_company_billing_counts(p_company_id);
  IF nw.max_employees IS NOT NULL AND k.employee_count > nw.max_employees THEN
    RAISE EXCEPTION 'PLAN_EMPLOYEE_LIMIT:%', nw.max_employees
      USING HINT = format('You have %s active employees; %s allows up to %s.', k.employee_count, nw.name, nw.max_employees);
  END IF;

  IF s.subscription_status = 'trialing' THEN
    UPDATE public.saas_company_subscriptions SET chosen_plan_id = nw.id, billing_cycle = p_cycle, updated_at = now() WHERE id = s.id;
    RETURN jsonb_build_object('ok', true, 'when', 'trial_end', 'plan_code', nw.code, 'cycle', p_cycle);
  END IF;

  SELECT * INTO cur FROM public.saas_plans WHERE id = s.plan_id;
  IF cur.id = nw.id OR nw.monthly_price <= cur.monthly_price THEN
    UPDATE public.saas_company_subscriptions
       SET pending_plan_id = CASE WHEN cur.id = nw.id THEN NULL ELSE nw.id END,
           pending_cycle = CASE WHEN p_cycle = s.billing_cycle THEN NULL ELSE p_cycle END, updated_at = now()
     WHERE id = s.id;
    RETURN jsonb_build_object('ok', true, 'when', 'renewal', 'plan_code', nw.code, 'cycle', p_cycle,
      'from', CASE WHEN s.billing_cycle = 'annual' THEN s.annual_period_end + 1 ELSE s.next_billing_date END);
  END IF;

  SELECT * INTO st FROM public.billing_settings WHERE id;
  v_anchor := (s.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date;
  SELECT * INTO per FROM public.billing_period_for(v_anchor, v_today);
  IF s.billing_cycle = 'annual' AND s.annual_period_end IS NOT NULL THEN
    v_months_left := GREATEST(1, (extract(year FROM age(s.annual_period_end + 1, per.period_start)) * 12
                                 + extract(month FROM age(s.annual_period_end + 1, per.period_start)))::int);
    v_credit := round(coalesce(s.annual_paid_amount, 0) * v_months_left / 12.0, 2);
    v_new := (public.billing_price(nw, 'annual', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'subtotal')::numeric
           - (public.billing_price(nw, 'annual', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'discount')::numeric;
    v_amount := GREATEST(0, round(v_new * v_months_left / 12.0 - v_credit, 2));
    UPDATE public.saas_company_subscriptions SET plan_id = nw.id, pending_plan_id = NULL,
      annual_paid_amount = round(v_new, 2),
      annual_base_monthly = (public.billing_price(nw, 'monthly', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'monthly_subtotal')::numeric,
      updated_at = now() WHERE id = s.id;
  ELSE
    v_days := (per.period_end - per.period_start) + 1;
    v_left := (per.period_end - v_today) + 1;
    v_old := (public.billing_price(cur, 'monthly', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'monthly_subtotal')::numeric;
    v_new := (public.billing_price(nw, 'monthly', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'monthly_subtotal')::numeric;
    v_amount := GREATEST(0, round((v_new - v_old) * v_left / v_days, 2));
    UPDATE public.saas_company_subscriptions SET plan_id = nw.id, pending_plan_id = NULL,
      pending_cycle = CASE WHEN p_cycle = s.billing_cycle THEN NULL ELSE p_cycle END, updated_at = now() WHERE id = s.id;
  END IF;
  IF st.vat_enabled THEN v_amount := v_amount + round(v_amount * st.vat_rate, 2); END IF;

  IF v_amount > 0 THEN
    SELECT mode INTO v_mode FROM public.billing_bills WHERE company_id = p_company_id ORDER BY created_at DESC LIMIT 1;
    INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
    VALUES (p_company_id, v_today, coalesce(CASE WHEN s.billing_cycle = 'annual' THEN s.annual_period_end END, per.period_end), v_amount,
      jsonb_build_array(jsonb_build_object('description', format('Move from %s to %s for the rest of the %s', cur.name, nw.name,
        CASE WHEN s.billing_cycle = 'annual' THEN format('year (%s months)', v_months_left) ELSE format('month (%s of %s days)', v_left, v_days) END), 'amount', v_amount)),
      nw.name, v_today, coalesce(v_mode, 'sandbox'), 'upgrade',
      jsonb_build_object('from', cur.code, 'to', nw.code, 'credit', v_credit, 'months_left', v_months_left, 'days_left', v_left))
    RETURNING id INTO v_bill;
  END IF;
  PERFORM public.kaiflow_sync_company_subscription(p_company_id);
  RETURN jsonb_build_object('ok', true, 'when', 'now', 'plan_code', nw.code, 'cycle', p_cycle, 'amount', v_amount, 'bill_id', v_bill);
END $function$;
REVOKE ALL ON FUNCTION public.billing_change_plan(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_change_plan(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_change_plan(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.billing_create_due_bills(p_mode text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; s public.saas_company_subscriptions%ROWTYPE; p record; v_plan public.saas_plans%ROWTYPE; k record;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; v_n int := 0; v_sum jsonb; q jsonb;
  st public.billing_settings%ROWTYPE; v_extra numeric; v_amount numeric; v_override numeric; v_start date;
BEGIN
  SELECT * INTO st FROM public.billing_settings WHERE id;
  FOR r IN
    SELECT c.id, (sc.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date anchor
      FROM public.companies c JOIN public.saas_company_subscriptions sc ON sc.company_id = c.id
     WHERE c.billing_enabled AND NOT coalesce(c.is_platform_home, false) AND sc.trial_ends_at IS NOT NULL
       AND (sc.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date <= v_today
  LOOP
    SELECT * INTO p FROM public.billing_period_for(r.anchor, v_today);
    SELECT * INTO s FROM public.saas_company_subscriptions WHERE company_id = r.id FOR UPDATE;

    IF s.subscription_status = 'trialing' THEN
      v_plan := public.billing_effective_plan(r.id);
      UPDATE public.saas_company_subscriptions SET plan_id = v_plan.id, chosen_plan_id = NULL WHERE id = s.id;
    END IF;
    IF (s.pending_plan_id IS NOT NULL OR s.pending_cycle IS NOT NULL)
       AND (s.billing_cycle = 'monthly' OR s.annual_period_end IS NULL OR v_today > s.annual_period_end)
       AND NOT EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = p.period_start AND b.kind IN ('monthly', 'annual')) THEN
      UPDATE public.saas_company_subscriptions SET plan_id = coalesce(pending_plan_id, plan_id), billing_cycle = coalesce(pending_cycle, billing_cycle),
        pending_plan_id = NULL, pending_cycle = NULL,
        annual_period_start = CASE WHEN coalesce(pending_cycle, billing_cycle) = 'monthly' THEN NULL ELSE annual_period_start END,
        annual_period_end = CASE WHEN coalesce(pending_cycle, billing_cycle) = 'monthly' THEN NULL ELSE annual_period_end END
       WHERE id = s.id;
    END IF;
    SELECT * INTO s FROM public.saas_company_subscriptions WHERE company_id = r.id;

    v_sum := public.kaiflow_sync_company_subscription(r.id);
    CONTINUE WHEN coalesce((v_sum ->> 'billable')::boolean, true) = false;

    IF s.billing_cycle = 'monthly' THEN
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = p.period_start AND b.kind = 'monthly');
      v_amount := round(coalesce((v_sum ->> 'cycle_total')::numeric, 0), 2);
      CONTINUE WHEN v_amount <= 0;
      INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
      VALUES (r.id, p.period_start, p.period_end, v_amount,
        coalesce(v_sum -> 'lines', '[]'::jsonb) || CASE WHEN (v_sum ->> 'vat')::numeric > 0 THEN jsonb_build_array(jsonb_build_object('description', 'VAT', 'amount', (v_sum ->> 'vat')::numeric)) ELSE '[]'::jsonb END,
        v_sum ->> 'plan_name', p.period_start, p_mode, 'monthly', v_sum)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    ELSIF s.annual_period_end IS NULL OR v_today > s.annual_period_end THEN
      v_start := coalesce(s.annual_period_end + 1, p.period_start);
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = v_start AND b.kind = 'annual');
      v_amount := round(coalesce((v_sum ->> 'cycle_total')::numeric, 0), 2);
      CONTINUE WHEN v_amount <= 0;
      INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
      VALUES (r.id, v_start, (v_start + interval '1 year' - interval '1 day')::date, v_amount,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('description', (l ->> 'description') || ' × 12 months', 'amount', (l ->> 'amount')::numeric * 12)), '[]'::jsonb)
           FROM jsonb_array_elements(v_sum -> 'lines') l)
        || jsonb_build_array(jsonb_build_object('description', v_sum ->> 'discount_label', 'amount', -(v_sum ->> 'discount')::numeric))
        || CASE WHEN (v_sum ->> 'vat')::numeric > 0 THEN jsonb_build_array(jsonb_build_object('description', 'VAT', 'amount', (v_sum ->> 'vat')::numeric)) ELSE '[]'::jsonb END,
        v_sum ->> 'plan_name', v_start, p_mode, 'annual', v_sum)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN
        v_n := v_n + 1;
        UPDATE public.saas_company_subscriptions SET annual_period_start = v_start,
          annual_period_end = (v_start + interval '1 year' - interval '1 day')::date,
          annual_paid_amount = round((v_sum ->> 'cycle_subtotal')::numeric - (v_sum ->> 'discount')::numeric, 2),
          annual_base_monthly = (v_sum ->> 'monthly_charge')::numeric
         WHERE id = s.id;
      END IF;
    ELSE
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = p.period_start AND b.kind = 'extras');
      v_extra := (v_sum ->> 'monthly_charge')::numeric - coalesce(s.annual_base_monthly, (v_sum ->> 'monthly_charge')::numeric);
      CONTINUE WHEN v_extra <= 0;
      v_amount := round(v_extra * (1 - st.annual_discount), 2);
      IF st.vat_enabled THEN v_amount := v_amount + round(v_amount * st.vat_rate, 2); END IF;
      INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
      VALUES (r.id, p.period_start, p.period_end, v_amount,
        jsonb_build_array(
          jsonb_build_object('description', 'Extras added since your annual bill (this month)', 'amount', v_extra),
          jsonb_build_object('description', format('Annual discount (%s%%)', round(st.annual_discount * 100)), 'amount', -round(v_extra * st.annual_discount, 2)))
        || CASE WHEN st.vat_enabled THEN jsonb_build_array(jsonb_build_object('description', 'VAT', 'amount', round(round(v_extra * (1 - st.annual_discount), 2) * st.vat_rate, 2))) ELSE '[]'::jsonb END,
        v_sum ->> 'plan_name', p.period_start, p_mode, 'extras', v_sum)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    END IF;

    UPDATE public.saas_company_subscriptions SET subscription_status = 'active', billing_status = 'active',
           next_billing_date = (p.period_end + 1), updated_at = now()
     WHERE company_id = r.id AND subscription_status = 'trialing';
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.billing_create_due_bills(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_create_due_bills(text) TO service_role;

CREATE OR REPLACE FUNCTION public.billing_price(p_plan saas_plans, p_cycle text, p_emp integer, p_ct integer, p_clients integer, p_prop integer, p_farms integer, p_override numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  st public.billing_settings%ROWTYPE;
  v_emp_over int := GREATEST(0, coalesce(p_emp, 0) - coalesce(p_plan.included_employees, 0));
  v_ct_over int := GREATEST(0, coalesce(p_ct, 0) - coalesce(p_plan.included_contractors, 0));
  v_cl_over int := GREATEST(0, coalesce(p_clients, 0) - coalesce(p_plan.included_client_portals, 0));
  v_pr_over int := GREATEST(0, coalesce(p_prop, 0) - coalesce(p_plan.included_properties, 0));
  v_farms int := GREATEST(0, coalesce(p_farms, 0));
  v_lines jsonb; v_monthly numeric; v_sub numeric; v_disc numeric := 0; v_vat numeric := 0; v_months int;
BEGIN
  SELECT * INTO st FROM public.billing_settings WHERE id;
  IF p_plan.max_employees IS NOT NULL THEN v_emp_over := 0; END IF;
  IF p_override IS NOT NULL THEN
    v_lines := jsonb_build_array(jsonb_build_object('description', 'Agreed monthly price', 'amount', p_override));
  ELSE
    SELECT coalesce(jsonb_agg(l ORDER BY o), '[]'::jsonb) INTO v_lines FROM (
      SELECT 1 o, jsonb_build_object('description', format('%s (includes %s employees, %s contractor portal seats, %s client portal seats, %s properties)',
        p_plan.name, p_plan.included_employees, p_plan.included_contractors, p_plan.included_client_portals, p_plan.included_properties),
        'amount', p_plan.monthly_price) l
      UNION ALL SELECT 2, jsonb_build_object('description', format('Additional employees (%s × R%s)', v_emp_over, to_char(p_plan.per_employee_price, 'FM999990')), 'amount', v_emp_over * p_plan.per_employee_price) WHERE v_emp_over > 0
      UNION ALL SELECT 3, jsonb_build_object('description', format('Additional contractor portal seats (%s × R%s)', v_ct_over, to_char(p_plan.per_contractor_price, 'FM999990')), 'amount', v_ct_over * p_plan.per_contractor_price) WHERE v_ct_over > 0
      UNION ALL SELECT 4, jsonb_build_object('description', format('Additional client portal seats (%s × R%s)', v_cl_over, to_char(p_plan.per_client_portal_price, 'FM999990')), 'amount', v_cl_over * p_plan.per_client_portal_price) WHERE v_cl_over > 0
      UNION ALL SELECT 5, jsonb_build_object('description', format('Additional properties (%s × R%s)', v_pr_over, to_char(p_plan.per_property_price, 'FM999990')), 'amount', v_pr_over * p_plan.per_property_price) WHERE v_pr_over > 0
      UNION ALL SELECT 6, jsonb_build_object('description', format('Farms (%s × R%s)', v_farms, to_char(p_plan.per_farm_price, 'FM999990')), 'amount', v_farms * p_plan.per_farm_price) WHERE v_farms > 0
    ) x;
  END IF;
  SELECT coalesce(sum((l ->> 'amount')::numeric), 0) INTO v_monthly FROM jsonb_array_elements(v_lines) l;
  v_months := CASE WHEN p_cycle = 'annual' THEN 12 ELSE 1 END;
  v_sub := v_monthly * v_months;
  IF p_cycle = 'annual' THEN v_disc := round(v_sub * st.annual_discount, 2); END IF;
  IF st.vat_enabled THEN v_vat := round((v_sub - v_disc) * st.vat_rate, 2); END IF;
  RETURN jsonb_build_object(
    'plan_code', p_plan.code, 'plan_name', p_plan.name, 'cycle', coalesce(p_cycle, 'monthly'), 'months', v_months,
    'lines', v_lines, 'monthly_subtotal', round(v_monthly, 2), 'subtotal', round(v_sub, 2),
    'discount', v_disc, 'discount_label', CASE WHEN v_disc > 0 THEN format('Annual discount (%s%%)', round(st.annual_discount * 100)) END,
    'vat', v_vat, 'vat_rate', CASE WHEN st.vat_enabled THEN st.vat_rate END,
    'total', round(v_sub - v_disc + v_vat, 2),
    'counts', jsonb_build_object('employees', p_emp, 'contractors', p_ct, 'client_portals', p_clients, 'properties', p_prop, 'farms', p_farms),
    'over', jsonb_build_object('employees', v_emp_over, 'contractors', v_ct_over, 'client_portals', v_cl_over, 'properties', v_pr_over));
END $function$;
REVOKE ALL ON FUNCTION public.billing_price(saas_plans,text,integer,integer,integer,integer,integer,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_price(saas_plans,text,integer,integer,integer,integer,integer,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.branch_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.branch_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.branch_touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.branch_touch_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.branch_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.branch_touch_updated_at() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_employee_invite()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_meta_id text;
  v_emp public.employees%ROWTYPE;
  v_role text;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT lower(trim(u.email)) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'Authenticated user has no email'; END IF;
  v_meta_id := nullif(trim(coalesce((auth.jwt() -> 'user_metadata' ->> 'invited_employee_id'), '')), '');
  IF v_meta_id IS NOT NULL AND v_meta_id ~* '^[0-9a-f-]{36}$' THEN
    SELECT * INTO v_emp FROM public.employees e WHERE e.id = v_meta_id::uuid AND e.is_active = true AND lower(trim(coalesce(e.email, ''))) = v_email LIMIT 1;
    v_found := FOUND;
  END IF;
  IF NOT v_found THEN
    SELECT * INTO v_emp FROM public.employees e WHERE e.is_active = true AND lower(trim(coalesce(e.email, ''))) = v_email AND e.user_id IS NULL ORDER BY e.created_at ASC LIMIT 1;
    v_found := FOUND;
  END IF;
  IF NOT v_found THEN
    SELECT * INTO v_emp FROM public.employees e WHERE e.is_active = true AND e.user_id = v_uid AND lower(trim(coalesce(e.email, ''))) = v_email ORDER BY e.created_at ASC LIMIT 1;
    v_found := FOUND;
  END IF;
  IF NOT v_found THEN RAISE EXCEPTION 'No employee invite found for this email. Ask HR to send an invite.'; END IF;
  IF v_emp.user_id IS NOT NULL AND v_emp.user_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'This employee is already linked to another login account.'; END IF;
  UPDATE public.employees SET user_id = v_uid WHERE id = v_emp.id AND (user_id IS NULL OR user_id = v_uid);
  v_role := CASE lower(coalesce(v_emp.access_level, 'employee'))
    WHEN 'owner' THEN 'owner'
    WHEN 'admin' THEN 'admin'
    WHEN 'hr' THEN 'hr'
    WHEN 'hr_admin' THEN 'hr'
    WHEN 'manager' THEN 'manager'
    ELSE 'employee'
  END;
  INSERT INTO public.company_relationships (user_id, company_id, role, is_active)
  VALUES (v_uid, v_emp.company_id, v_role, true)
  ON CONFLICT (user_id, company_id) DO UPDATE SET is_active = true, role = EXCLUDED.role;
  RETURN jsonb_build_object(
    'employee_id', v_emp.id,
    'company_id', v_emp.company_id,
    'access_level', v_emp.access_level,
    'login_password_ready', coalesce(v_emp.login_password_ready, false),
    'email', v_email
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_employee_invite() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_employee_invite() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_employee_invite() TO anon;
GRANT EXECUTE ON FUNCTION public.claim_employee_invite() TO service_role;

CREATE OR REPLACE FUNCTION public.client_workspace_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.client_workspace_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_workspace_touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_workspace_touch_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.client_workspace_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.client_workspace_touch_updated_at() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.complete_milestone(p_milestone_id uuid, p_create_invoice boolean DEFAULT true, p_invoice_due_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_milestone  public.project_milestones%ROWTYPE;
  v_deal       public.client_deals%ROWTYPE;
  v_invoice_id uuid;
  v_inv_number text;
  v_inv_amount numeric;
BEGIN
  SELECT * INTO v_milestone FROM public.project_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milestone % not found', p_milestone_id;
  END IF;

  PERFORM public.user_has_permission(v_milestone.company_id, 'projects.edit');

  SELECT * INTO v_deal FROM public.client_deals WHERE id = v_milestone.deal_id;

  IF v_milestone.invoice_percentage > 0 THEN
    v_inv_amount := ROUND(v_deal.offer_amount * v_milestone.invoice_percentage / 100, 2);
  ELSE
    v_inv_amount := v_milestone.invoice_amount;
  END IF;

  UPDATE public.project_milestones
  SET status = 'completed',
      completion_date = CURRENT_DATE,
      updated_at = now()
  WHERE id = p_milestone_id;

  IF p_create_invoice AND v_milestone.triggers_invoice AND v_inv_amount > 0 THEN
    SELECT public.generate_invoice_number(v_milestone.company_id) INTO v_inv_number;

    INSERT INTO public.finance_invoices (
      company_id, client_id, deal_id, milestone_id,
      invoice_number, invoice_type, status,
      subtotal, vat_rate, vat_amount, total_amount, balance_due,
      issue_date, due_date, notes
    )
    VALUES (
      v_milestone.company_id,
      v_deal.client_id,
      v_deal.id,
      p_milestone_id,
      v_inv_number,
      'milestone',
      'draft',
      v_inv_amount,
      0.15,
      ROUND(v_inv_amount * 0.15, 2),
      ROUND(v_inv_amount * 1.15, 2),
      ROUND(v_inv_amount * 1.15, 2),
      CURRENT_DATE,
      CURRENT_DATE + p_invoice_due_days,
      'Milestone: ' || v_milestone.name
    )
    RETURNING id INTO v_invoice_id;

    UPDATE public.project_milestones
    SET invoice_id = v_invoice_id
    WHERE id = p_milestone_id;
  END IF;

  IF v_milestone.is_retention_release THEN
    UPDATE public.client_deals
    SET retention_released_at = now(),
        updated_at = now()
    WHERE id = v_milestone.deal_id;
  END IF;

  RETURN jsonb_build_object(
    'milestone_id', p_milestone_id,
    'invoice_id',   v_invoice_id,
    'invoice_amount', v_inv_amount
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_milestone(uuid,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_milestone(uuid,boolean,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_milestone(uuid,boolean,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_milestone(uuid,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_milestone(uuid,boolean,integer) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.contractor_statement(p_contractor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.contractors WHERE id = p_contractor_id;
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(v_company)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN coalesce((
    SELECT json_agg(row_to_json(e) ORDER BY e.entry_date, e.ord) FROM (
      SELECT coalesce(p.payout_date, p.created_at::date) entry_date, 1 ord, 'invoice' kind, p.id invoice_id,
             j.job_code reference, 'Payout' || coalesce(' — ' || nullif(j.title, ''), '') description,
             p.total_amount - coalesce(p.retention_amount, 0) debit, 0::numeric credit, NULL::date due_date,
             coalesce(p.approval_status, 'pending') status
      FROM public.contractor_payouts p LEFT JOIN public.jobs j ON j.id = p.job_id
      WHERE p.contractor_id = p_contractor_id AND p.company_id = v_company
        AND coalesce(p.approval_status, '') <> 'rejected' AND coalesce(p.payout_status, '') NOT IN ('cancelled', 'rejected')
      UNION ALL
      SELECT coalesce(p.paid_at::date, p.payout_date), 2, 'payment', p.id, coalesce(p.remittance_number, j.job_code), 'Paid',
             0, p.total_amount - coalesce(p.retention_amount, 0), NULL, NULL
      FROM public.contractor_payouts p LEFT JOIN public.jobs j ON j.id = p.job_id
      WHERE p.contractor_id = p_contractor_id AND p.company_id = v_company AND p.payout_status = 'paid') e), '[]'::json);
END $function$;
REVOKE ALL ON FUNCTION public.contractor_statement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contractor_statement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_statement(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.current_hr_company_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select hu.company_id
  from public.hr_users hu
  where hu.auth_user_id = auth.uid()
    and hu.is_active = true
  limit 1
$function$;
REVOKE ALL ON FUNCTION public.current_hr_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_hr_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_hr_company_id() TO anon;
GRANT EXECUTE ON FUNCTION public.current_hr_company_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.current_hr_company_id() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.delete_employee(p_company_id uuid, p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_before jsonb;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required to delete employees'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(e) INTO v_before
  FROM employees e
  WHERE e.id = p_employee_id AND e.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this company' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.work_teams
  SET leader_employee_id = NULL
  WHERE company_id = p_company_id AND leader_employee_id = p_employee_id;

  UPDATE public.jobs
  SET assignee_employee_id = NULL
  WHERE company_id = p_company_id AND assignee_employee_id = p_employee_id;

  UPDATE public.pa_tasks
  SET assigned_employee_id = NULL
  WHERE company_id = p_company_id AND assigned_employee_id = p_employee_id;

  UPDATE public.pa_tasks
  SET delegated_by_employee_id = NULL
  WHERE company_id = p_company_id AND delegated_by_employee_id = p_employee_id;

  IF EXISTS (
    SELECT 1 FROM public.ownership_transfer_requests
    WHERE company_id = p_company_id AND target_employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'ownership transfer requests');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leave_requests
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'leave requests');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_approvals
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'payroll / payment approvals');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.labor_entries
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'labor entries');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.incident_reports
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'incident reports');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_usage
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'inventory usage');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.job_cards
    WHERE company_id = p_company_id AND employee_id = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'job cards');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payroll_period_locks
    WHERE company_id = p_company_id AND locked_by = p_employee_id
  ) THEN
    v_blockers := array_append(v_blockers, 'payroll period locks');
  END IF;

  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION
      'Cannot permanently delete this employee while related records still exist (%). Use Archive instead, or remove those records first.',
      array_to_string(v_blockers, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.time_punches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  DELETE FROM public.employees
  WHERE company_id = p_company_id AND id = p_employee_id;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'employee.deleted',
      'employee',
      p_employee_id::text,
      v_before,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_employee(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_employee(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_delete_pa_task(p_company_id bigint, p_employee_id bigint, p_task_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.pa_tasks t
  WHERE t.id = p_task_id
    AND t.company_id = p_company_id
    AND t.owner_employee_id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_delete_pa_task(bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_delete_pa_task(bigint,bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_delete_pa_task(bigint,bigint,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_delete_pa_task(bigint,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_delete_pa_task(bigint,bigint,bigint) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_get_documents(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    PERFORM 1 FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

    RETURN (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.created_at DESC), '[]'::json)
        FROM employee_documents d
        WHERE d.employee_id = p_employee_id AND d.company_id = p_company_id
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_documents(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_documents(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_documents(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_documents(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_get_documents(uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_get_job_for_employee(p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, company_id uuid, title text, description text, client_id uuid, site_id uuid, status text, priority text, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, job_code text, assignee_employee_id uuid, assigned_employee_ids uuid[], created_by_employee_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, client_name text, site_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT
    j.id, j.company_id, j.title, j.description,
    j.client_id, j.site_id, j.status, j.priority,
    j.scheduled_start, j.scheduled_end, j.job_code,
    j.assignee_employee_id, j.assigned_employee_ids, j.created_by_employee_id,
    j.created_at, j.updated_at,
    c.name AS client_name,
    s.name AS site_name
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  LEFT JOIN public.sites s   ON s.id = j.site_id
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
    AND (
      j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR (
        j.contractor_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.contractor_member_links cml
          WHERE cml.company_id = p_company_id
            AND cml.employee_id = p_employee_id
            AND cml.contractor_id = j.contractor_id
        )
      )
    )
  LIMIT 1;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_job_for_employee(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_job_for_employee(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_for_employee(uuid,uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_job_for_employee(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_get_job_for_employee(uuid,uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_get_job_geofence(p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lat     double precision;
  v_lng     double precision;
  v_radius  double precision;
  v_mode    boolean;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  SELECT
    s.latitude,
    s.longitude,
    COALESCE(j.site_radius_meters, s.radius_meters),
    j.site_radius_mode
  INTO v_lat, v_lng, v_radius, v_mode
  FROM public.jobs j
  LEFT JOIN public.sites s ON s.id = j.site_id AND s.company_id = p_company_id
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id;

  -- Return null if no geofence enforcement on this job
  IF NOT FOUND OR v_mode IS NOT TRUE OR v_lat IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'latitude',      v_lat,
    'longitude',     v_lng,
    'radius_meters', v_radius,
    'enforced',      v_mode
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_job_geofence(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_job_geofence(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_geofence(uuid,uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_job_geofence(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_get_job_geofence(uuid,uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_get_last_punch(p_employee_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row json;
BEGIN
    -- Resolves company_id from employees.company_id, then calls _assert_worker_access.
    -- Raises UNAUTHORIZED / ERRCODE 42501 if the session is invalid or expired.
    PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);

    SELECT row_to_json(tp.*)
    INTO v_row
    FROM public.time_punches tp
    WHERE tp.employee_id = p_employee_id
    ORDER BY tp.date_time DESC
    LIMIT 1;

    RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_last_punch(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_last_punch(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_last_punch(uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_last_punch(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_get_my_punches(p_company_id uuid, p_employee_id uuid, p_from date, p_to date, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_emp public.employees%rowtype;
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    -- Secondary employee-existence guard: ensures the caller cannot retrieve
    -- punches for a deactivated or deleted employee record even if the session
    -- token itself is still valid.
    SELECT * INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id
      AND company_id = p_company_id
      AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    RETURN (
        SELECT coalesce(
            json_agg(row_to_json(tp) ORDER BY tp.date_time ASC),
            '[]'::json
        )
        FROM public.time_punches tp
        WHERE tp.employee_id       = p_employee_id
          AND tp.company_id        = p_company_id
          AND tp.date_time::date  >= p_from
          AND tp.date_time::date  <= p_to
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_my_punches(uuid,uuid,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_my_punches(uuid,uuid,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_my_punches(uuid,uuid,date,date,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_my_punches(uuid,uuid,date,date,text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_get_overview_bundle(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL::text, p_include_jobs boolean DEFAULT true, p_include_leave boolean DEFAULT true, p_include_attendance boolean DEFAULT true, p_include_incidents boolean DEFAULT true, p_include_my_pa boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_today date := (timezone('utc', now()))::date;
  v_week_from date := (timezone('utc', now()))::date - 7;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  RETURN jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'enabled_modules', coalesce(c.enabled_modules, '{}'::jsonb),
        'dispatch_settings', coalesce(c.custom_settings->'dispatch_settings', '{}'::jsonb)
      )
      FROM public.companies c
      WHERE c.id = p_company_id
    ),
    'employee', (
      SELECT jsonb_build_object(
        'id', e.id,
        'company_id', e.company_id,
        'name', e.name,
        'surname', e.surname,
        'branch_id', e.branch_id,
        'enforce_branch_geofence', e.enforce_branch_geofence,
        'branch', e.branch,
        'registration_status', e.registration_status,
        'is_active', e.is_active,
        'access_level', e.access_level
      )
      FROM public.employees e
      WHERE e.id = p_employee_id
        AND e.company_id = p_company_id
    ),
    'branches', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'latitude', b.latitude,
        'longitude', b.longitude,
        'radius_meters', b.radius_meters,
        'is_active', b.is_active
      ) ORDER BY b.name)
      FROM public.branches b
      WHERE b.company_id = p_company_id
    ), '[]'::jsonb),
    'last_punch', (
      SELECT to_jsonb(tp.*)
      FROM public.time_punches tp
      WHERE tp.employee_id = p_employee_id
      ORDER BY tp.date_time DESC
      LIMIT 1
    ),
    'jobs', CASE WHEN NOT p_include_jobs THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(j.*) ORDER BY j.created_at DESC)
      FROM public.jobs j
      WHERE j.company_id = p_company_id
        AND (
          j.created_by_employee_id = p_employee_id
          OR j.assigned_employee_ids @> ARRAY[p_employee_id]
          OR j.assignee_employee_id = p_employee_id
          OR j.contractor_employee_id = p_employee_id
          OR (
            j.contractor_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.contractor_member_links cml
              WHERE cml.company_id = p_company_id
                AND cml.employee_id = p_employee_id
                AND cml.contractor_id = j.contractor_id
            )
          )
        )
    ), '[]'::jsonb) END,
    'leave_requests', CASE WHEN NOT p_include_leave THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at DESC)
      FROM public.leave_requests r
      WHERE r.company_id = p_company_id
        AND r.employee_id = p_employee_id
    ), '[]'::jsonb) END,
    'is_on_leave', CASE WHEN NOT p_include_leave THEN false ELSE EXISTS (
      SELECT 1
      FROM public.leave_requests lr
      WHERE lr.company_id = p_company_id
        AND lr.employee_id = p_employee_id
        AND lr.status = 'approved'
        AND lr.start_date <= v_today
        AND lr.end_date >= v_today
    ) END,
    'colleagues_on_leave', CASE WHEN NOT p_include_leave THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'employee_id', x.employee_id,
        'leave_type', x.leave_type,
        'end_date', x.end_date,
        'employees', jsonb_build_object(
          'name', x.name,
          'surname', x.surname
        )
      ))
      FROM (
        SELECT lr.employee_id, lr.leave_type, lr.end_date, e.name, e.surname
        FROM public.leave_requests lr
        JOIN public.employees e ON e.id = lr.employee_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND lr.start_date <= v_today
          AND lr.end_date >= v_today
          AND lr.employee_id <> p_employee_id
        LIMIT 10
      ) x
    ), '[]'::jsonb) END,
    'incidents', CASE WHEN NOT p_include_incidents THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(i.*) ORDER BY i.created_at DESC)
      FROM (
        SELECT i.*
        FROM public.incident_reports i
        WHERE i.company_id = p_company_id
          AND (
            i.employee_id = p_employee_id
            OR i.assignee_id = p_employee_id
            OR (
              i.job_id IS NOT NULL
              AND public._employee_assigned_to_job(p_company_id, p_employee_id, i.job_id)
            )
          )
        ORDER BY i.created_at DESC
        LIMIT 200
      ) i
    ), '[]'::jsonb) END,
    'punches_today', CASE WHEN NOT p_include_attendance THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(tp.*) ORDER BY tp.date_time DESC)
      FROM public.time_punches tp
      WHERE tp.company_id = p_company_id
        AND tp.employee_id = p_employee_id
        AND (tp.date_time AT TIME ZONE 'utc')::date = v_today
    ), '[]'::jsonb) END,
    'punches_week', CASE WHEN NOT p_include_attendance THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(tp.*) ORDER BY tp.date_time DESC)
      FROM public.time_punches tp
      WHERE tp.company_id = p_company_id
        AND tp.employee_id = p_employee_id
        AND (tp.date_time AT TIME ZONE 'utc')::date BETWEEN v_week_from AND v_today
    ), '[]'::jsonb) END,
    'pa_tasks', CASE WHEN NOT p_include_my_pa THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.created_at DESC)
      FROM public.pa_tasks t
      WHERE t.company_id = p_company_id
        AND (
          t.owner_employee_id = p_employee_id
          OR t.assigned_employee_id = p_employee_id
        )
    ), '[]'::jsonb) END,
    'absences_today', CASE WHEN NOT p_include_attendance THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.date DESC)
      FROM public.daily_absences a
      WHERE a.company_id = p_company_id
        AND a.employee_id = p_employee_id
        AND a.date = v_today
    ), '[]'::jsonb) END,
    'notifications', coalesce((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC)
      FROM (
        SELECT
          id, company_id, type, title, body, ref_type, ref_id,
          data, is_read, read_at, created_at
        FROM public.app_notifications
        WHERE audience IN ('employee', 'all')
          AND (
            recipient_employee_id = p_employee_id
            OR recipient_auth_user_id IN (
              SELECT user_id FROM public.employees
              WHERE id = p_employee_id AND user_id IS NOT NULL
            )
          )
        ORDER BY created_at DESC
        LIMIT 50
      ) n
    ), '[]'::jsonb),
    'work_teams', coalesce((
      SELECT jsonb_agg(to_jsonb(wt.*))
      FROM public.work_teams wt
      WHERE wt.company_id = p_company_id
        AND wt.member_ids @> ARRAY[p_employee_id]
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_overview_bundle(uuid,uuid,text,boolean,boolean,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_overview_bundle(uuid,uuid,text,boolean,boolean,boolean,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_overview_bundle(uuid,uuid,text,boolean,boolean,boolean,boolean,boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_overview_bundle(uuid,uuid,text,boolean,boolean,boolean,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_get_payslips(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
    v_emp employees%rowtype;
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    SELECT * INTO v_emp FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

    RETURN (
        SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.period_start DESC), '[]'::json)
        FROM payment_approvals p
        WHERE p.employee_id = p_employee_id
          AND p.company_id  = p_company_id
          AND p.shared_with_employee = true
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_payslips(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_payslips(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_payslips(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_payslips(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_get_payslips(uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_get_profile(p_employee_id uuid, p_company_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_emp employees%rowtype;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  SELECT * INTO v_emp
  FROM employees
  WHERE id = p_employee_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  RETURN row_to_json(v_emp);
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_profile(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_profile(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_profile(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_profile(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_get_profile(uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_get_punches(p_company_id bigint, p_employee_id bigint, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS SETOF punches
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.*
  from public.punches p
  where p.company_id = p_company_id
    and p.employees_id = p_employee_id
    and (p_from is null or p."Date" >= p_from)
    and (p_to is null or p."Date" <= p_to)
  order by p."Date" desc, p.id desc;
$function$;
REVOKE ALL ON FUNCTION public.employee_get_punches(bigint,bigint,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_punches(bigint,bigint,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_punches(bigint,bigint,date,date) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_punches(bigint,bigint,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_get_punches(bigint,bigint,date,date) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_get_work_teams(p_company_id bigint, p_employee_id bigint)
 RETURNS TABLE(id bigint, company_id bigint, name text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT wt.id, wt.company_id, wt.name, wt.created_at
  FROM public.work_teams wt
  INNER JOIN public.work_team_members m
    ON m.team_id = wt.id AND m.company_id = wt.company_id
  WHERE m.company_id = p_company_id
    AND m.employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
$function$;
REVOKE ALL ON FUNCTION public.employee_get_work_teams(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_work_teams(bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_work_teams(bigint,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_get_work_teams(bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_get_work_teams(bigint,bigint) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_has_shift_overlap(p_company_id bigint, p_employee_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
AS $function$
  select exists (
    select 1
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id and s.company_id = a.company_id
    where a.company_id = p_company_id
      and a.employee_id = p_employee_id
      and a.status in ('offered', 'accepted', 'completed')
      and s.status in ('open', 'filled', 'in_progress', 'completed')
      and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  );
$function$;
REVOKE ALL ON FUNCTION public.employee_has_shift_overlap(bigint,bigint,timestamp with time zone,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_has_shift_overlap(bigint,bigint,timestamp with time zone,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_has_shift_overlap(bigint,bigint,timestamp with time zone,timestamp with time zone) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_has_shift_overlap(bigint,bigint,timestamp with time zone,timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_has_shift_overlap(bigint,bigint,timestamp with time zone,timestamp with time zone) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_insert_incident(p_company_id uuid, p_employee_id uuid, p_description text, p_severity text DEFAULT 'low'::text, p_job_id uuid DEFAULT NULL::uuid, p_site_id uuid DEFAULT NULL::uuid, p_assignee_id uuid DEFAULT NULL::uuid, p_photo_urls text[] DEFAULT '{}'::text[], p_reported_by_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_row public.incident_reports%rowtype;
begin
  if trim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if p_job_id is not null
     and not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  insert into public.incident_reports (
    company_id, employee_id, job_id, site_id, description, severity,
    photo_urls, assignee_id, reported_by_name, is_closed, created_at
  ) values (
    p_company_id, p_employee_id, p_job_id, p_site_id, trim(p_description),
    coalesce(nullif(trim(p_severity), ''), 'low'),
    coalesce(p_photo_urls, '{}'), p_assignee_id,
    nullif(trim(coalesce(p_reported_by_name, '')), ''),
    false, now()
  )
  returning * into v_row;

  return row_to_json(v_row);
end;
$function$;
REVOKE ALL ON FUNCTION public.employee_insert_incident(uuid,uuid,text,text,uuid,uuid,uuid,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_insert_incident(uuid,uuid,text,text,uuid,uuid,uuid,text[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_incident(uuid,uuid,text,text,uuid,uuid,uuid,text[],text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_insert_incident(uuid,uuid,text,text,uuid,uuid,uuid,text[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_insert_punch(p_company_id uuid, p_employee_id uuid, p_type text, p_date_time timestamp with time zone, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_job_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_punched_by_manager_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_punch public.time_punches;
    v_last  public.time_punches;
    v_type  text := lower(trim(p_type));
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_punch
        FROM public.time_punches
        WHERE company_id      = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;
        IF FOUND THEN
            RETURN row_to_json(v_punch);
        END IF;
    END IF;

    IF v_type = 'in' THEN
        IF public.employee_is_on_leave_today(p_company_id, p_employee_id, p_session_token) THEN
            RAISE EXCEPTION 'Employee is on approved leave and cannot clock in';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.daily_absences
            WHERE company_id  = p_company_id
              AND employee_id = p_employee_id
              AND date        = current_date
        ) THEN
            RAISE EXCEPTION 'Employee is marked absent and cannot clock in';
        END IF;

        SELECT * INTO v_last
        FROM public.time_punches
        WHERE company_id  = p_company_id
          AND employee_id = p_employee_id
        ORDER BY date_time DESC, created_at DESC
        LIMIT 1;

        IF FOUND AND lower(trim(v_last.type)) = 'in' THEN
            RETURN row_to_json(v_last);
        END IF;
    END IF;

    BEGIN
        INSERT INTO public.time_punches (
            id, company_id, employee_id, type, date_time,
            latitude, longitude, address, job_id, notes,
            punched_by_manager_id, idempotency_key
        ) VALUES (
            gen_random_uuid(), p_company_id, p_employee_id, p_type, p_date_time,
            p_latitude, p_longitude, p_address, p_job_id, p_notes,
            p_punched_by_manager_id, p_idempotency_key
        ) RETURNING * INTO v_punch;
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_punch
        FROM public.time_punches
        WHERE company_id      = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;
    END;

    RETURN row_to_json(v_punch);
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_insert_punch(uuid,uuid,text,timestamp with time zone,double precision,double precision,text,uuid,text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_insert_punch(uuid,uuid,text,timestamp with time zone,double precision,double precision,text,uuid,text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_punch(uuid,uuid,text,timestamp with time zone,double precision,double precision,text,uuid,text,uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_insert_punch(uuid,uuid,text,timestamp with time zone,double precision,double precision,text,uuid,text,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_is_on_leave_today(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Validates code-login session token (anon path) or JWT company membership
    -- (authenticated path). Raises UNAUTHORIZED / ERRCODE 42501 on failure.
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    RETURN EXISTS (
        SELECT 1
        FROM public.leave_requests
        WHERE company_id  = p_company_id
          AND employee_id = p_employee_id
          AND status      = 'approved'
          AND start_date  <= CURRENT_DATE
          AND end_date    >= CURRENT_DATE
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_is_on_leave_today(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_is_on_leave_today(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_is_on_leave_today(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_is_on_leave_today(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_submit_document(p_company_id uuid, p_employee_id uuid, p_document_type text, p_document_name text, p_file_url text, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
    v_doc employee_documents%rowtype;
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    PERFORM 1 FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

    INSERT INTO employee_documents (company_id, employee_id, document_type, document_name, file_url, uploaded_by_role)
    VALUES (p_company_id, p_employee_id, p_document_type, p_document_name, p_file_url, 'employee')
    RETURNING * INTO v_doc;

    RETURN row_to_json(v_doc);
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_submit_document(uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_submit_document(uuid,uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_document(uuid,uuid,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_submit_document(uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_submit_document(uuid,uuid,text,text,text,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_submit_punch(p_company_id bigint, p_employee_id bigint, p_is_sign_in boolean, p_ts timestamp with time zone, p_lat numeric DEFAULT NULL::numeric, p_lon numeric DEFAULT NULL::numeric, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_date date := (p_ts at time zone 'utc')::date;
  v_time time with time zone := (p_ts);
  v_id uuid;
begin
  if not exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.company_id = p_company_id
  ) then
    raise exception 'Employee not in company';
  end if;

  if p_is_sign_in then
    -- Prevent duplicate open sign-in for the same day
    select p.id into v_id
    from public.punches p
    where p.company_id = p_company_id
      and p.employees_id = p_employee_id
      and p."Date" = v_date
      and p.sign_out is null
    order by p.id desc
    limit 1;

    if v_id is not null then
      return v_id; -- already signed in, do not create another row
    end if;

    insert into public.punches(
      employees_id, company_id, sign_in, sign_out, longitude, latitude, location, "Notes", "Date"
    )
    values (
      p_employee_id, p_company_id, v_time, null, p_lon, p_lat, p_location, p_notes, v_date
    )
    returning id into v_id;

    return v_id;
  else
    select p.id into v_id
    from public.punches p
    where p.company_id = p_company_id
      and p.employees_id = p_employee_id
      and p."Date" = v_date
      and p.sign_out is null
    order by p.id desc
    limit 1;

    if v_id is null then
      raise exception 'No open sign-in session found';
    end if;

    update public.punches
    set sign_out = v_time,
        longitude = coalesce(p_lon, longitude),
        latitude = coalesce(p_lat, latitude),
        location = coalesce(p_location, location),
        "Notes" = coalesce(p_notes, "Notes")
    where id = v_id;

    return v_id;
  end if;
end
$function$;
REVOKE ALL ON FUNCTION public.employee_submit_punch(bigint,bigint,boolean,timestamp with time zone,numeric,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_submit_punch(bigint,bigint,boolean,timestamp with time zone,numeric,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_punch(bigint,bigint,boolean,timestamp with time zone,numeric,numeric,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_submit_punch(bigint,bigint,boolean,timestamp with time zone,numeric,numeric,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_submit_punch(bigint,bigint,boolean,timestamp with time zone,numeric,numeric,text,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_submit_timesheet(p_company_id uuid, p_employee_id uuid, p_work_date date, p_time_in text, p_time_out text, p_notes text DEFAULT NULL::text, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp          public.employees%ROWTYPE;
  v_caller_id    uuid;
  v_role         text;
  v_level        text;
  v_self         boolean;
  v_tz           text;
  v_today        date;
  v_in_time      time;
  v_out_time     time;
  v_in           timestamptz;
  v_out          timestamptz;
  v_prev_type    text;
  v_note         text;
  v_manager      uuid;
  v_in_id        uuid;
  v_out_id       uuid;
  v_in_row       public.time_punches%ROWTYPE;
  v_out_row      public.time_punches%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  SELECT * INTO v_emp
  FROM public.employees
  WHERE id = p_employee_id
    AND company_id = p_company_id
    AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  v_self := auth.uid() IS NOT NULL AND v_emp.user_id = auth.uid();
  v_manager := NULL;

  IF auth.uid() IS NOT NULL AND NOT v_self THEN
    SELECT role INTO v_role
    FROM public.company_relationships
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = true
    LIMIT 1;

    SELECT e.id, e.access_level INTO v_caller_id, v_level
    FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.company_id = p_company_id
      AND e.is_active = true
    LIMIT 1;

    IF v_role IN ('owner', 'hr') OR v_level IN ('owner', 'hr') THEN
      v_manager := auth.uid();
    ELSIF v_role = 'manager' OR v_level = 'manager' THEN
      IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'You cannot enter a timesheet for this employee';
      END IF;
      IF NOT (
        v_emp.manager_id = v_caller_id
        OR (v_emp.manager_user_id IS NOT NULL AND v_emp.manager_user_id = auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.work_teams wt
          WHERE wt.company_id = p_company_id
            AND wt.is_active = true
            AND wt.leader_employee_id = v_caller_id
            AND p_employee_id = ANY (wt.member_ids)
        )
        OR EXISTS (
          SELECT 1
          FROM public.work_teams wt
          WHERE wt.company_id = p_company_id
            AND wt.is_active = true
            AND v_caller_id = ANY (wt.member_ids)
            AND wt.leader_employee_id = p_employee_id
        )
      ) THEN
        RAISE EXCEPTION 'You cannot enter a timesheet for this employee';
      END IF;
      v_manager := auth.uid();
    ELSE
      RAISE EXCEPTION 'You cannot enter a timesheet for this employee';
    END IF;
  END IF;

  IF p_work_date IS NULL OR p_time_in IS NULL OR p_time_out IS NULL THEN
    RAISE EXCEPTION 'Date, time in, and time out are required';
  END IF;
  IF p_time_in !~ '^\d{1,2}:\d{2}(:\d{2})?$' OR p_time_out !~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN
    RAISE EXCEPTION 'Enter time in and time out as hours and minutes';
  END IF;

  BEGIN
    v_in_time := p_time_in::time;
    v_out_time := p_time_out::time;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Enter time in and time out as hours and minutes';
  END;

  IF v_out_time = v_in_time THEN
    RAISE EXCEPTION 'Time out must be different from time in';
  END IF;

  SELECT coalesce(nullif(trim(cs.timezone), ''), 'Africa/Johannesburg')
  INTO v_tz
  FROM public.company_settings cs
  WHERE cs.company_id = p_company_id;
  IF v_tz IS NULL THEN
    v_tz := 'Africa/Johannesburg';
  END IF;

  BEGIN
    PERFORM (now() AT TIME ZONE v_tz);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'Africa/Johannesburg';
  END;

  v_today := (now() AT TIME ZONE v_tz)::date;
  IF p_work_date > v_today THEN
    RAISE EXCEPTION 'Choose a date that is today or earlier';
  END IF;

  v_in := (p_work_date::text || ' ' || v_in_time::text)::timestamp AT TIME ZONE v_tz;
  v_out := ((p_work_date + CASE WHEN v_out_time < v_in_time THEN 1 ELSE 0 END)::text || ' ' || v_out_time::text)::timestamp AT TIME ZONE v_tz;
  IF v_out > now() THEN
    RAISE EXCEPTION 'Time out cannot be in the future';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    WHERE lr.company_id = p_company_id
      AND lr.employee_id = p_employee_id
      AND lr.status = 'approved'
      AND lr.start_date <= p_work_date
      AND lr.end_date >= p_work_date
  ) THEN
    RAISE EXCEPTION 'This employee is on approved leave that day';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.daily_absences da
    WHERE da.company_id = p_company_id
      AND da.employee_id = p_employee_id
      AND da.date = p_work_date
  ) THEN
    RAISE EXCEPTION 'This employee is marked absent that day';
  END IF;

  SELECT tp.type INTO v_prev_type
  FROM public.time_punches tp
  WHERE tp.company_id = p_company_id
    AND tp.employee_id = p_employee_id
    AND tp.date_time < v_in
  ORDER BY tp.date_time DESC
  LIMIT 1;

  IF v_prev_type = 'in' OR EXISTS (
    SELECT 1
    FROM public.time_punches tp
    WHERE tp.company_id = p_company_id
      AND tp.employee_id = p_employee_id
      AND tp.date_time >= v_in
      AND tp.date_time <= v_out
  ) THEN
    RAISE EXCEPTION 'This time overlaps a shift already on record';
  END IF;

  v_note := 'Manual timesheet';
  IF p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN
    v_note := v_note || ' · ' || left(trim(p_notes), 400);
  END IF;

  v_in_id := gen_random_uuid();
  v_out_id := gen_random_uuid();

  INSERT INTO public.time_punches (
    id, company_id, employee_id, type, date_time, notes, punched_by_manager_id
  ) VALUES (
    v_in_id, p_company_id, p_employee_id, 'in', v_in, v_note, v_manager
  )
  RETURNING * INTO v_in_row;

  INSERT INTO public.time_punches (
    id, company_id, employee_id, type, date_time, notes, punched_by_manager_id
  ) VALUES (
    v_out_id, p_company_id, p_employee_id, 'out', v_out, v_note, v_manager
  )
  RETURNING * INTO v_out_row;

  IF auth.uid() IS NOT NULL THEN
    PERFORM public.write_audit_event(
      p_company_id,
      'attendance.manual_timesheet',
      'employee',
      p_employee_id::text,
      NULL,
      jsonb_build_object(
        'work_date', p_work_date,
        'time_in', v_in,
        'time_out', v_out,
        'in_id', v_in_row.id,
        'out_id', v_out_row.id,
        'on_behalf', v_manager IS NOT NULL
      ),
      NULL
    );
  END IF;

  RETURN json_build_object(
    'in_id', v_in_row.id,
    'out_id', v_out_row.id,
    'time_in', v_in,
    'time_out', v_out
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_submit_timesheet(uuid,uuid,date,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_submit_timesheet(uuid,uuid,date,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_timesheet(uuid,uuid,date,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_submit_timesheet(uuid,uuid,date,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_type_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.employee_type_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_type_touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_type_touch_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.employee_type_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_type_touch_updated_at() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_update_pa_task(p_company_id bigint, p_employee_id bigint, p_task_id bigint, p_patch jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pa_tasks t
    WHERE t.id = p_task_id
      AND t.company_id = p_company_id
      AND t.owner_employee_id = p_employee_id
  ) THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks t SET
    title = CASE WHEN p_patch ? 'title' THEN trim(p_patch->>'title') ELSE t.title END,
    notes = CASE
      WHEN p_patch ? 'notes' THEN NULLIF(trim(COALESCE(p_patch->>'notes', '')), '')
      ELSE t.notes
    END,
    priority = CASE WHEN p_patch ? 'priority' THEN trim(p_patch->>'priority') ELSE t.priority END,
    due_at = CASE
      WHEN NOT (p_patch ? 'due_at') THEN t.due_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'due_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'due_at')::timestamptz
    END,
    remind_at = CASE
      WHEN NOT (p_patch ? 'remind_at') THEN t.remind_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'remind_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'remind_at')::timestamptz
    END,
    linked_type = CASE WHEN p_patch ? 'linked_type' THEN trim(p_patch->>'linked_type') ELSE t.linked_type END,
    linked_id = CASE
      WHEN NOT (p_patch ? 'linked_id') THEN t.linked_id
      WHEN NULLIF(trim(COALESCE(p_patch->>'linked_id', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'linked_id')
    END,
    linked_label = CASE
      WHEN NOT (p_patch ? 'linked_label') THEN t.linked_label
      WHEN NULLIF(trim(COALESCE(p_patch->>'linked_label', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'linked_label')
    END,
    recurrence_pattern = CASE WHEN p_patch ? 'recurrence_pattern' THEN trim(p_patch->>'recurrence_pattern') ELSE t.recurrence_pattern END,
    source_type = CASE
      WHEN NOT (p_patch ? 'source_type') THEN t.source_type
      WHEN NULLIF(trim(COALESCE(p_patch->>'source_type', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'source_type')
    END,
    source_id = CASE
      WHEN NOT (p_patch ? 'source_id') THEN t.source_id
      WHEN NULLIF(trim(COALESCE(p_patch->>'source_id', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'source_id')
    END,
    meeting_with = CASE
      WHEN NOT (p_patch ? 'meeting_with') THEN t.meeting_with
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_with', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_with')
    END,
    meeting_at = CASE
      WHEN NOT (p_patch ? 'meeting_at') THEN t.meeting_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'meeting_at')::timestamptz
    END,
    meeting_minutes = CASE
      WHEN NOT (p_patch ? 'meeting_minutes') THEN t.meeting_minutes
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_minutes', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_minutes')
    END,
    meeting_follow_up = CASE
      WHEN NOT (p_patch ? 'meeting_follow_up') THEN t.meeting_follow_up
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_follow_up', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_follow_up')
    END,
    updated_at = now()
  WHERE t.id = p_task_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_update_pa_task(bigint,bigint,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task(bigint,bigint,bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task(bigint,bigint,bigint,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task(bigint,bigint,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task(bigint,bigint,bigint,jsonb) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_update_pa_task_status(p_company_id bigint, p_employee_id bigint, p_task_id bigint, p_status text, p_snoozed_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec public.pa_tasks%ROWTYPE;
  recurrence text;
  next_due timestamptz;
  base_due timestamptz;
BEGIN
  SELECT * INTO rec FROM public.pa_tasks t
  WHERE t.id = p_task_id
    AND t.company_id = p_company_id
    AND t.owner_employee_id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks SET
    status = p_status,
    snoozed_until = p_snoozed_until,
    completed_at = CASE WHEN p_status = 'done' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id;

  recurrence := COALESCE(rec.recurrence_pattern, 'none');

  IF p_status = 'done' AND recurrence <> 'none' THEN
    base_due := COALESCE(rec.due_at, now());

    next_due := CASE recurrence
      WHEN 'daily' THEN base_due + interval '1 day'
      WHEN 'weekly' THEN base_due + interval '7 days'
      WHEN 'monthly' THEN base_due + interval '1 month'
      ELSE base_due + interval '1 day'
    END;

    INSERT INTO public.pa_tasks (
      company_id,
      title,
      notes,
      due_at,
      priority,
      status,
      remind_at,
      linked_type,
      linked_id,
      linked_label,
      recurrence_pattern,
      source_type,
      source_id,
      meeting_with,
      meeting_at,
      owner_employee_id,
      owner_hr_user_id,
      meeting_minutes,
      meeting_follow_up
    ) VALUES (
      rec.company_id,
      rec.title,
      rec.notes,
      next_due,
      COALESCE(rec.priority, 'medium'),
      'todo',
      NULL,
      COALESCE(rec.linked_type, 'none'),
      rec.linked_id,
      rec.linked_label,
      recurrence,
      rec.source_type,
      rec.source_id,
      rec.meeting_with,
      rec.meeting_at,
      rec.owner_employee_id,
      rec.owner_hr_user_id,
      NULL,
      NULL
    );
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_update_pa_task_status(bigint,bigint,bigint,text,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task_status(bigint,bigint,bigint,text,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task_status(bigint,bigint,bigint,text,timestamp with time zone) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task_status(bigint,bigint,bigint,text,timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task_status(bigint,bigint,bigint,text,timestamp with time zone) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_update_profile_legacy_10arg(p_employee_id uuid, p_company_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_id_number text DEFAULT NULL::text, p_bank_account text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_branch_code text DEFAULT NULL::text, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_old employees%rowtype;
    v_emp employees%rowtype;
    v_bank_changed boolean := false;
    v_name text;
    r record;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    SELECT * INTO v_old
    FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    v_bank_changed := (
        (p_bank_account IS NOT NULL AND p_bank_account IS DISTINCT FROM v_old.bank_account)
        OR (p_bank_name IS NOT NULL AND p_bank_name IS DISTINCT FROM v_old.bank_name)
        OR (p_bank_branch_code IS NOT NULL AND p_bank_branch_code IS DISTINCT FROM v_old.bank_branch_code)
    );

    UPDATE employees SET
        name            = coalesce(p_first_name,     name),
        surname         = coalesce(p_last_name,      surname),
        phone           = coalesce(p_phone,          phone),
        id_number       = coalesce(p_id_number,      id_number),
        bank_account    = coalesce(p_bank_account,   bank_account),
        bank_name       = coalesce(p_bank_name,      bank_name),
        bank_branch_code = coalesce(p_bank_branch_code, bank_branch_code),
        bank_details_updated_at = CASE WHEN v_bank_changed THEN now() ELSE bank_details_updated_at END,
        bank_details_updated_by = CASE WHEN v_bank_changed THEN 'employee' ELSE bank_details_updated_by END
    WHERE id = p_employee_id
    RETURNING * INTO v_emp;

    IF v_bank_changed THEN
        v_name := trim(coalesce(v_emp.name, '') || ' ' || coalesce(v_emp.surname, ''));

        FOR r IN
            SELECT DISTINCT hr.user_id AS auth_user_id
            FROM employees hr
            WHERE hr.company_id = p_company_id
              AND hr.user_id IS NOT NULL
              AND hr.is_active = true
              AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'hr')
              AND hr.id <> p_employee_id
        LOOP
            INSERT INTO app_notifications (
                company_id, audience, recipient_auth_user_id, recipient_employee_id,
                type, title, body, ref_type, ref_id, dedupe_key, data
            ) VALUES (
                p_company_id,
                'hr',
                r.auth_user_id,
                NULL,
                'bank_details_updated',
                'Banking details updated',
                v_name || ' updated their banking details for payroll.',
                'employee',
                p_employee_id::text,
                'bank_details_updated:' || p_employee_id::text || ':' || r.auth_user_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
                jsonb_build_object(
                    'employee_id', p_employee_id,
                    'company_id', p_company_id,
                    'employee_name', v_name
                )
            );
        END LOOP;
    END IF;

    RETURN row_to_json(v_emp);
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_update_profile_legacy_10arg(uuid,uuid,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_update_profile_legacy_10arg(uuid,uuid,text,text,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_update_punch_notes(p_company_id bigint, p_employee_id bigint, p_date date, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.punches p
  set "Notes" = p_notes
  where p.company_id = p_company_id
    and p.employees_id = p_employee_id
    and p."Date" = p_date;

  if not found then
    raise exception 'No punch session found for employee/date in company';
  end if;
end;
$function$;
REVOKE ALL ON FUNCTION public.employee_update_punch_notes(bigint,bigint,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_update_punch_notes(bigint,bigint,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_punch_notes(bigint,bigint,date,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_update_punch_notes(bigint,bigint,date,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_update_punch_notes(bigint,bigint,date,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_validate_session(p_company_id uuid, p_employee_id uuid, p_session_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean := false;
BEGIN
  IF p_session_token IS NOT NULL AND length(trim(p_session_token)) > 0 THEN
    v_ok := public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token);
  END IF;

  IF v_ok THEN
    UPDATE public.employee_code_sessions
    SET last_seen_at = now()
    WHERE session_token = p_session_token;
    RETURN true;
  END IF;

  -- Aggregate invalid attempts per (company, employee, day): cheap + flood-resistant,
  -- and a foundation for future rate-limit/lockout policy.
  INSERT INTO public.worker_session_audit (
    company_id, employee_id, attempt_date, invalid_attempts, last_attempt_at, last_reason
  ) VALUES (
    p_company_id, p_employee_id, current_date, 1, now(), 'invalid_or_expired'
  )
  ON CONFLICT (company_id, employee_id, attempt_date)
  DO UPDATE SET invalid_attempts = public.worker_session_audit.invalid_attempts + 1,
                last_attempt_at  = now(),
                last_reason      = 'invalid_or_expired';

  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_validate_session(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_validate_session(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_validate_session(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_validate_session(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_validate_session(uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.get_xero_connection_status(p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN (
    SELECT json_build_object(
      'connected',   (COUNT(*) > 0),
      'tenant_name', MAX(tenant_name)
    )
    FROM xero_connections
    WHERE company_id = p_company_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_xero_connection_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_xero_connection_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_xero_connection_status(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_xero_connection_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_xero_connection_status(uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.get_xero_link_for_record(p_company_id uuid, p_record_type text, p_record_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link json;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = auth.uid() AND company_id = p_company_id AND is_active = true
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT row_to_json(x) INTO v_link FROM (
    SELECT xero_contact_id, last_synced_at
    FROM xero_contact_links
    WHERE company_id = p_company_id AND record_type = p_record_type AND record_id = p_record_id
    LIMIT 1
  ) x;
  RETURN v_link;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_xero_link_for_record(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_xero_link_for_record(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_xero_link_for_record(uuid,text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_xero_link_for_record(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_xero_link_for_record(uuid,text,uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.get_xero_linked_records(p_company_id uuid, p_record_type text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = auth.uid() AND company_id = p_company_id AND is_active = true
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
    SELECT record_id FROM xero_contact_links
    WHERE company_id = p_company_id AND record_type = p_record_type;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_xero_linked_records(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_xero_linked_records(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_xero_linked_records(uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_xero_linked_records(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_xero_linked_records(uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.has_employee_mandatory_compliance(p_company_id bigint, p_employee_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select not exists (
    select 1
    from public.compliance_requirements r
    where r.company_id = p_company_id
      and r.is_mandatory = true
      and not exists (
        select 1
        from public.employee_compliance_records c
        where c.company_id = p_company_id
          and c.employee_id = p_employee_id
          and c.requirement_id = r.id
          and c.status = 'valid'
          and (c.expires_on is null or c.expires_on >= current_date)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.has_employee_mandatory_compliance(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_employee_mandatory_compliance(bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_employee_mandatory_compliance(bigint,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.has_employee_mandatory_compliance(bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_employee_mandatory_compliance(bigint,bigint) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.hr_get_client_action_items(p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'clients.view');

  RETURN coalesce((
    SELECT json_agg(row_to_json(a) ORDER BY a.priority ASC, a.created_at DESC)
    FROM (
      SELECT
        fi.id::text              AS ref_id,
        fi.client_id::text       AS client_id,
        c.name                   AS client_name,
        coalesce(c.client_code, '') AS client_code,
        CASE
          WHEN fi.status = 'overdue' OR (fi.due_date IS NOT NULL AND fi.due_date < CURRENT_DATE)
            THEN 'invoice_overdue'
          ELSE 'invoice_outstanding'
        END                      AS action_type,
        coalesce(fi.invoice_number, 'Invoice') ||
          ' · balance R' || to_char(coalesce(fi.balance_due, 0), 'FM999999990.00') AS summary,
        fi.balance_due           AS amount,
        fi.status                AS status,
        coalesce(fi.due_date::timestamptz, fi.created_at) AS created_at,
        CASE
          WHEN fi.status = 'overdue' OR (fi.due_date IS NOT NULL AND fi.due_date < CURRENT_DATE)
            THEN 1 ELSE 2
        END                      AS priority
      FROM public.finance_invoices fi
      JOIN public.clients c ON c.id = fi.client_id AND c.company_id = fi.company_id
      WHERE fi.company_id = p_company_id
        AND fi.client_id IS NOT NULL
        AND fi.status IN ('sent', 'viewed', 'partially_paid', 'overdue')
        AND coalesce(fi.balance_due, 0) > 0

      UNION ALL

      SELECT
        d.id::text               AS ref_id,
        d.client_id::text        AS client_id,
        c.name                   AS client_name,
        coalesce(c.client_code, '') AS client_code,
        'deal_attention'         AS action_type,
        coalesce(d.title, 'Project') || ' · ' || replace(coalesce(d.status, ''), '_', ' ') AS summary,
        d.offer_amount           AS amount,
        d.status                 AS status,
        coalesce(d.updated_at, d.created_at) AS created_at,
        3                        AS priority
      FROM public.client_deals d
      JOIN public.clients c ON c.id = d.client_id AND c.company_id = d.company_id
      WHERE d.company_id = p_company_id
        AND d.client_id IS NOT NULL
        AND d.status IN ('sent', 'negotiation')

      UNION ALL

      SELECT
        msg.ref_id,
        msg.client_id,
        msg.client_name,
        msg.client_code,
        msg.action_type,
        msg.summary,
        msg.amount,
        msg.status,
        msg.created_at,
        msg.priority
      FROM (
        SELECT DISTINCT ON (m.sender_client_id)
          m.id::text               AS ref_id,
          m.sender_client_id::text AS client_id,
          c.name                   AS client_name,
          coalesce(c.client_code, '') AS client_code,
          'portal_message'         AS action_type,
          left(coalesce(m.body, 'Portal message'), 80) AS summary,
          NULL::numeric            AS amount,
          'message'                AS status,
          m.created_at             AS created_at,
          2                        AS priority
        FROM public.app_messages m
        JOIN public.clients c ON c.id = m.sender_client_id AND c.company_id = m.company_id
        WHERE m.company_id = p_company_id
          AND m.sender_client_id IS NOT NULL
          AND m.created_at >= now() - INTERVAL '14 days'
        ORDER BY m.sender_client_id, m.created_at DESC
      ) msg
    ) a
  ), '[]'::json);
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_client_action_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_client_action_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_client_action_items(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.hr_get_client_action_items(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_clients_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  PERFORM public.require_user_permission(p_company_id, 'clients.view');

  RETURN jsonb_build_object(
    'total', (
      SELECT COUNT(*) FROM public.clients WHERE company_id = p_company_id
    ),
    'portal_enabled', (
      SELECT COUNT(*) FROM public.clients
      WHERE company_id = p_company_id AND coalesce(portal_enabled, false)
    ),
    'active_deals', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id
        AND status IN ('sent', 'negotiation', 'in_progress', 'won')
    ),
    'open_jobs', (
      SELECT COUNT(*) FROM public.jobs
      WHERE company_id = p_company_id
        AND status IN ('open', 'scheduled', 'in_progress')
        AND client_id IS NOT NULL
    ),
    'outstanding_balance', (
      SELECT coalesce(SUM(balance_due * coalesce(exchange_rate, 1)), 0) FROM public.finance_invoices
      WHERE company_id = p_company_id
        AND client_id IS NOT NULL
        AND status IN ('sent', 'viewed', 'partially_paid', 'overdue')
        AND coalesce(balance_due, 0) > 0
    ),
    'top_clients', coalesce((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'balance')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', c.name,
          'balance', coalesce((
            SELECT SUM(fi.balance_due * coalesce(fi.exchange_rate, 1)) FROM public.finance_invoices fi
            WHERE fi.company_id = p_company_id
              AND fi.client_id = c.id
              AND coalesce(fi.balance_due, 0) > 0
          ), 0),
          'jobs', coalesce((
            SELECT COUNT(*) FROM public.jobs j
            WHERE j.company_id = p_company_id AND j.client_id = c.id
          ), 0)
        ) AS row_obj
        FROM public.clients c
        WHERE c.company_id = p_company_id
        ORDER BY c.name
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_clients_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_clients_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_clients_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_contractor_activity(p_company_id uuid, p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM public.require_user_permission(p_company_id, 'contractors.view');
    RETURN coalesce((
        SELECT json_agg(row_to_json(a))
        FROM (
            SELECT
                ae.id::text  AS id,
                ae.screen,
                ae.action,
                ae.created_at,

                coalesce(
                    ae.meta->>'contractor_id',
                    CASE WHEN ae.meta->>'quote_id' IS NOT NULL THEN (
                        SELECT cq.contractor_id::text FROM public.contractor_quotes cq
                        WHERE cq.id = (ae.meta->>'quote_id')::uuid LIMIT 1
                    ) ELSE NULL END,
                    ''
                ) AS contractor_id,

                coalesce((
                    SELECT c2.name FROM public.contractors c2
                    WHERE c2.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (SELECT cq2.contractor_id FROM public.contractor_quotes cq2
                         WHERE cq2.id = (ae.meta->>'quote_id')::uuid LIMIT 1)
                    ) AND c2.company_id = ae.company_id LIMIT 1
                ), '') AS contractor_name,

                coalesce((
                    SELECT c3.contractor_code FROM public.contractors c3
                    WHERE c3.id = coalesce(
                        (ae.meta->>'contractor_id')::uuid,
                        (SELECT cq3.contractor_id FROM public.contractor_quotes cq3
                         WHERE cq3.id = (ae.meta->>'quote_id')::uuid LIMIT 1)
                    ) AND c3.company_id = ae.company_id LIMIT 1
                ), '') AS contractor_code,

                CASE ae.action
                    WHEN 'hr_approve_quote'                          THEN 'quotes'
                    WHEN 'hr_reject_quote'                           THEN 'quotes'
                    WHEN 'hr_request_revision'                       THEN 'quotes'
                    WHEN 'hr_start_review'                           THEN 'quotes'
                    WHEN 'contractor_quote_submitted'                THEN 'quotes'
                    WHEN 'resubmit_quote'                            THEN 'quotes'
                    WHEN 'contractor_quote_converted_to_job'         THEN 'quotes'
                    WHEN 'contractor_quote_assigned_to_existing_job' THEN 'quotes'
                    WHEN 'contractor_banking_update_submitted'       THEN 'banking'
                    WHEN 'contractor_banking_update_approved'        THEN 'banking'
                    WHEN 'contractor_banking_update_rejected'        THEN 'banking'
                    WHEN 'contractor_profile_updated'                THEN 'profile'
                    WHEN 'contractor_tax_updated'                    THEN 'profile'
                    ELSE 'other'
                END AS event_type,

                CASE ae.action
                    WHEN 'hr_approve_quote'                          THEN 'Quote Approved'
                    WHEN 'hr_reject_quote'                           THEN 'Quote Rejected'
                    WHEN 'hr_request_revision'                       THEN 'Revision Requested'
                    WHEN 'hr_start_review'                           THEN 'Under Review'
                    WHEN 'contractor_quote_submitted'                THEN 'Quote Submitted'
                    WHEN 'resubmit_quote'                            THEN 'Quote Resubmitted'
                    WHEN 'contractor_quote_converted_to_job'         THEN 'Converted to Job'
                    WHEN 'contractor_quote_assigned_to_existing_job' THEN 'Assigned to Job'
                    WHEN 'contractor_banking_update_submitted'       THEN 'Banking Submitted'
                    WHEN 'contractor_banking_update_approved'        THEN 'Banking Approved'
                    WHEN 'contractor_banking_update_rejected'        THEN 'Banking Rejected'
                    WHEN 'contractor_profile_updated'                THEN 'Profile Updated'
                    WHEN 'contractor_tax_updated'                    THEN 'Tax/VAT Updated'
                    ELSE ae.action
                END AS event_label,

                CASE ae.action
                    WHEN 'hr_approve_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' approved'
                    WHEN 'hr_reject_quote'
                        THEN left(coalesce(ae.meta->>'rejection_reason', 'Rejected'), 80)
                    WHEN 'hr_request_revision'
                        THEN left(coalesce(ae.meta->>'revision_comments', 'Revisions requested'), 80)
                    WHEN 'hr_start_review'      THEN 'Quote opened for review'
                    WHEN 'contractor_quote_submitted'
                        THEN coalesce(
                            CASE WHEN ae.meta->>'quote_number' IS NOT NULL
                                 THEN 'Quote ' || (ae.meta->>'quote_number') || ' submitted'
                            END, 'Quote submitted for review')
                    WHEN 'resubmit_quote'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') || ' resubmitted after revision'
                    WHEN 'contractor_quote_converted_to_job'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') ||
                             ' → Job ' || coalesce(ae.meta->>'job_code', '')
                    WHEN 'contractor_quote_assigned_to_existing_job'
                        THEN coalesce('Quote ' || (ae.meta->>'quote_number'), 'Quote') ||
                             ' assigned to Job ' || coalesce(ae.meta->>'job_code', '') ||
                             ' — ' || coalesce(ae.meta->>'job_title', '')
                    WHEN 'contractor_banking_update_submitted' THEN 'Banking details update awaiting approval'
                    WHEN 'contractor_banking_update_approved'  THEN 'Banking details approved'
                    WHEN 'contractor_banking_update_rejected'  THEN 'Banking update rejected'
                    WHEN 'contractor_profile_updated'          THEN 'Profile information updated'
                    WHEN 'contractor_tax_updated'              THEN 'Tax / VAT details updated'
                    ELSE ae.action
                END AS summary,

                CASE ae.screen
                    WHEN 'ContractorPortal'  THEN 'Portal'
                    WHEN 'contractor_portal' THEN 'Portal'
                    ELSE 'HR'
                END AS source

            FROM app_events ae
            WHERE ae.company_id = p_company_id
              AND ae.action IN (
                'hr_approve_quote', 'hr_reject_quote', 'hr_request_revision', 'hr_start_review',
                'contractor_quote_submitted', 'resubmit_quote',
                'contractor_quote_converted_to_job',
                'contractor_quote_assigned_to_existing_job',
                'contractor_banking_update_submitted',
                'contractor_banking_update_approved',
                'contractor_banking_update_rejected',
                'contractor_profile_updated', 'contractor_tax_updated'
              )
            ORDER BY ae.created_at DESC
            LIMIT p_limit
        ) a
    ), '[]'::json);
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_contractor_activity(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_activity(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_activity(uuid,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_activity(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_activity(uuid,integer) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.hr_get_contractors_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  PERFORM public.require_user_permission(p_company_id, 'contractors.view');

  RETURN jsonb_build_object(
    'active', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id
        AND COALESCE(is_active, true)
        AND coalesce(partner_kind, 'contractor') IN ('contractor', 'both')
    ),
    'pending_compliance', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id
        AND COALESCE(compliance_hold, false)
        AND coalesce(partner_kind, 'contractor') IN ('contractor', 'both')
    ),
    'pending_payments', (
      SELECT COUNT(*)
      FROM contractor_payouts cp
      JOIN contractors c ON c.id = cp.contractor_id
      WHERE cp.company_id = p_company_id
        AND cp.payout_status IN ('pending', 'approved')
        AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')
    ),
    'payment_summary', COALESCE((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'agreed')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', c.name,
          'agreed', COALESCE((
            SELECT SUM(jc.agreed_amount) FROM job_contractors jc
            WHERE jc.company_id = p_company_id AND jc.contractor_id = c.id
          ), 0),
          'paid', COALESCE((
            SELECT SUM(cp.total_amount) FROM contractor_payouts cp
            WHERE cp.company_id = p_company_id
              AND cp.contractor_id = c.id
              AND cp.payout_status = 'paid'
          ), 0)
        ) AS row_obj
        FROM contractors c
        WHERE c.company_id = p_company_id
          AND COALESCE(c.is_active, true)
          AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')
        ORDER BY c.name
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_contractors_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_contractors_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_contractors_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_executive_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public._reports_office(p_company_id);
  SELECT jsonb_build_object(
    'total_employees', (
      SELECT COUNT(*) FROM employees
      WHERE company_id = p_company_id AND is_active = true
    ),
    'on_site_today', (
      -- Employees with an 'in' punch today that has no subsequent 'out'
      SELECT COUNT(DISTINCT tp_in.employee_id)
      FROM time_punches tp_in
      WHERE tp_in.company_id = p_company_id
        AND tp_in.type = 'in'
        AND tp_in.date_time::date = CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM time_punches tp_out
          WHERE tp_out.employee_id  = tp_in.employee_id
            AND tp_out.company_id   = tp_in.company_id
            AND tp_out.type         = 'out'
            AND tp_out.date_time    > tp_in.date_time
        )
    ),
    'open_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id AND status IN ('open','in_progress')
    ),
    'pending_leave', (
      SELECT COUNT(*) FROM leave_requests
      WHERE company_id = p_company_id AND status = 'pending'
    ),
    'total_hours', (
      -- Pair each 'in' with its nearest subsequent 'out' for the period
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (
          (SELECT tp_out.date_time
           FROM time_punches tp_out
           WHERE tp_out.employee_id = tp_in.employee_id
             AND tp_out.company_id  = tp_in.company_id
             AND tp_out.type        = 'out'
             AND tp_out.date_time   > tp_in.date_time
           ORDER BY tp_out.date_time LIMIT 1)
          - tp_in.date_time
        )) / 3600
      ), 0)
      FROM time_punches tp_in
      WHERE tp_in.company_id = p_company_id
        AND tp_in.type = 'in'
        AND tp_in.date_time::date BETWEEN p_from AND p_to
    ),
    'total_payroll', (
      SELECT COALESCE(SUM(gross_pay), 0) FROM payment_approvals
      WHERE company_id = p_company_id
        AND period_start >= p_from AND period_end <= p_to
    ),
    'revenue_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', month_label, 'value', total))
      FROM (
        SELECT TO_CHAR(period_start, 'Mon') AS month_label,
               SUM(gross_pay) AS total
        FROM payment_approvals
        WHERE company_id = p_company_id
          AND period_start >= p_from AND period_end <= p_to
        GROUP BY TO_CHAR(period_start, 'Mon'), DATE_TRUNC('month', period_start)
        ORDER BY DATE_TRUNC('month', period_start)
      ) t
    ),
    'attendance_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', day_label, 'value', cnt))
      FROM (
        SELECT TO_CHAR(date_time::date, 'DD Mon') AS day_label,
               COUNT(DISTINCT employee_id) AS cnt
        FROM time_punches
        WHERE company_id = p_company_id
          AND type = 'in'
          AND date_time::date BETWEEN p_from AND p_to
        GROUP BY date_time::date
        ORDER BY date_time::date
        LIMIT 30
      ) t
    )
  ) INTO v;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_executive_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_executive_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_executive_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_financial_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue numeric := 0;
  v_outstanding numeric := 0;
  v_payables numeric := 0;
  v_expenses numeric := 0;
BEGIN
  PERFORM public._reports_office(p_company_id);
  SELECT COALESCE(SUM(total_amount * coalesce(exchange_rate, 1)), 0) INTO v_revenue
  FROM finance_invoices
  WHERE company_id = p_company_id
    AND issue_date BETWEEN p_from AND p_to
    AND status NOT IN ('cancelled', 'draft');

  SELECT COALESCE(SUM(balance_due * coalesce(exchange_rate, 1)), 0) INTO v_outstanding
  FROM finance_invoices
  WHERE company_id = p_company_id
    AND status IN ('sent', 'viewed', 'partially_paid', 'overdue');

  SELECT COALESCE(SUM(balance_due * coalesce(exchange_rate, 1)), 0) INTO v_payables
  FROM supplier_invoices
  WHERE company_id = p_company_id
    AND status NOT IN ('paid', 'cancelled');

  v_payables := v_payables + COALESCE((
    SELECT SUM(total_amount) FROM contractor_payouts
    WHERE company_id = p_company_id
      AND payout_status IN ('pending', 'approved')
  ), 0);

  v_expenses := COALESCE((
    SELECT SUM(total_amount * coalesce(exchange_rate, 1)) FROM supplier_invoices
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to
  ), 0)
  + COALESCE((
    SELECT SUM(total_amount) FROM contractor_payouts
    WHERE company_id = p_company_id
      AND COALESCE(payout_date, created_at::date) BETWEEN p_from AND p_to
  ), 0)
  + COALESCE((
    SELECT SUM(gross_pay) FROM payment_approvals
    WHERE company_id = p_company_id
      AND period_start BETWEEN p_from AND p_to
  ), 0);

  RETURN jsonb_build_object(
    'revenue', v_revenue,
    'outstanding', v_outstanding,
    'payables', v_payables,
    'profit', v_revenue - v_expenses,
    'revenue_vs_expenses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'value', value) ORDER BY sort_key)
      FROM (
        SELECT TO_CHAR(issue_date, 'Mon') || ' Rev' AS label,
               SUM(total_amount * coalesce(exchange_rate, 1)) AS value,
               DATE_TRUNC('month', issue_date::timestamp) AS sort_key
        FROM finance_invoices
        WHERE company_id = p_company_id
          AND issue_date BETWEEN p_from AND p_to
          AND status NOT IN ('cancelled', 'draft')
        GROUP BY 1, 3
        UNION ALL
        SELECT TO_CHAR(created_at, 'Mon') || ' Exp',
               SUM(total_amount * coalesce(exchange_rate, 1)),
               DATE_TRUNC('month', created_at)
        FROM supplier_invoices
        WHERE company_id = p_company_id
          AND created_at::date BETWEEN p_from AND p_to
        GROUP BY 1, 3
      ) t
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_financial_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_financial_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_financial_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_incidents_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  RETURN (
    SELECT jsonb_build_object(
      'open', COUNT(*) FILTER (
        WHERE COALESCE(is_closed, false) = false
          AND COALESCE(status, 'open') NOT IN ('resolved', 'closed')
      ),
      'resolved', COUNT(*) FILTER (
        WHERE COALESCE(is_closed, false) = true
          OR COALESCE(status, '') IN ('resolved', 'closed')
      ),
      'critical', COUNT(*) FILTER (WHERE lower(severity) = 'critical'),
      'recent', COALESCE((
        SELECT jsonb_agg(row_obj)
        FROM (
          SELECT jsonb_build_object(
            'description', description,
            'severity', severity,
            'status', CASE WHEN COALESCE(is_closed, false) THEN 'closed' ELSE COALESCE(status, 'open') END
          ) AS row_obj
          FROM incident_reports
          WHERE company_id = p_company_id
            AND created_at::date BETWEEN p_from AND p_to
          ORDER BY created_at DESC
          LIMIT 10
        ) r
      ), '[]'::jsonb)
    )
    FROM incident_reports
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_incidents_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_incidents_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_incidents_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_inventory_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  RETURN jsonb_build_object(
    'total_items', (SELECT COUNT(*) FROM inventory_items WHERE company_id = p_company_id),
    'low_stock', (
      SELECT COUNT(*) FROM inventory_items
      WHERE company_id = p_company_id
        AND COALESCE(quantity_on_hand, 0) <= COALESCE(reorder_level, 0)
    ),
    'stock_value', (
      SELECT COALESCE(SUM(COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0)), 0)
      FROM inventory_items WHERE company_id = p_company_id
    ),
    'on_jobs', (
      SELECT COUNT(*) FROM inventory_allocations WHERE company_id = p_company_id
    ),
    'top_items', COALESCE((
      SELECT jsonb_agg(row_obj)
      FROM (
        SELECT jsonb_build_object(
          'name', name,
          'qty', COALESCE(quantity_on_hand, 0),
          'value', COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0)
        ) AS row_obj
        FROM inventory_items
        WHERE company_id = p_company_id
        ORDER BY COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_inventory_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_inventory_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_inventory_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_operational_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  RETURN jsonb_build_object(
    'total_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id
        AND created_at::date BETWEEN p_from AND p_to
    ),
    'completed_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id
        AND status = 'completed'
        AND created_at::date BETWEEN p_from AND p_to
    ),
    'open_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id
        AND status IN ('open','in_progress')
    ),
    'total_incidents', (
      SELECT COUNT(*) FROM incident_reports
      WHERE company_id = p_company_id
        AND created_at::date BETWEEN p_from AND p_to
    ),
    'completion_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', d, 'value', cnt))
      FROM (
        SELECT closed_at::date::text AS d, COUNT(*) AS cnt
        FROM jobs
        WHERE company_id = p_company_id
          AND status = 'completed'
          AND closed_at IS NOT NULL
          AND closed_at::date BETWEEN p_from AND p_to
        GROUP BY closed_at::date
        ORDER BY closed_at::date
        LIMIT 30
      ) t
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_operational_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_operational_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_operational_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_payroll_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  RETURN (
    SELECT jsonb_build_object(
      'total_gross',        COALESCE(SUM(gross_pay), 0),
      'total_net',          COALESCE(SUM(net_pay), 0),
      'total_deductions',   COALESCE(SUM(deductions), 0),
      'total_hours',        COALESCE(SUM(COALESCE(regular_hours, 0) + COALESCE(overtime_hours, 0)), 0),
      'payslip_count',      COUNT(*),
      'approved_count',     COUNT(*) FILTER (WHERE status = 'approved'),
      'draft_count',        COUNT(*) FILTER (WHERE status = 'pending'),
      'payroll_by_employee', (
        SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'gross')::numeric DESC)
        FROM (
          SELECT jsonb_build_object(
            'employee_name', e.name || ' ' || e.surname,
            'gross',  p.gross_pay,
            'net',    p.net_pay,
            'hours',  COALESCE(p.regular_hours, 0) + COALESCE(p.overtime_hours, 0)
          ) AS row_obj
          FROM payment_approvals p
          JOIN employees e ON e.id = p.employee_id
          WHERE p.company_id  = p_company_id
            AND p.period_start >= p_from
            AND p.period_end   <= p_to
          LIMIT 10
        ) sub
      )
    )
    FROM payment_approvals
    WHERE company_id  = p_company_id
      AND period_start >= p_from
      AND period_end   <= p_to
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_payroll_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_payroll_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_payroll_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_projects_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  PERFORM public.require_user_permission(p_company_id, 'projects.view');

  RETURN jsonb_build_object(
    'total', (
      SELECT COUNT(*) FROM public.client_deals WHERE company_id = p_company_id
    ),
    'active', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id
        AND status IN ('sent', 'negotiation', 'in_progress')
    ),
    'draft', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id AND status = 'draft'
    ),
    'won', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id AND status = 'won'
    ),
    'lost', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id AND status = 'lost'
    ),
    'pipeline_value', (
      SELECT coalesce(SUM(offer_amount), 0) FROM public.client_deals
      WHERE company_id = p_company_id
        AND status IN ('sent', 'negotiation', 'in_progress')
    ),
    'outstanding_balance', (
      SELECT coalesce(SUM(balance_due * coalesce(exchange_rate, 1)), 0) FROM public.finance_invoices
      WHERE company_id = p_company_id
        AND project_id IS NOT NULL
        AND status IN ('sent', 'viewed', 'partially_paid', 'overdue')
        AND coalesce(balance_due, 0) > 0
    ),
    'top_projects', coalesce((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'offer_amount')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', d.title,
          'offer_amount', coalesce(d.offer_amount, 0),
          'status', d.status
        ) AS row_obj
        FROM public.client_deals d
        WHERE d.company_id = p_company_id
        ORDER BY d.offer_amount DESC NULLS LAST
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_projects_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_projects_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_projects_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_property_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_units int := 0;
  v_occupied int := 0;
  v_vacant int := 0;
  v_active_leases int := 0;
  v_arrears_count int := 0;
  v_arrears_total numeric := 0;
  v_active_sites int := 0;
BEGIN
  PERFORM public._reports_office(p_company_id);
  SELECT COUNT(*) INTO v_units FROM public.units WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_occupied FROM public.units WHERE company_id = p_company_id AND is_occupied = true;
  SELECT COUNT(*) INTO v_vacant FROM public.units WHERE company_id = p_company_id AND is_occupied = false;

  IF v_occupied = 0 AND v_vacant = 0 AND v_units > 0 THEN
    SELECT COUNT(*) INTO v_occupied
    FROM public.residents
    WHERE company_id = p_company_id AND move_out_date IS NULL;
    v_occupied := LEAST(v_occupied, v_units);
    v_vacant := GREATEST(v_units - v_occupied, 0);
  END IF;

  SELECT COUNT(*) INTO v_active_sites
  FROM public.sites
  WHERE company_id = p_company_id AND coalesce(is_active, true) = true;

  SELECT COUNT(*) INTO v_active_leases
  FROM public.property_leases
  WHERE company_id = p_company_id AND status = 'active';

  SELECT COUNT(*), COALESCE(SUM(balance_due), 0)
  INTO v_arrears_count, v_arrears_total
  FROM public.finance_invoices
  WHERE company_id = p_company_id
    AND coalesce(invoice_type, 'standard') = 'rent'
    AND status NOT IN ('draft', 'cancelled', 'voided', 'paid')
    AND balance_due > 0
    AND (
      status = 'overdue'
      OR (due_date IS NOT NULL AND due_date < CURRENT_DATE)
    );

  RETURN jsonb_build_object(
    'total_sites', (SELECT COUNT(*) FROM public.sites WHERE company_id = p_company_id),
    'active_sites', v_active_sites,
    'occupied_units', v_occupied,
    'vacant', v_vacant,
    'total_units', v_units,
    'active_leases', v_active_leases,
    'arrears_invoices', v_arrears_count,
    'arrears_total', v_arrears_total,
    'expiring_compliance', (
      SELECT COUNT(*) FROM public.compliance_entries
      WHERE company_id = p_company_id
        AND expiry_date IS NOT NULL
        AND expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_property_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_property_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_property_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_telemetry_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int := 0;
  v_errors int := 0;
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF to_regclass('public.app_events') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total
    FROM app_events
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to;

    SELECT COUNT(*) INTO v_errors
    FROM app_events
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to
      AND (
        lower(COALESCE(severity, '')) IN ('error', 'critical', 'fail')
        OR lower(COALESCE(event_type, '')) LIKE '%error%'
      );
  ELSE
    SELECT COUNT(*) INTO v_total
    FROM audit_events
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to;
  END IF;

  RETURN jsonb_build_object(
    'realtime_status', 'online',
    'offline_queue', 0,
    'error_rate', CASE WHEN v_total > 0 THEN ROUND((v_errors::numeric / v_total) * 100, 1) ELSE 0 END,
    'active_connections', 1,
    'event_count', v_total
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_telemetry_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_telemetry_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_telemetry_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_get_workforce_snapshot(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._reports_office(p_company_id);
  RETURN jsonb_build_object(
    'total_employees', (
      SELECT COUNT(*) FROM employees
      WHERE company_id = p_company_id AND is_active = true
    ),
    'by_access_level', (
      SELECT jsonb_object_agg(access_level, cnt)
      FROM (
        SELECT access_level, COUNT(*) AS cnt
        FROM employees
        WHERE company_id = p_company_id AND is_active = true
        GROUP BY access_level
      ) t
    ),
    'leave_days_taken', (
      SELECT COALESCE(SUM(days_requested), 0) FROM leave_requests
      WHERE company_id = p_company_id AND status = 'approved'
        AND start_date >= p_from AND end_date <= p_to
    ),
    'leave_pending', (
      SELECT COUNT(*) FROM leave_requests
      WHERE company_id = p_company_id AND status = 'pending'
    ),
    'attendance_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', d, 'value', cnt))
      FROM (
        SELECT date_time::date::text AS d, COUNT(DISTINCT employee_id) AS cnt
        FROM time_punches
        WHERE company_id = p_company_id
          AND type = 'in'
          AND date_time::date BETWEEN p_from AND p_to
        GROUP BY date_time::date
        ORDER BY date_time::date
        LIMIT 30
      ) t
    ),
    'leave_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', m, 'value', cnt))
      FROM (
        SELECT TO_CHAR(start_date, 'Mon YYYY') AS m, COUNT(*) AS cnt
        FROM leave_requests
        WHERE company_id = p_company_id AND status = 'approved'
          AND start_date >= p_from AND end_date <= p_to
        GROUP BY TO_CHAR(start_date, 'Mon YYYY'), DATE_TRUNC('month', start_date)
        ORDER BY DATE_TRUNC('month', start_date)
      ) t
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_get_workforce_snapshot(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_workforce_snapshot(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_workforce_snapshot(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_inventory_stock_movement(p_company_id uuid, p_item_id uuid, p_type text, p_quantity numeric, p_actor_employee_id uuid, p_job_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_unit_cost numeric DEFAULT NULL::numeric)
 RETURNS inventory_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item       public.inventory_items%ROWTYPE;
  v_type       text := lower(trim(coalesce(p_type, '')));
  v_delta      numeric;
  v_before     numeric;
  v_after      numeric;
  v_usage_left numeric;
  v_row        record;
  v_take       numeric;
BEGIN
  IF v_type NOT IN ('receive', 'adjust', 'return', 'allocate') THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE';
  END IF;

  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  IF NOT (p_company_id = ANY (public.user_company_ids())) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_COMPANY';
  END IF;

  -- Resolve signed delta
  IF v_type = 'receive' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    v_delta := p_quantity;
  ELSIF v_type = 'return' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    v_delta := p_quantity;
  ELSIF v_type = 'allocate' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    IF p_job_id IS NULL THEN RAISE EXCEPTION 'JOB_REQUIRED_FOR_ALLOCATE'; END IF;
    v_delta := -p_quantity;
  ELSE
    -- adjust: signed delta as provided
    v_delta := p_quantity;
  END IF;

  PERFORM set_config('kaisync.allow_stock_update', 'on', true);

  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_item_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  v_before := coalesce(v_item.quantity_on_hand, 0);

  IF v_before + v_delta < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'check_violation';
  END IF;

  -- Job-linked return: reduce inventory_usage for that job+item
  IF v_type = 'return' AND p_job_id IS NOT NULL THEN
    SELECT coalesce(sum(u.quantity_used), 0) INTO v_usage_left
    FROM public.inventory_usage u
    WHERE u.company_id = p_company_id
      AND u.job_id = p_job_id
      AND u.inventory_item_id = p_item_id;

    IF v_usage_left < p_quantity THEN
      RAISE EXCEPTION 'RETURN_EXCEEDS_JOB_USAGE';
    END IF;

    v_take := p_quantity;
    FOR v_row IN
      SELECT u.id, u.quantity_used
      FROM public.inventory_usage u
      WHERE u.company_id = p_company_id
        AND u.job_id = p_job_id
        AND u.inventory_item_id = p_item_id
      ORDER BY u.used_at DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_take <= 0;
      IF v_row.quantity_used <= v_take THEN
        v_take := v_take - v_row.quantity_used;
        DELETE FROM public.inventory_usage WHERE id = v_row.id;
      ELSE
        UPDATE public.inventory_usage
        SET quantity_used = quantity_used - v_take
        WHERE id = v_row.id;
        v_take := 0;
      END IF;
    END LOOP;
  END IF;

  -- Allocate: write usage row (same as hr_allocate_inventory_to_job)
  IF v_type = 'allocate' THEN
    INSERT INTO public.inventory_usage (
      id, company_id, job_id, inventory_item_id, quantity_used,
      employee_id, unit_cost_at_use, used_at
    ) VALUES (
      gen_random_uuid(), p_company_id, p_job_id, p_item_id, p_quantity,
      p_actor_employee_id, coalesce(p_unit_cost, v_item.unit_cost), now()
    );
  END IF;

  UPDATE public.inventory_items
  SET quantity_on_hand = quantity_on_hand + v_delta
  WHERE id = p_item_id
    AND company_id = p_company_id
  RETURNING * INTO v_item;

  v_after := coalesce(v_item.quantity_on_hand, 0);

  INSERT INTO public.inventory_stock_movements (
    company_id, item_id, movement_type, quantity,
    quantity_before, quantity_after,
    actor_employee_id, job_id, note, unit_cost
  ) VALUES (
    p_company_id, p_item_id, v_type, v_delta,
    v_before, v_after,
    p_actor_employee_id, p_job_id, nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_unit_cost, v_item.unit_cost)
  );

  RETURN v_item;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_inventory_stock_movement(uuid,uuid,text,numeric,uuid,uuid,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_inventory_stock_movement(uuid,uuid,text,numeric,uuid,uuid,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_inventory_stock_movement(uuid,uuid,text,numeric,uuid,uuid,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.hr_inventory_stock_movement(uuid,uuid,text,numeric,uuid,uuid,text,numeric) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.hr_reject_contractor_quote(p_company_id uuid, p_hr_user_id uuid, p_quote_id uuid, p_rejection_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contractor_id uuid;
  v_quote_number text;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  UPDATE public.contractor_quotes
  SET status = 'rejected',
      reviewed_by = p_hr_user_id,
      reviewed_at = now(),
      rejection_reason = p_rejection_reason,
      updated_at = now()
  WHERE id = p_quote_id
    AND company_id = p_company_id
    AND status IN ('submitted', 'under_review')
  RETURNING contractor_id, quote_number
  INTO v_contractor_id, v_quote_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found or not in a reviewable state';
  END IF;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
  VALUES (
    p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_reject_quote', 'info',
    jsonb_build_object(
      'quote_id', p_quote_id,
      'contractor_id', v_contractor_id,
      'quote_number', v_quote_number,
      'rejection_reason', p_rejection_reason
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_reject_contractor_quote(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_quote(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_quote(uuid,uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_quote(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hr_reject_contractor_quote(uuid,uuid,uuid,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.hr_upsert_compliance_pack(p_company_id uuid, p_pack_id uuid, p_party_kind text, p_name text, p_description text, p_is_default boolean, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := p_pack_id;
  it jsonb; i int := 0;
  v_dir text; v_req text;
BEGIN
  PERFORM public._compliance_require(p_company_id, p_party_kind, 'edit');
  IF trim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Pack name is required'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Items must be a list'; END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'Too many items'; END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.compliance_packs (company_id, party_kind, name, description, is_default)
    VALUES (p_company_id, p_party_kind, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_is_default, false))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.compliance_packs SET name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
      is_default = coalesce(p_is_default, false), updated_at = now()
    WHERE id = v_id AND company_id = p_company_id AND party_kind = p_party_kind;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pack not found'; END IF;
    UPDATE public.compliance_pack_items SET is_archived = true WHERE pack_id = v_id AND NOT is_archived;
  END IF;

  IF coalesce(p_is_default, false) THEN
    UPDATE public.compliance_packs SET is_default = false, updated_at = now()
    WHERE company_id = p_company_id AND party_kind = p_party_kind AND id <> v_id AND is_default;
  END IF;

  FOR it IN SELECT e FROM jsonb_array_elements(p_items) AS a(e) LOOP
    CONTINUE WHEN trim(coalesce(it->>'document_type_code', '')) = '';
    v_dir := coalesce(nullif(it->>'direction', ''), 'from_party');
    v_req := coalesce(nullif(it->>'requirement', ''), 'required');
    i := i + 1;
    INSERT INTO public.compliance_pack_items (company_id, pack_id, document_type_code, direction, requirement,
      validity_days, expiry_required, weight, notes, sort_order)
    VALUES (p_company_id, v_id, trim(it->>'document_type_code'), v_dir, v_req,
      nullif(it->>'validity_days', '')::int, coalesce((it->>'expiry_required')::boolean, false),
      greatest(coalesce(nullif(it->>'weight', '')::numeric, 1), 0.1), nullif(trim(coalesce(it->>'notes', '')), ''), i);
  END LOOP;

  PERFORM public.evaluate_party_compliance(pc.company_id, pc.party_kind, pc.party_id)
  FROM public.party_compliance pc WHERE pc.pack_id = v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.hr_upsert_compliance_pack(uuid,uuid,text,text,text,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_upsert_compliance_pack(uuid,uuid,text,text,text,boolean,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_upsert_compliance_pack(uuid,uuid,text,text,text,boolean,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.insights_money(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE pv record;
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT * INTO pv FROM _ins_prev(p_from, p_to);
  RETURN _ins_money(p_company_id, p_from, p_to, true) || jsonb_build_object(
    'previous', _ins_money(p_company_id, pv.prev_from, pv.prev_to, false) -> 'kpis',
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pv.prev_from, 'prev_to', pv.prev_to),
    'ageing', _ins_ageing(p_company_id),
    'pipeline_now', (SELECT coalesce(sum(total_amount * coalesce(exchange_rate, 1)), 0) FROM commercial_quotes WHERE company_id = p_company_id
                       AND status IN ('sent', 'viewed') AND (valid_until IS NULL OR valid_until >= current_date)));
END $function$;
REVOKE ALL ON FUNCTION public.insights_money(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insights_money(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insights_money(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.inventory_adjust_stock(p_item_id bigint, p_delta_used numeric)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_stock numeric;
begin
  -- Lock the row to prevent race conditions
  select stock_count into v_stock
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Inventory item not found (%)', p_item_id;
  end if;

  -- p_delta_used > 0 means "consume more"
  if (v_stock - p_delta_used) < 0 then
    raise exception 'Insufficient stock. Available: %, requested: %', v_stock, p_delta_used;
  end if;

  update public.inventory_items
  set stock_count = stock_count - p_delta_used
  where id = p_item_id;
end;
$function$;
REVOKE ALL ON FUNCTION public.inventory_adjust_stock(bigint,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_adjust_stock(bigint,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_adjust_stock(bigint,numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.inventory_adjust_stock(bigint,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_adjust_stock(bigint,numeric) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.inventory_items_guard_qty()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand THEN
    IF coalesce(current_setting('kaisync.allow_stock_update', true), '') <> 'on' THEN
      RAISE EXCEPTION 'STOCK_QTY_RPC_ONLY: change stock via hr_inventory_stock_movement or allocate/usage RPCs'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.inventory_items_guard_qty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_items_guard_qty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_items_guard_qty() TO anon;
GRANT EXECUTE ON FUNCTION public.inventory_items_guard_qty() TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_items_guard_qty() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.is_hr_for_company(target_company_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.current_hr_company_id() = target_company_id
$function$;
REVOKE ALL ON FUNCTION public.is_hr_for_company(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_hr_for_company(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_hr_for_company(bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.is_hr_for_company(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_hr_for_company(bigint) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.kaiflow_sync_company_subscription(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp int; v_ct int; v_prop int; v_clients int; v_farms int;
  v_saas public.saas_company_subscriptions%ROWTYPE;
  v_plan public.saas_plans%ROWTYPE;
  v_override numeric; v_home boolean := false; v_status text := 'active';
  q jsonb; qm jsonb; v_monthly numeric; v_standard numeric; v_lines jsonb; v_cycle text;
BEGIN
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'company_id required'; END IF;
  SELECT coalesce(c.is_platform_home, false) INTO v_home FROM public.companies c WHERE c.id = p_company_id;
  SELECT cs.price_override INTO v_override FROM public.company_subscriptions cs WHERE cs.company_id = p_company_id;
  SELECT c.employee_count, c.contractor_count, c.property_count, c.client_portal_count, c.farm_count
    INTO v_emp, v_ct, v_prop, v_clients, v_farms FROM public.kaiflow_company_billing_counts(p_company_id) c;
  SELECT s.* INTO v_saas FROM public.saas_company_subscriptions s WHERE s.company_id = p_company_id;
  IF FOUND THEN v_status := coalesce(v_saas.subscription_status, v_saas.billing_status, 'active'); END IF;
  v_plan := public.billing_effective_plan(p_company_id);
  v_cycle := coalesce(v_saas.billing_cycle, 'monthly');
  IF v_home THEN v_override := NULL; END IF;

  qm := public.billing_price(v_plan, 'monthly', v_emp, v_ct, v_clients, v_prop, v_farms, NULL);
  v_standard := (qm ->> 'monthly_subtotal')::numeric;
  q := public.billing_price(v_plan, v_cycle, v_emp, v_ct, v_clients, v_prop, v_farms, v_override);
  v_monthly := (q ->> 'monthly_subtotal')::numeric;
  v_lines := q -> 'lines';
  IF v_home THEN
    v_monthly := 0;
    v_lines := jsonb_build_array(jsonb_build_object('description', 'This company is KaiSync and is not billed.', 'amount', 0));
    q := q || jsonb_build_object('subtotal', 0, 'discount', 0, 'vat', 0, 'total', 0);
  END IF;

  INSERT INTO public.company_subscriptions (
    company_id, saas_subscription_id, plan_name, base_price,
    included_employees, additional_employee_price, employee_count,
    included_contractors, additional_contractor_price, contractor_count,
    included_properties, additional_property_price, property_count,
    included_client_portals, additional_client_portal_price, client_portal_count,
    farm_count, per_farm_price, monthly_charge, standard_monthly_charge, status, start_date, renewal_date, updated_at
  ) VALUES (
    p_company_id, v_saas.id, v_plan.name, v_plan.monthly_price,
    v_plan.included_employees, v_plan.per_employee_price, v_emp,
    v_plan.included_contractors, v_plan.per_contractor_price, v_ct,
    v_plan.included_properties, v_plan.per_property_price, v_prop,
    v_plan.included_client_portals, v_plan.per_client_portal_price, v_clients,
    v_farms, v_plan.per_farm_price, v_monthly, v_standard, coalesce(v_saas.subscription_status, 'active'),
    coalesce(v_saas.created_at::date, CURRENT_DATE), v_saas.renewal_date, now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    saas_subscription_id = EXCLUDED.saas_subscription_id, plan_name = EXCLUDED.plan_name, base_price = EXCLUDED.base_price,
    included_employees = EXCLUDED.included_employees, additional_employee_price = EXCLUDED.additional_employee_price,
    employee_count = EXCLUDED.employee_count, included_contractors = EXCLUDED.included_contractors,
    additional_contractor_price = EXCLUDED.additional_contractor_price, contractor_count = EXCLUDED.contractor_count,
    included_properties = EXCLUDED.included_properties, additional_property_price = EXCLUDED.additional_property_price,
    property_count = EXCLUDED.property_count, included_client_portals = EXCLUDED.included_client_portals,
    additional_client_portal_price = EXCLUDED.additional_client_portal_price, client_portal_count = EXCLUDED.client_portal_count,
    farm_count = EXCLUDED.farm_count, per_farm_price = EXCLUDED.per_farm_price,
    monthly_charge = EXCLUDED.monthly_charge, standard_monthly_charge = EXCLUDED.standard_monthly_charge,
    price_override = CASE WHEN v_home THEN NULL ELSE company_subscriptions.price_override END,
    price_override_note = CASE WHEN v_home THEN NULL ELSE company_subscriptions.price_override_note END,
    status = EXCLUDED.status, renewal_date = EXCLUDED.renewal_date, updated_at = now();

  IF v_saas.id IS NOT NULL THEN
    UPDATE public.saas_company_subscriptions SET current_employee_count = v_emp, employee_limit = coalesce(v_plan.max_employees, employee_limit),
      amount_due = (q ->> 'total')::numeric, updated_at = now()
     WHERE company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id, 'plan_name', v_plan.name, 'plan_code', v_plan.code, 'plan_chosen', v_saas.chosen_plan_id IS NOT NULL OR v_saas.subscription_status <> 'trialing',
    'max_employees', v_plan.max_employees, 'billing_cycle', v_cycle,
    'pending_plan_code', (SELECT code FROM public.saas_plans WHERE id = v_saas.pending_plan_id), 'pending_cycle', v_saas.pending_cycle,
    'annual_period_start', v_saas.annual_period_start, 'annual_period_end', v_saas.annual_period_end,
    'next_billing_date', v_saas.next_billing_date, 'trial_ends_at', v_saas.trial_ends_at,
    'status', v_status, 'renewal_date', v_saas.renewal_date, 'currency', 'ZAR',
    'base_price', CASE WHEN v_home THEN 0 ELSE v_plan.monthly_price END,
    'monthly_charge', v_monthly, 'standard_monthly_charge', v_standard, 'price_override', v_override, 'billable', NOT v_home,
    'cycle_subtotal', (q ->> 'subtotal')::numeric, 'discount', (q ->> 'discount')::numeric, 'discount_label', q ->> 'discount_label',
    'vat', (q ->> 'vat')::numeric, 'cycle_total', (q ->> 'total')::numeric,
    'employees', jsonb_build_object('count', v_emp, 'included', v_plan.included_employees, 'limit', v_plan.max_employees,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'employees')::int END, 'unit_price', v_plan.per_employee_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'employees')::int * v_plan.per_employee_price END),
    'contractors', jsonb_build_object('count', v_ct, 'included', v_plan.included_contractors,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'contractors')::int END, 'unit_price', v_plan.per_contractor_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'contractors')::int * v_plan.per_contractor_price END, 'meter', 'portal_enabled_active'),
    'client_portals', jsonb_build_object('count', v_clients, 'included', v_plan.included_client_portals,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'client_portals')::int END, 'unit_price', v_plan.per_client_portal_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'client_portals')::int * v_plan.per_client_portal_price END, 'meter', 'portal_enabled'),
    'properties', jsonb_build_object('count', v_prop, 'included', v_plan.included_properties,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'properties')::int END, 'unit_price', v_plan.per_property_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'properties')::int * v_plan.per_property_price END, 'meter', 'active_sites'),
    'farms', jsonb_build_object('count', v_farms, 'included', 0, 'overage', CASE WHEN v_home THEN 0 ELSE v_farms END,
      'unit_price', v_plan.per_farm_price, 'overage_charge', CASE WHEN v_home THEN 0 ELSE v_farms * v_plan.per_farm_price END, 'meter', 'active_farms'),
    'lines', v_lines);
END $function$;
REVOKE ALL ON FUNCTION public.kaiflow_sync_company_subscription(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kaiflow_sync_company_subscription(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.linked_link_history(p_company_id uuid, p_link_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link public.company_links%ROWTYPE;
BEGIN
  PERFORM public._company_link_office(p_company_id);
  SELECT * INTO v_link FROM public.company_links WHERE id = p_link_id AND p_company_id IN (provider_company_id, customer_company_id);
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  RETURN coalesce((SELECT json_agg(x ORDER BY x.at DESC) FROM (
    SELECT * FROM (
      (SELECT DISTINCT ON (a.action, a.created_at) a.action, a.created_at AS at,
              (SELECT c.name FROM public.companies c WHERE c.id = (a.meta->>'actor_company_id')::uuid) AS who, NULL::jsonb AS details
       FROM public.audit_events a
       WHERE a.target_type = 'company_link' AND a.target_id = p_link_id::text AND a.company_id = p_company_id)
      UNION ALL
      (SELECT e.action, e.created_at, e.meta->>'by',
              jsonb_strip_nulls(jsonb_build_object('job_code', e.meta->>'job_code', 'amount', e.meta->'amount'))
       FROM public.app_events e
       WHERE e.company_id = v_link.provider_company_id AND e.screen = 'LinkedCompany' AND e.meta->>'link_id' = p_link_id::text)
      UNION ALL
      (SELECT DISTINCT ON (n.dedupe_key_base) n.type, n.created_at, n.who, jsonb_build_object('title', n.title)
       FROM (SELECT nn.type, nn.created_at, nn.data->>'by' AS who, nn.title,
                    regexp_replace(nn.dedupe_key, ':[^:]+$', '') AS dedupe_key_base
             FROM public.app_notifications nn
             WHERE nn.company_id = v_link.customer_company_id AND nn.type LIKE 'linked\_from\_provider\_%'
               AND nn.data->>'link_id' = p_link_id::text) n)
    ) u ORDER BY u.at DESC LIMIT 500
  ) x), '[]'::json);
END $function$;
REVOKE ALL ON FUNCTION public.linked_link_history(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.linked_link_history(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.linked_link_history(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.media_read_granted(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.media_read_grants r
           WHERE r.storage_path = p_name AND r.expires_at > now())
      OR EXISTS (
           SELECT 1 FROM public.media_upload_grants g
           WHERE g.storage_path = p_name AND g.expires_at > now());
$function$;
REVOKE ALL ON FUNCTION public.media_read_granted(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.media_read_granted(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.media_read_granted(text) TO anon;
GRANT EXECUTE ON FUNCTION public.media_read_granted(text) TO service_role;

CREATE OR REPLACE FUNCTION public.money_overview(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_vat_registered boolean;
  r jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 800 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT coalesce(is_vat_registered, false) INTO v_vat_registered FROM public.companies WHERE id = p_company_id;

  WITH inv AS (
    SELECT coalesce(sum(subtotal * coalesce(exchange_rate, 1)), 0) sub, coalesce(sum(vat_amount * coalesce(exchange_rate, 1)), 0) vat, count(*) n
    FROM public.finance_invoices
    WHERE company_id = p_company_id AND status NOT IN ('draft', 'cancelled', 'voided')
      AND issue_date BETWEEN p_from AND p_to),
  cn AS (
    SELECT coalesce(sum(subtotal * coalesce(exchange_rate, 1)), 0) sub, coalesce(sum(vat_amount * coalesce(exchange_rate, 1)), 0) vat, coalesce(sum(refund_amount * coalesce(exchange_rate, 1)), 0) refunded, count(*) n
    FROM public.credit_notes
    WHERE company_id = p_company_id AND coalesce(status, '') NOT IN ('draft', 'void', 'voided', 'cancelled')
      AND issue_date BETWEEN p_from AND p_to)
  SELECT r || jsonb_build_object('income', jsonb_build_object(
      'invoiced', round(inv.sub, 2), 'invoice_count', inv.n, 'invoiced_vat', round(inv.vat, 2),
      'credit_notes', round(cn.sub, 2), 'credit_note_count', cn.n, 'credit_note_vat', round(cn.vat, 2),
      'refunded', round(cn.refunded, 2), 'total', round(inv.sub - cn.sub, 2)))
  INTO r FROM inv, cn;

  WITH slip AS (
    SELECT p.status, p.paid_at, p.period_end, e.department,
           coalesce(p.gross_pay, 0)::numeric gross, coalesce(p.net_pay, 0)::numeric net, coalesce(p.overtime_pay, 0)::numeric ot,
           coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
             WHERE upper(trim(x ->> 'label')) = 'PAYE'), (p.payslip_lines ->> 'paye')::numeric, 0) paye,
           coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
             WHERE upper(trim(x ->> 'label')) = 'UIF'), (p.payslip_lines ->> 'uif')::numeric, 0) uif,
           coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
             WHERE upper(replace(trim(x ->> 'label'), ' ', '')) IN ('MEIBC', 'MIEBC', 'MIBCO')), 0) meibc,
           p.employee_id
    FROM public.payment_approvals p JOIN public.employees e ON e.id = p.employee_id
    WHERE p.company_id = p_company_id AND p.status <> 'rejected' AND p.period_end BETWEEN p_from AND p_to
      AND (coalesce(p.gross_pay, 0) <> 0 OR coalesce(p.net_pay, 0) <> 0)),
  tot AS (
    SELECT coalesce(sum(gross), 0) gross, coalesce(sum(net), 0) net, coalesce(sum(ot), 0) ot, coalesce(sum(paye), 0) paye,
           coalesce(sum(uif), 0) uif, coalesce(sum(meibc), 0) meibc, count(DISTINCT employee_id) people,
           coalesce(sum(net) FILTER (WHERE status = 'paid'), 0) net_paid, coalesce(sum(net) FILTER (WHERE status <> 'paid'), 0) net_unpaid
    FROM slip),
  dep AS (
    SELECT coalesce(nullif(trim(department), ''), 'No department') name, count(DISTINCT employee_id) people,
           round(sum(gross), 2) gross, round(sum(ot), 2) overtime, round(sum(net), 2) net
    FROM slip GROUP BY 1)
  SELECT r || jsonb_build_object('payroll', jsonb_build_object(
      'gross', round(tot.gross, 2), 'net', round(tot.net, 2), 'overtime', round(tot.ot, 2), 'paye', round(tot.paye, 2),
      'uif', round(tot.uif, 2), 'meibc', round(tot.meibc, 2), 'people', tot.people,
      'net_paid', round(tot.net_paid, 2), 'net_unpaid', round(tot.net_unpaid, 2),
      'departments', coalesce((SELECT jsonb_agg(to_jsonb(dep) ORDER BY dep.gross DESC) FROM dep), '[]'::jsonb)))
  INTO r FROM tot;

  WITH po AS (
    SELECT p.*, coalesce(c.name, 'Unknown contractor') cname
    FROM public.contractor_payouts p LEFT JOIN public.contractors c ON c.id = p.contractor_id
    WHERE p.company_id = p_company_id AND coalesce(p.approval_status, '') <> 'rejected' AND coalesce(p.payout_status, '') NOT IN ('cancelled', 'rejected')),
  per AS (
    SELECT contractor_id, min(cname) name, count(DISTINCT job_id) jobs,
           round(coalesce(sum(total_amount - coalesce(retention_amount, 0)) FILTER (WHERE payout_status = 'paid' AND coalesce(paid_at::date, payout_date) BETWEEN p_from AND p_to), 0), 2) paid,
           round(coalesce(sum(total_amount - coalesce(retention_amount, 0)) FILTER (WHERE approval_status = 'approved' AND payout_status <> 'paid'), 0), 2) approved_unpaid,
           round(coalesce(sum(total_amount) FILTER (WHERE coalesce(approval_status, 'pending') = 'pending'), 0), 2) waiting,
           round(coalesce(sum(retention_amount), 0), 2) retention
    FROM po GROUP BY contractor_id)
  SELECT r || jsonb_build_object('contractors', jsonb_build_object(
      'cost', round(coalesce((SELECT sum(subtotal) FROM po WHERE coalesce(payout_date, created_at::date) BETWEEN p_from AND p_to), 0), 2),
      'cost_vat', round(coalesce((SELECT sum(vat_amount) FROM po WHERE coalesce(payout_date, created_at::date) BETWEEN p_from AND p_to), 0), 2),
      'paid', coalesce((SELECT sum(paid) FROM per), 0),
      'approved_unpaid', coalesce((SELECT sum(approved_unpaid) FROM per), 0),
      'waiting', coalesce((SELECT sum(waiting) FROM per), 0),
      'waiting_count', (SELECT count(*) FROM po WHERE coalesce(approval_status, 'pending') = 'pending'),
      'retention', coalesce((SELECT sum(retention) FROM per), 0),
      'accounts', coalesce((SELECT jsonb_agg(to_jsonb(per) ORDER BY per.approved_unpaid + per.waiting DESC, per.paid DESC) FROM per), '[]'::jsonb)))
  INTO r;

  WITH b AS (
    SELECT s.supplier_id, s.status, s.approval_status, s.due_date, s.paid_at, s.created_at, s.balance_due * coalesce(s.exchange_rate, 1) balance_due, s.amount_paid * coalesce(s.exchange_rate, 1) amount_paid, s.subtotal * coalesce(s.exchange_rate, 1) subtotal, s.vat_amount * coalesce(s.exchange_rate, 1) vat_amount, coalesce(c.name, 'Unknown supplier') sname
    FROM public.supplier_invoices s LEFT JOIN public.contractors c ON c.id = s.supplier_id
    WHERE s.company_id = p_company_id AND coalesce(s.status, '') NOT IN ('cancelled', 'void', 'voided', 'rejected')),
  per AS (
    SELECT supplier_id, min(sname) name,
           round(coalesce(sum(balance_due) FILTER (WHERE balance_due > 0), 0), 2) owe,
           round(coalesce(sum(balance_due) FILTER (WHERE balance_due > 0 AND (due_date IS NULL OR due_date >= v_today)), 0), 2) not_due,
           round(coalesce(sum(balance_due) FILTER (WHERE balance_due > 0 AND due_date < v_today), 0), 2) overdue,
           count(*) FILTER (WHERE balance_due > 0) open_bills,
           round(coalesce(sum(amount_paid) FILTER (WHERE paid_at::date BETWEEN p_from AND p_to), 0), 2) paid,
           max(paid_at)::date last_paid
    FROM b GROUP BY supplier_id)
  SELECT r || jsonb_build_object('suppliers', jsonb_build_object(
      'cost', round(coalesce((SELECT sum(subtotal) FROM b WHERE created_at::date BETWEEN p_from AND p_to), 0), 2),
      'cost_vat', round(coalesce((SELECT sum(vat_amount) FROM b WHERE created_at::date BETWEEN p_from AND p_to), 0), 2),
      'owe', coalesce((SELECT sum(owe) FROM per), 0),
      'overdue', coalesce((SELECT sum(overdue) FROM per), 0),
      'paid', coalesce((SELECT sum(paid) FROM per), 0),
      'to_approve', (SELECT count(*) FROM b WHERE coalesce(approval_status, 'pending') = 'pending'),
      'due_soon', (SELECT count(*) FROM b WHERE balance_due > 0 AND due_date <= v_today + 7),
      'accounts', coalesce((SELECT jsonb_agg(to_jsonb(per) ORDER BY per.owe DESC, per.paid DESC) FROM per), '[]'::jsonb)))
  INTO r;

  WITH pay AS (SELECT * FROM public._expense_payments(p_company_id, p_from, p_to)),
  nxt AS (
    SELECT e.id, (SELECT min(x.pay_date) FROM public._expense_payments(p_company_id, v_today, v_today + 400) x WHERE x.expense_id = e.id) next_date
    FROM public.company_expenses e WHERE e.company_id = p_company_id AND e.archived_at IS NULL)
  SELECT r || jsonb_build_object('expenses', jsonb_build_object(
      'paid', round(coalesce((SELECT sum(amount) FROM pay), 0), 2),
      'cost', round(coalesce((SELECT sum(amount - vat_amount) FROM pay), 0), 2),
      'vat', round(coalesce((SELECT sum(vat_amount) FROM pay), 0), 2),
      'regular_cost', round(coalesce((SELECT sum(p.amount - p.vat_amount) FROM pay p JOIN public.company_expenses e ON e.id = p.expense_id WHERE e.frequency <> 'once'), 0), 2),
      'once_off_cost', round(coalesce((SELECT sum(p.amount - p.vat_amount) FROM pay p JOIN public.company_expenses e ON e.id = p.expense_id WHERE e.frequency = 'once'), 0), 2),
      'monthly_equivalent', round(coalesce((SELECT sum(CASE frequency WHEN 'weekly' THEN amount * 52 / 12.0 WHEN 'monthly' THEN amount
              WHEN 'quarterly' THEN amount / 3.0 WHEN 'yearly' THEN amount / 12.0 ELSE 0 END)
            FROM public.company_expenses WHERE company_id = p_company_id AND archived_at IS NULL AND (end_date IS NULL OR end_date >= v_today)), 0), 2),
      'due_soon', (SELECT count(*) FROM nxt WHERE next_date <= v_today + 14),
      'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'category', e.category, 'amount', e.amount,
              'vat_amount', e.vat_amount, 'frequency', e.frequency, 'start_date', e.start_date, 'end_date', e.end_date,
              'payment_method', e.payment_method, 'notes', e.notes, 'next_date', nxt.next_date,
              'in_period', (SELECT coalesce(sum(amount), 0) FROM pay WHERE pay.expense_id = e.id))
            ORDER BY (nxt.next_date IS NULL), nxt.next_date, e.name)
            FROM public.company_expenses e JOIN nxt ON nxt.id = e.id), '[]'::jsonb)))
  INTO r;

  WITH open AS (
    SELECT i.client_id, i.balance_due * coalesce(i.exchange_rate, 1) bal, (v_today - coalesce(i.due_date, i.issue_date)) late
    FROM public.finance_invoices i
    WHERE i.company_id = p_company_id AND i.status NOT IN ('draft', 'cancelled', 'voided', 'paid') AND i.balance_due > 0),
  pays AS (
    SELECT i.client_id, t.transaction_date, t.total_amount * coalesce(i.exchange_rate, 1) total_amount
    FROM public.finance_transactions t JOIN public.finance_invoices i ON i.id = t.source_id
    WHERE t.company_id = p_company_id AND t.source_table = 'finance_invoices' AND t.direction IN ('incoming', 'in')),
  per AS (
    SELECT o.client_id, round(sum(bal), 2) owed,
           round(coalesce(sum(bal) FILTER (WHERE late <= 0), 0), 2) not_due,
           round(coalesce(sum(bal) FILTER (WHERE late BETWEEN 1 AND 30), 0), 2) d30,
           round(coalesce(sum(bal) FILTER (WHERE late BETWEEN 31 AND 60), 0), 2) d60,
           round(coalesce(sum(bal) FILTER (WHERE late > 60), 0), 2) d90,
           count(*) invoices, max(late) oldest
    FROM open o GROUP BY o.client_id),
  days AS (
    SELECT avg(pd - i.issue_date) d FROM public.finance_invoices i
    JOIN LATERAL (SELECT max(t.transaction_date) pd FROM public.finance_transactions t WHERE t.source_id = i.id AND t.company_id = p_company_id) x ON true
    WHERE i.company_id = p_company_id AND i.status = 'paid' AND x.pd IS NOT NULL AND i.issue_date >= v_today - 365)
  SELECT r || jsonb_build_object('clients', jsonb_build_object(
      'owed', coalesce((SELECT sum(owed) FROM per), 0),
      'not_due', coalesce((SELECT sum(not_due) FROM per), 0),
      'd30', coalesce((SELECT sum(d30) FROM per), 0),
      'd60', coalesce((SELECT sum(d60) FROM per), 0),
      'd90', coalesce((SELECT sum(d90) FROM per), 0),
      'open_invoices', coalesce((SELECT sum(invoices) FROM per), 0),
      'late_60', (SELECT count(*) FROM open WHERE late > 60),
      'avg_days_to_pay', (SELECT round(d) FROM days),
      'received', round(coalesce((SELECT sum(total_amount) FROM pays WHERE transaction_date BETWEEN p_from AND p_to), 0), 2),
      'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('client_id', per.client_id, 'name', coalesce(c.name, 'No client'),
              'owed', per.owed, 'not_due', per.not_due, 'd30', per.d30, 'd60', per.d60, 'd90', per.d90, 'invoices', per.invoices,
              'oldest_days', per.oldest, 'last_paid', (SELECT max(transaction_date) FROM pays WHERE pays.client_id = per.client_id))
            ORDER BY per.owed DESC)
            FROM per LEFT JOIN public.clients c ON c.id = per.client_id), '[]'::jsonb)))
  INTO r;

  WITH q AS (
    SELECT id, status, subtotal * coalesce(exchange_rate, 1) subtotal FROM public.commercial_quotes
    WHERE company_id = p_company_id AND status <> 'draft' AND coalesce(sent_at, created_at)::date BETWEEN p_from AND p_to),
  qi AS (
    SELECT DISTINCT ON (i.quote_id) i.quote_id, i.subtotal * coalesce(i.exchange_rate, 1) subtotal, i.status
    FROM public.finance_invoices i JOIN q ON q.id = i.quote_id
    WHERE i.status NOT IN ('draft', 'cancelled', 'voided') ORDER BY i.quote_id, i.created_at)
  SELECT r || jsonb_build_object('quotes', jsonb_build_object(
      'quoted', round(coalesce((SELECT sum(subtotal) FROM q), 0), 2), 'quoted_count', (SELECT count(*) FROM q),
      'accepted', round(coalesce((SELECT sum(subtotal) FROM q WHERE status = 'accepted'), 0), 2),
      'accepted_count', (SELECT count(*) FROM q WHERE status = 'accepted'),
      'invoiced', round(coalesce((SELECT sum(subtotal) FROM qi), 0), 2), 'invoiced_count', (SELECT count(*) FROM qi),
      'paid', round(coalesce((SELECT sum(subtotal) FROM qi WHERE status = 'paid'), 0), 2), 'paid_count', (SELECT count(*) FROM qi WHERE status = 'paid')))
  INTO r;

  r := r || jsonb_build_object(
    'cash_out', jsonb_build_object(
      'payroll', round(coalesce((SELECT sum(net_pay)::numeric FROM public.payment_approvals WHERE company_id = p_company_id AND status = 'paid'
                         AND coalesce(paid_at::date, period_end) BETWEEN p_from AND p_to), 0), 2),
      'contractors', (r -> 'contractors' ->> 'paid')::numeric,
      'suppliers', (r -> 'suppliers' ->> 'paid')::numeric,
      'expenses', (r -> 'expenses' ->> 'paid')::numeric,
      'refunds', (r -> 'income' ->> 'refunded')::numeric),
    'vat_registered', v_vat_registered,
    'vat', jsonb_build_object(
      'output', round((r -> 'income' ->> 'invoiced_vat')::numeric - (r -> 'income' ->> 'credit_note_vat')::numeric, 2),
      'input', round((r -> 'suppliers' ->> 'cost_vat')::numeric + (r -> 'contractors' ->> 'cost_vat')::numeric + (r -> 'expenses' ->> 'vat')::numeric, 2)),
    'series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'in', round(coalesce((SELECT sum(t.total_amount * coalesce((SELECT fi.exchange_rate FROM public.finance_invoices fi WHERE fi.id = t.source_id AND t.source_table = 'finance_invoices'), 1)) FROM public.finance_transactions t WHERE t.company_id = p_company_id
                 AND t.direction IN ('incoming', 'in') AND date_trunc('month', t.transaction_date) = m), 0), 2),
        'out', round(
           coalesce((SELECT sum(net_pay)::numeric FROM public.payment_approvals WHERE company_id = p_company_id AND status = 'paid'
                     AND date_trunc('month', coalesce(paid_at::date, period_end)) = m), 0)
         + coalesce((SELECT sum(total_amount - coalesce(retention_amount, 0)) FROM public.contractor_payouts WHERE company_id = p_company_id
                     AND payout_status = 'paid' AND date_trunc('month', coalesce(paid_at::date, payout_date)) = m), 0)
         + coalesce((SELECT sum(amount_paid * coalesce(exchange_rate, 1)) FROM public.supplier_invoices WHERE company_id = p_company_id
                     AND date_trunc('month', paid_at) = m), 0)
         + coalesce((SELECT sum(amount) FROM public._expense_payments(p_company_id, m::date, (m + interval '1 month - 1 day')::date)), 0), 2)) ORDER BY m)
      FROM generate_series(date_trunc('month', p_to::timestamp) - interval '5 months', date_trunc('month', p_to::timestamp), interval '1 month') m), '[]'::jsonb));

  r := r || jsonb_build_object('cash_out_total', round(
    (r -> 'cash_out' ->> 'payroll')::numeric + (r -> 'cash_out' ->> 'contractors')::numeric + (r -> 'cash_out' ->> 'suppliers')::numeric
    + (r -> 'cash_out' ->> 'expenses')::numeric + (r -> 'cash_out' ->> 'refunds')::numeric, 2),
    'from', p_from, 'to', p_to);
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.money_overview(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_overview(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.money_overview(uuid,date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.paperless_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.paperless_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paperless_touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.paperless_touch_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.paperless_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.paperless_touch_updated_at() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.process_overdue_invoices(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule        public.commercial_automation_rules%ROWTYPE;
  v_invoice     RECORD;
  v_count       integer := 0;
  v_today       text := to_char(CURRENT_DATE, 'YYYY-MM-DD');
  v_dedupe_key  text;
  v_body        text;
  v_days_overdue integer;
BEGIN
  SELECT * INTO v_rule
  FROM public.commercial_automation_rules
  WHERE company_id = p_company_id
    AND trigger_type = 'invoice_overdue'
    AND action_type = 'send_notification'
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no active invoice_overdue rule');
  END IF;

  FOR v_invoice IN
    SELECT
      fi.id, fi.invoice_number, fi.balance_due, fi.due_date,
      c.name AS client_name,
      CURRENT_DATE - fi.due_date AS days_overdue_int
    FROM public.finance_invoices fi
    LEFT JOIN public.clients c ON c.id = fi.client_id
    WHERE fi.company_id = p_company_id
      AND fi.status IN ('sent', 'partial')
      AND fi.balance_due > 0
      AND fi.due_date < CURRENT_DATE
  LOOP
    v_dedupe_key := 'invoice_overdue_' || v_invoice.id::text || '_' || v_today;
    v_days_overdue := v_invoice.days_overdue_int;

    v_body := (v_rule.action_config->>'body_template');
    v_body := REPLACE(v_body, '{invoice_number}', COALESCE(v_invoice.invoice_number, 'N/A'));
    v_body := REPLACE(v_body, '{client_name}', COALESCE(v_invoice.client_name, 'Unknown'));
    v_body := REPLACE(v_body, '{days_overdue}', v_days_overdue::text);
    v_body := REPLACE(v_body, '{balance_due}', 'R ' || ROUND(v_invoice.balance_due, 2)::text);

    INSERT INTO public.app_notifications (
      company_id, audience, type, title, body,
      ref_type, ref_id, dedupe_key, data
    )
    VALUES (
      p_company_id, 'owner', 'invoice_overdue',
      v_rule.action_config->>'title', v_body,
      'finance_invoice', v_invoice.id::text, v_dedupe_key,
      jsonb_build_object(
        'invoice_id',      v_invoice.id,
        'invoice_number',  v_invoice.invoice_number,
        'balance_due',     v_invoice.balance_due,
        'days_overdue',    v_days_overdue
      )
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    INSERT INTO public.automation_rule_executions
      (company_id, rule_id, trigger_type, trigger_entity_id, trigger_entity_type, action_type, status, result)
    VALUES
      (p_company_id, v_rule.id, 'invoice_overdue', v_invoice.id::text, 'invoice',
       'send_notification', 'success',
       jsonb_build_object('invoice_number', v_invoice.invoice_number, 'days_overdue', v_days_overdue));

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.commercial_automation_rules
  SET run_count = run_count + 1, last_run_at = now()
  WHERE id = v_rule.id;

  RETURN jsonb_build_object('processed', v_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.process_overdue_invoices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_overdue_invoices(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_overdue_invoices(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.process_overdue_invoices(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_overdue_invoices(uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.resume_same_day_shift(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text;
  v_today date;
  v_latest public.time_punches;
  v_previous public.time_punches;
  v_first public.time_punches;
  v_kept public.time_punches;
  v_allowed boolean := false;
BEGIN
  IF p_company_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id AND e.company_id = p_company_id AND e.user_id = auth.uid()
  ) THEN
    v_allowed := true;
  ELSIF p_session_token IS NOT NULL
    AND public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token)
  THEN
    v_allowed := true;
  ELSIF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = auth.uid() AND e.company_id = p_company_id AND e.is_active = true
      AND lower(e.access_level) IN ('owner', 'admin', 'hr', 'hr_admin', 'manager')
  ) THEN
    v_allowed := true;
  ELSIF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hr_users h
    WHERE h.user_id = auth.uid() AND h.company_id = p_company_id
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(nullif(trim(timezone), ''), 'Africa/Johannesburg')
  INTO v_tz
  FROM public.company_settings
  WHERE company_id = p_company_id
  LIMIT 1;
  IF v_tz IS NULL THEN
    v_tz := 'Africa/Johannesburg';
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT * INTO v_latest
  FROM public.time_punches
  WHERE company_id = p_company_id AND employee_id = p_employee_id
  ORDER BY date_time DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No punch to continue' USING ERRCODE = 'P0002';
  END IF;

  IF (v_latest.date_time AT TIME ZONE v_tz)::date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'A shift can only be continued on the same day' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_previous
  FROM public.time_punches
  WHERE company_id = p_company_id AND employee_id = p_employee_id AND id <> v_latest.id
  ORDER BY date_time DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
  END IF;

  IF lower(trim(v_latest.type)) = 'out'
     AND lower(trim(v_previous.type)) = 'in'
     AND (v_previous.date_time AT TIME ZONE v_tz)::date = v_today
  THEN
    DELETE FROM public.time_punches WHERE id = v_latest.id;
    v_kept := v_previous;
  ELSIF lower(trim(v_latest.type)) = 'in'
        AND lower(trim(v_previous.type)) = 'out'
        AND (v_previous.date_time AT TIME ZONE v_tz)::date = v_today
  THEN
    SELECT * INTO v_first
    FROM public.time_punches
    WHERE company_id = p_company_id AND employee_id = p_employee_id
      AND id NOT IN (v_latest.id, v_previous.id)
    ORDER BY date_time DESC, created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
    END IF;

    IF lower(trim(v_first.type)) IS DISTINCT FROM 'in'
       OR (v_first.date_time AT TIME ZONE v_tz)::date IS DISTINCT FROM v_today
    THEN
      RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.time_punches WHERE id IN (v_latest.id, v_previous.id);
    v_kept := v_first;
  ELSE
    RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    BEGIN
      PERFORM public.write_audit_event(
        p_company_id,
        'attendance.shift_resumed',
        'time_punch',
        v_kept.id::text,
        jsonb_build_object('removed_latest_type', v_latest.type, 'removed_latest_id', v_latest.id),
        jsonb_build_object('open_punch_id', v_kept.id, 'open_at', v_kept.date_time)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
  END IF;

  RETURN row_to_json(v_kept);
END;
$function$;
REVOKE ALL ON FUNCTION public.resume_same_day_shift(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resume_same_day_shift(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_same_day_shift(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.resume_same_day_shift(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.run_compliance_reminders(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d record; r record; v_sent int := 0; v_docs int := 0; v_stage int; v_days int;
  v_title text; v_body text; v_type text;
BEGIN
  FOR d IN
    SELECT cd.id, cd.company_id, cd.document_type, cd.document_name, cd.expiry_date, cd.direction,
           CASE WHEN cd.client_id IS NOT NULL THEN 'client' ELSE 'contractor' END AS kind,
           coalesce(cd.client_id, cd.contractor_id) AS party_id,
           coalesce(nullif(trim(cl.name), ''), nullif(trim(co.name), ''), 'Unknown') AS party_name
    FROM public.contractor_documents cd
    LEFT JOIN public.clients cl ON cl.id = cd.client_id
    LEFT JOIN public.contractors co ON co.id = cd.contractor_id
    WHERE cd.is_current AND cd.approval_status = 'approved' AND cd.expiry_date IS NOT NULL
      AND cd.expiry_date <= current_date + 30
      AND cd.expiry_date >= current_date - 30
      AND (p_company_id IS NULL OR cd.company_id = p_company_id)
      AND (cd.contractor_id IS NULL OR coalesce(co.is_active, true))
  LOOP
    v_docs := v_docs + 1;
    v_days := d.expiry_date - current_date;
    v_stage := CASE WHEN v_days <= 0 THEN 0 WHEN v_days <= 7 THEN 7 ELSE 30 END;
    v_type := CASE WHEN v_days < 0 THEN 'compliance_expired' ELSE 'compliance_expiring' END;
    v_title := CASE WHEN v_days < 0 THEN 'Compliance Document Expired'
                    WHEN v_days = 0 THEN 'Compliance Document Expires Today'
                    ELSE 'Compliance Document Expiring' END;
    v_body := CASE WHEN d.direction = 'to_party' THEN 'Our document for ' ELSE '' END
      || d.party_name || ': ' || initcap(replace(d.document_type, '_', ' '))
      || coalesce(' ("' || nullif(nullif(trim(d.document_name), ''), 'none') || '")', '') || ' '
      || CASE WHEN v_days < 0 THEN 'expired on ' || to_char(d.expiry_date, 'DD Mon YYYY')
              WHEN v_days = 0 THEN 'expires today'
              ELSE 'expires in ' || v_days || ' day' || CASE WHEN v_days = 1 THEN '' ELSE 's' END
                   || ' (' || to_char(d.expiry_date, 'DD Mon YYYY') || ')' END
      || CASE WHEN d.direction = 'to_party' THEN ' — upload the new one on the client''s Compliance tab.'
              ELSE ' — ask for a new one or check their Compliance tab.' END;

    FOR r IN
      SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
      FROM public.employees e
      WHERE e.company_id = d.company_id AND e.is_active = true AND e.user_id IS NOT NULL
        AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
    LOOP
      INSERT INTO public.app_notifications (company_id, audience, recipient_auth_user_id, recipient_employee_id,
        type, title, body, ref_type, ref_id, dedupe_key, data)
      VALUES (d.company_id, 'hr', r.auth_user_id, r.employee_id, v_type, v_title, v_body,
        d.kind, d.party_id::text,
        'compliance_reminder:' || d.id::text || ':' || v_stage::text || ':' || r.employee_id::text,
        jsonb_build_object(d.kind || '_id', d.party_id, 'document_id', d.id, 'document_type', d.document_type,
                           'expiry_date', d.expiry_date, 'stage_days', v_stage, 'direction', d.direction))
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      IF FOUND THEN v_sent := v_sent + 1; END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (p_company_id, NULL, 'ComplianceJob', 'compliance_reminders_run', 'info',
          jsonb_build_object('documents_due', v_docs, 'notifications_sent', v_sent), now());
  RETURN json_build_object('documents_due', v_docs, 'notifications_sent', v_sent);
END;
$function$;
REVOKE ALL ON FUNCTION public.run_compliance_reminders(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_compliance_reminders(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_company_role_permissions(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matrix text[][] := ARRAY[
    ['owner','projects.view',              'true'],
    ['owner','projects.view_all',          'true'],
    ['owner','projects.create',            'true'],
    ['owner','projects.edit',              'true'],
    ['owner','jobs.view',                  'true'],
    ['owner','jobs.view_all',              'true'],
    ['owner','jobs.create',                'true'],
    ['owner','jobs.edit',                  'true'],
    ['owner','employees.view',             'true'],
    ['owner','employees.create',           'true'],
    ['owner','employees.edit',             'true'],
    ['owner','contractors.view',           'true'],
    ['owner','contractors.create',         'true'],
    ['owner','contractors.edit',           'true'],
    ['owner','clients.view',               'true'],
    ['owner','clients.edit',               'true'],
    ['owner','inventory.view',             'true'],
    ['owner','inventory.edit',             'true'],
    ['owner','suppliers.view',             'true'],
    ['owner','suppliers.edit',             'true'],
    ['owner','attendance.view_team',       'true'],
    ['owner','attendance.view_all',        'true'],
    ['owner','leave.view_all',             'true'],
    ['owner','leave.approve',              'true'],
    ['owner','payments.view_payroll',      'true'],
    ['owner','payments.approve',           'true'],
    ['owner','reports.view_operational',   'true'],
    ['owner','reports.view_financial',     'true'],
    ['owner','settings.view',              'true'],
    ['hr','projects.view',                 'true'],
    ['hr','projects.view_all',             'true'],
    ['hr','projects.create',               'true'],
    ['hr','projects.edit',                 'true'],
    ['hr','jobs.view',                     'true'],
    ['hr','jobs.view_all',                 'true'],
    ['hr','jobs.create',                   'true'],
    ['hr','jobs.edit',                     'true'],
    ['hr','employees.view',                'true'],
    ['hr','employees.create',              'true'],
    ['hr','employees.edit',                'true'],
    ['hr','contractors.view',              'true'],
    ['hr','contractors.create',            'true'],
    ['hr','contractors.edit',              'true'],
    ['hr','clients.view',                  'true'],
    ['hr','clients.edit',                  'true'],
    ['hr','inventory.view',                'true'],
    ['hr','inventory.edit',                'true'],
    ['hr','suppliers.view',                'true'],
    ['hr','suppliers.edit',                'true'],
    ['hr','attendance.view_team',          'true'],
    ['hr','attendance.view_all',           'true'],
    ['hr','leave.view_all',                'true'],
    ['hr','leave.approve',                 'true'],
    ['hr','payments.view_payroll',         'true'],
    ['hr','payments.approve',              'true'],
    ['hr','reports.view_operational',      'true'],
    ['hr','reports.view_financial',        'true'],
    ['hr','settings.view',                 'true'],
    ['manager','projects.view',            'true'],
    ['manager','projects.view_all',        'false'],
    ['manager','projects.create',          'true'],
    ['manager','projects.edit',            'true'],
    ['manager','jobs.view',                'true'],
    ['manager','jobs.view_all',            'false'],
    ['manager','jobs.create',              'true'],
    ['manager','jobs.edit',                'true'],
    ['manager','employees.view',           'true'],
    ['manager','employees.create',         'false'],
    ['manager','employees.edit',           'false'],
    ['manager','contractors.view',         'true'],
    ['manager','contractors.create',       'true'],
    ['manager','contractors.edit',         'true'],
    ['manager','clients.view',             'true'],
    ['manager','clients.edit',             'true'],
    ['manager','inventory.view',           'true'],
    ['manager','inventory.edit',           'true'],
    ['manager','suppliers.view',           'true'],
    ['manager','suppliers.edit',           'false'],
    ['manager','attendance.view_team',     'true'],
    ['manager','attendance.view_all',      'false'],
    ['manager','leave.view_all',           'false'],
    ['manager','leave.approve',            'true'],
    ['manager','payments.view_payroll',    'false'],
    ['manager','payments.approve',         'false'],
    ['manager','reports.view_operational', 'true'],
    ['manager','reports.view_financial',   'false'],
    ['manager','settings.view',            'false'],
    ['employee','projects.view',           'true'],
    ['employee','projects.view_all',       'false'],
    ['employee','projects.create',         'false'],
    ['employee','projects.edit',           'false'],
    ['employee','jobs.view',               'true'],
    ['employee','jobs.view_all',           'false'],
    ['employee','jobs.create',             'false'],
    ['employee','jobs.edit',               'false'],
    ['employee','employees.view',          'false'],
    ['employee','employees.create',        'false'],
    ['employee','employees.edit',          'false'],
    ['employee','contractors.view',        'false'],
    ['employee','contractors.create',      'false'],
    ['employee','contractors.edit',        'false'],
    ['employee','clients.view',            'true'],
    ['employee','clients.edit',            'false'],
    ['employee','inventory.view',          'true'],
    ['employee','inventory.edit',          'false'],
    ['employee','suppliers.view',          'false'],
    ['employee','suppliers.edit',          'false'],
    ['employee','attendance.view_team',    'false'],
    ['employee','attendance.view_all',     'false'],
    ['employee','leave.view_all',          'false'],
    ['employee','leave.approve',           'false'],
    ['employee','payments.view_payroll',   'false'],
    ['employee','payments.approve',        'false'],
    ['employee','reports.view_operational','false'],
    ['employee','reports.view_financial',  'false'],
    ['employee','settings.view',           'false']
  ];
  i int;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.hr_check_step_up_valid(p_company_id) THEN
        RAISE EXCEPTION 'STEP_UP_REQUIRED: step-up verification required'
            USING ERRCODE = 'P0001';
    END IF;

    FOR i IN 1 .. array_length(v_matrix, 1) LOOP
        INSERT INTO public.company_role_permissions
            (company_id, role, permission_key, allowed)
        VALUES (
            p_company_id,
            v_matrix[i][1],
            v_matrix[i][2],
            v_matrix[i][3]::boolean
        )
        ON CONFLICT (company_id, role, permission_key) DO NOTHING;
    END LOOP;

    BEGIN
        PERFORM write_audit_event(
            p_company_id,
            'company.permissions_seeded',
            'company',
            p_company_id::text
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
END;
$function$;
REVOKE ALL ON FUNCTION public.seed_company_role_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_company_role_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_company_role_permissions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.self_register_company(p_company_name text, p_owner_first_name text DEFAULT ''::text, p_owner_last_name text DEFAULT ''::text, p_role text DEFAULT 'owner'::text)
 RETURNS TABLE(company_id uuid, company_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_uid        uuid;
    v_code       text;
    v_company_id uuid;
    v_email      text;
    v_fn         text;
    v_ln         text;
    v_ecode      text;
    v_safe_role  text;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to register a company.';
    END IF;

    IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
        RAISE EXCEPTION 'Company name is required.';
    END IF;

    v_safe_role := CASE WHEN p_role IN ('owner','hr_admin','hr') THEN p_role ELSE 'hr_admin' END;

    IF v_safe_role = 'owner' AND EXISTS (
        SELECT 1 FROM public.company_relationships
        WHERE user_id = v_uid AND role = 'owner' AND is_active = true
    ) THEN
        RAISE EXCEPTION 'This account has already registered a company as owner.';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

    v_fn := COALESCE(NULLIF(btrim(p_owner_first_name), ''), split_part(v_email, '@', 1));
    v_ln := COALESCE(NULLIF(btrim(p_owner_last_name), ''), '');

    LOOP
        v_code := lpad(nextval('public.company_code_seq')::text, 2, '0');
        BEGIN
            INSERT INTO public.companies (name, code, plan_code, trial_started_at, owner_user_id)
            VALUES (btrim(p_company_name), v_code, 'free_trial', now(), v_uid)
            RETURNING id INTO v_company_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            CONTINUE;
        END;
    END LOOP;

    IF v_safe_role <> 'owner' THEN
        UPDATE public.company_relationships
        SET role = v_safe_role
        WHERE user_id = v_uid AND company_id = v_company_id;
    END IF;

    v_ecode := v_code || '-' || upper(v_safe_role);
    INSERT INTO public.employees (
        company_id, name, surname, employee_code,
        employment_type, position,
        monthly_salary, hourly_rate, weekly_rate, daily_rate,
        work_days_weekly, daily_hours, branch,
        access_level, worker_type, user_id, email
    ) VALUES (
        v_company_id, v_fn, v_ln, v_ecode,
        'permanent', CASE WHEN v_safe_role = 'owner' THEN 'Company Owner' ELSE 'HR Administrator' END,
        0, 0, 0, 0,
        5, 8, '',
        v_safe_role, 'employee', v_uid, lower(trim(v_email))
    );

    RETURN QUERY SELECT v_company_id, v_code;
END;
$function$;
REVOKE ALL ON FUNCTION public.self_register_company(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.self_register_company(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.self_register_company(text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.self_register_company(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.self_register_company(text,text,text,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.set_pa_tasks_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_pa_tasks_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_pa_tasks_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pa_tasks_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_pa_tasks_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pa_tasks_updated_at() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.set_updated_at_app_release_config()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.set_updated_at_app_release_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at_app_release_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at_app_release_config() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at_app_release_config() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at_app_release_config() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.shift_assignment_score(p_company_id bigint, p_employee_id bigint, p_shift_id bigint)
 RETURNS TABLE(score numeric, reason text)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_branch text;
  v_emp_branch text;
  v_score numeric := 100;
begin
  select s.branch into v_branch
  from public.shifts s
  where s.id = p_shift_id and s.company_id = p_company_id;

  select e.branch into v_emp_branch
  from public.employees e
  where e.id = p_employee_id and e.company_id = p_company_id;

  if public.employee_has_shift_overlap(p_company_id, p_employee_id, (select starts_at from public.shifts where id = p_shift_id), (select ends_at from public.shifts where id = p_shift_id)) then
    v_score := v_score - 70;
  end if;
  if v_branch is not null and v_emp_branch is not null and lower(v_branch) <> lower(v_emp_branch) then
    v_score := v_score - 10;
  end if;
  if not public.has_employee_mandatory_compliance(p_company_id, p_employee_id) then
    v_score := v_score - 40;
  end if;

  return query select greatest(v_score, 0), 'branch/compliance/availability baseline';
end;
$function$;
REVOKE ALL ON FUNCTION public.shift_assignment_score(bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shift_assignment_score(bigint,bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shift_assignment_score(bigint,bigint,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.shift_assignment_score(bigint,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.shift_assignment_score(bigint,bigint,bigint) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.smart_sched_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.smart_sched_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smart_sched_touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.smart_sched_touch_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.smart_sched_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.smart_sched_touch_updated_at() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.stock_adjustments_immutable_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock_adjustments are immutable and cannot be deleted'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.adjusted_by IS NULL
     AND OLD.adjusted_by IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.catalogue_item_id IS NOT DISTINCT FROM OLD.catalogue_item_id
     AND NEW.adjustment_type IS NOT DISTINCT FROM OLD.adjustment_type
     AND NEW.qty_change IS NOT DISTINCT FROM OLD.qty_change
     AND NEW.qty_before IS NOT DISTINCT FROM OLD.qty_before
     AND NEW.qty_after IS NOT DISTINCT FROM OLD.qty_after
     AND NEW.reference_type IS NOT DISTINCT FROM OLD.reference_type
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'stock_adjustments are immutable and cannot be updated'
    USING ERRCODE = 'P0001';
END;
$function$;
REVOKE ALL ON FUNCTION public.stock_adjustments_immutable_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_adjustments_immutable_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_adjustments_immutable_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.stock_adjustments_immutable_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.stock_adjustments_immutable_guard() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.supplier_statement(p_supplier_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.contractors WHERE id = p_supplier_id;
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(v_company)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN coalesce((
    SELECT json_agg(row_to_json(e) ORDER BY e.entry_date, e.ord) FROM (
      SELECT created_at::date entry_date, 1 ord, 'invoice' kind, id invoice_id, coalesce(bill_number, invoice_number) reference,
             'Bill' || coalesce(' — their invoice ' || invoice_number, '') description, total_amount debit, 0::numeric credit, due_date, status
      FROM public.supplier_invoices
      WHERE supplier_id = p_supplier_id AND company_id = v_company AND coalesce(status, '') NOT IN ('cancelled', 'void', 'voided', 'rejected')
      UNION ALL
      SELECT coalesce(paid_at::date, updated_at::date), 2, 'payment', id, coalesce(remittance_number, bill_number, invoice_number),
             'Payment made', 0, amount_paid, NULL, NULL
      FROM public.supplier_invoices
      WHERE supplier_id = p_supplier_id AND company_id = v_company AND coalesce(amount_paid, 0) > 0
        AND coalesce(status, '') NOT IN ('cancelled', 'void', 'voided', 'rejected')) e), '[]'::json);
END $function$;
REVOKE ALL ON FUNCTION public.supplier_statement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_statement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_statement(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_project_costs(p_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.client_deals
  SET
    committed_cost = (
      SELECT COALESCE(SUM(total_amount * coalesce(exchange_rate, 1)), 0)
      FROM public.purchase_orders
      WHERE deal_id = p_deal_id AND status NOT IN ('cancelled', 'draft')
    ),
    actual_cost = (
      SELECT COALESCE(SUM(total_amount * coalesce(exchange_rate, 1)), 0)
      FROM public.supplier_invoices
      WHERE project_id = p_deal_id AND status != 'cancelled'
    ),
    updated_at = now()
  WHERE id = p_deal_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_project_costs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_project_costs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_project_costs(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.sync_project_costs(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_project_costs(uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public._seed_company_permissions_from_defaults(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
    VALUES (NEW.id, auth.uid(), 'CompanySetup', 'company_permissions_seed_failed', 'error',
            jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM), now());
  END;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'ensure_farms_permissions') THEN
    PERFORM public.ensure_farms_permissions(NEW.id);
  END IF;
  PERFORM public.ensure_properties_permissions(NEW.id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_fn_seed_company_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_fn_seed_company_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_fn_seed_company_permissions() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_fn_seed_company_permissions() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_fn_seed_company_permissions() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_company_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE v_role text; v_allowed boolean; BEGIN IF auth.uid() IS NULL THEN RETURN false; END IF; v_role := get_my_role(p_company_id); IF v_role IS NULL THEN RETURN false; END IF; IF public.role_is_owner_or_admin(v_role) THEN RETURN true; END IF; SELECT allowed INTO v_allowed FROM company_role_permissions WHERE company_id = p_company_id AND role = v_role AND permission_key = p_permission_key LIMIT 1; RETURN COALESCE(v_allowed, false); END; $function$;
REVOKE ALL ON FUNCTION public.user_has_permission(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.xero_doc_statuses(p_company_id uuid, p_kind text, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link_entity text; v_queue text[]; v_out jsonb := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = p_company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true))
     AND NOT public.platform_is_admin() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.xero_connections WHERE company_id = p_company_id AND coalesce(is_active, true)) THEN
    RETURN NULL;
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
END $function$;
REVOKE ALL ON FUNCTION public.xero_doc_statuses(uuid,text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.xero_doc_statuses(uuid,text,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xero_doc_statuses(uuid,text,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.xero_sync_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.xero_connections%ROWTYPE; v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = p_company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true))
     AND NOT public.platform_is_admin() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO c FROM public.xero_connections WHERE company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('connected', false); END IF;
  RETURN jsonb_build_object(
    'connected', coalesce(c.is_active, true), 'tenant_name', c.tenant_name, 'can_attach_pdfs', coalesce(c.scopes, '') ILIKE '%accounting.attachments%',
    'track_projects_jobs', c.track_projects_jobs, 'link_items', c.link_items, 'attach_pdfs', c.attach_pdfs, 'tracking_note', c.tracking_note,
    'can_sync_documents', coalesce(c.scopes, '') ILIKE '%accounting.invoices%' OR coalesce(c.scopes, '') ILIKE '%accounting.transactions%',
    'auto_sync', c.auto_sync, 'sync_from', c.sync_from,
    'sales_account_code', c.sales_account_code, 'purchases_account_code', c.purchases_account_code, 'bank_account_code', c.bank_account_code,
    'last_error', c.last_error, 'last_error_at', c.last_error_at,
    'pull_from_xero', c.pull_from_xero, 'pulled_at', c.pulled_at, 'pull_error', c.pull_error,
    'received_today', (SELECT count(*) FROM public.xero_doc_links l WHERE l.company_id = p_company_id
                         AND l.entity IN ('xero_payment', 'xero_supplier_payment') AND l.xero_status = 'AUTHORISED' AND l.last_synced_at >= v_day),
    'waiting', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status IN ('pending', 'working')),
    'failed', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status = 'error'),
    'sent_today', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status = 'done' AND q.done_at >= v_day));
END $function$;
REVOKE ALL ON FUNCTION public.xero_sync_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.xero_sync_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xero_sync_status(uuid) TO service_role;

-- Older bigint versions that production still has alongside the uuid versions
CREATE OR REPLACE FUNCTION public.employee_insert_pa_task(p_company_id bigint, p_employee_id bigint, p_title text, p_notes text DEFAULT NULL::text, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority text DEFAULT 'medium'::text, p_remind_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_linked_type text DEFAULT 'none'::text, p_linked_id text DEFAULT NULL::text, p_linked_label text DEFAULT NULL::text, p_recurrence_pattern text DEFAULT 'none'::text, p_source_type text DEFAULT NULL::text, p_source_id text DEFAULT NULL::text, p_meeting_with text DEFAULT NULL::text, p_meeting_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meeting_minutes text DEFAULT NULL::text, p_meeting_follow_up text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  INSERT INTO public.pa_tasks (
    company_id,
    title,
    notes,
    due_at,
    priority,
    status,
    remind_at,
    linked_type,
    linked_id,
    linked_label,
    recurrence_pattern,
    source_type,
    source_id,
    meeting_with,
    meeting_at,
    owner_employee_id,
    owner_hr_user_id,
    meeting_minutes,
    meeting_follow_up
  ) VALUES (
    p_company_id,
    trim(p_title),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    p_due_at,
    COALESCE(NULLIF(trim(p_priority), ''), 'medium'),
    'todo',
    p_remind_at,
    COALESCE(NULLIF(trim(p_linked_type), ''), 'none'),
    NULLIF(trim(COALESCE(p_linked_id, '')), ''),
    NULLIF(trim(COALESCE(p_linked_label, '')), ''),
    COALESCE(NULLIF(trim(p_recurrence_pattern), ''), 'none'),
    NULLIF(trim(COALESCE(p_source_type, '')), ''),
    NULLIF(trim(COALESCE(p_source_id, '')), ''),
    NULLIF(trim(COALESCE(p_meeting_with, '')), ''),
    p_meeting_at,
    p_employee_id,
    NULL,
    NULLIF(trim(COALESCE(p_meeting_minutes, '')), ''),
    NULLIF(trim(COALESCE(p_meeting_follow_up, '')), '')
  )
  RETURNING pa_tasks.id INTO v_id;

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_insert_pa_task(bigint,bigint,text,text,timestamp with time zone,text,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(bigint,bigint,text,text,timestamp with time zone,text,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(bigint,bigint,text,text,timestamp with time zone,text,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(bigint,bigint,text,text,timestamp with time zone,text,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(bigint,bigint,text,text,timestamp with time zone,text,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_submit_leave_request(p_company_id bigint, p_employee_id bigint, p_leave_type text, p_start_date date, p_end_date date, p_half_day_start boolean, p_half_day_end boolean, p_total_days integer, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id bigint;
  v_name text;
  r public.hr_users%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees ex
    WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leave_requests lr
    WHERE lr.company_id = p_company_id
      AND lr.employee_id = p_employee_id
      AND lr.status IN ('pending', 'approved')
      AND lr.start_date <= p_end_date
      AND lr.end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'You already have a pending/approved leave request in this range.';
  END IF;

  SELECT trim(both concat_ws(' ', nullif(trim(e.name), ''), nullif(trim(e.surname), '')))
  INTO v_name
  FROM public.employees e
  WHERE e.id = p_employee_id;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := 'Employee #' || p_employee_id::text;
  END IF;

  INSERT INTO public.leave_requests (
    company_id,
    employee_id,
    leave_type,
    start_date,
    end_date,
    half_day_start,
    half_day_end,
    total_days,
    reason,
    status
  ) VALUES (
    p_company_id,
    p_employee_id,
    coalesce(nullif(trim(p_leave_type), ''), 'annual'),
    p_start_date,
    p_end_date,
    coalesce(p_half_day_start, false),
    coalesce(p_half_day_end, false),
    greatest(1, coalesce(p_total_days, 1)),
    nullif(trim(coalesce(p_reason, '')), ''),
    'pending'
  )
  RETURNING id INTO v_id;

  FOR r IN
    SELECT * FROM public.hr_users h
    WHERE h.company_id = p_company_id AND h.is_active = true
  LOOP
    IF r.auth_user_id IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.app_notifications n
      WHERE n.dedupe_key =
            'leave_submitted:' || v_id::text || ':' || r.auth_user_id::text
    ) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.app_notifications (
      company_id,
      audience,
      recipient_auth_user_id,
      type,
      title,
      body,
      ref_type,
      ref_id,
      dedupe_key
    ) VALUES (
      p_company_id,
      'hr',
      r.auth_user_id,
      'leave_submitted',
      'Leave request submitted',
      format(
        '%s requested %s leave (%s - %s).',
        v_name,
        lower(trim(coalesce(nullif(trim(p_leave_type), ''), 'annual'))),
        to_char(p_start_date, 'DD Mon'),
        to_char(p_end_date, 'DD Mon')
      ),
      'leave_request',
      v_id::text,
      'leave_submitted:' || v_id::text || ':' || r.auth_user_id::text
    );
  END LOOP;

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_submit_leave_request(bigint,bigint,text,date,date,boolean,boolean,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_submit_leave_request(bigint,bigint,text,date,date,boolean,boolean,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_leave_request(bigint,bigint,text,date,date,boolean,boolean,integer,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_submit_leave_request(bigint,bigint,text,date,date,boolean,boolean,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_submit_leave_request(bigint,bigint,text,date,date,boolean,boolean,integer,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1
    from public.employees e
    where e.profile_id = auth.uid()
      and e.company_id = p_company_id
      and e.access_level = 'owner'
  );
$function$;
REVOKE ALL ON FUNCTION public.is_company_owner(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_owner(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_owner(bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.is_company_owner(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.is_visible_to_me(p_scope text, p_scope_id bigint, p_company_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_visibility text;
  v_parent_deal bigint;
  v_assignee bigint;
  v_my_employee_id bigint;
begin
  if v_uid is null then
    return false;
  end if;

  if public.is_company_owner(p_company_id) then
    return true;
  end if;

  select coalesce(
    (select h.role
       from public.hr_users h
      where h.auth_user_id = v_uid
        and h.company_id = p_company_id
        and coalesce(h.is_active, true) = true
      limit 1),
    (select e.access_level
       from public.employees e
      where e.profile_id = v_uid
        and e.company_id = p_company_id
      limit 1)
  ) into v_role;

  v_role := case v_role
    when 'hr' then 'hr_admin'
    when 'payroll' then 'hr_admin'
    when 'viewer' then 'employee'
    else v_role
  end;

  if (p_scope = 'job' and public.has_permission(p_company_id, 'jobs.view'))
     or (p_scope = 'deal' and public.has_permission(p_company_id, 'projects.view')) then
    null;
  else
    return false;
  end if;

  if p_scope = 'job' then
    select j.visibility, j.deal_id, j.assignee_employee_id
      into v_visibility, v_parent_deal, v_assignee
      from public.jobs j
      where j.id = p_scope_id and j.company_id = p_company_id;

    if v_visibility is null then
      return false;
    end if;

    if v_visibility = 'inherit' then
      if v_parent_deal is null then
        v_visibility := 'all';
      else
        select cd.visibility into v_visibility
        from public.client_deals cd
        where cd.id = v_parent_deal and cd.company_id = p_company_id;
        v_visibility := coalesce(v_visibility, 'all');
      end if;
    end if;
  elsif p_scope = 'deal' then
    select cd.visibility into v_visibility
      from public.client_deals cd
      where cd.id = p_scope_id and cd.company_id = p_company_id;
    if v_visibility is null then
      return false;
    end if;
    v_assignee := null;
  else
    return false;
  end if;

  select e.id into v_my_employee_id
  from public.employees e
  where e.profile_id = v_uid
    and e.company_id = p_company_id
  limit 1;

  if v_visibility = 'all' then
    if v_role = 'employee' then
      if p_scope <> 'job' or v_my_employee_id is null then
        return false;
      end if;
      return exists (
        select 1
        from public.jobs j
        where j.id = p_scope_id
          and j.company_id = p_company_id
          and (
            j.assignee_employee_id = v_my_employee_id
            or v_my_employee_id = any(coalesce(j.assigned_employee_ids, '{}'::bigint[]))
          )
      );
    end if;
    return true;
  end if;

  if v_my_employee_id is null then
    return false;
  end if;

  if v_visibility = 'private' then
    return v_assignee is not null and v_assignee = v_my_employee_id;
  end if;

  if v_visibility = 'restricted' then
    if v_assignee is not null and v_assignee = v_my_employee_id then
      return true;
    end if;

    if exists (
      select 1
      from public.visibility_grants g
      where g.scope = p_scope
        and g.scope_id = p_scope_id
        and g.company_id = p_company_id
        and g.target_type = 'employee'
        and g.target_id = v_my_employee_id
    ) then
      return true;
    end if;

    if exists (
      select 1
      from public.visibility_grants g
      join public.work_team_members m
        on m.team_id = g.target_id
       and m.company_id = g.company_id
      where g.scope = p_scope
        and g.scope_id = p_scope_id
        and g.company_id = p_company_id
        and g.target_type = 'team'
        and m.employee_id = v_my_employee_id
    ) then
      return true;
    end if;

    if v_assignee is not null and exists (
      select 1
      from public.employees e
      where e.id = v_assignee
        and e.manager_user_id = v_uid
    ) then
      return true;
    end if;

    return false;
  end if;

  return false;
end;
$function$;
REVOKE ALL ON FUNCTION public.is_visible_to_me(text,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_visible_to_me(text,bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_visible_to_me(text,bigint,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.is_visible_to_me(text,bigint,bigint) TO service_role;

-- 3. Security policies ----------------------------------------------------
DROP POLICY IF EXISTS authenticated_delete_app_releases ON storage.objects;
CREATE POLICY authenticated_delete_app_releases ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = 'app-releases'::text));
DROP POLICY IF EXISTS authenticated_update_app_releases ON storage.objects;
CREATE POLICY authenticated_update_app_releases ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING ((bucket_id = 'app-releases'::text)) WITH CHECK ((bucket_id = 'app-releases'::text));
DROP POLICY IF EXISTS authenticated_write_app_releases ON storage.objects;
CREATE POLICY authenticated_write_app_releases ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'app-releases'::text));
DROP POLICY IF EXISTS public_read_app_releases ON storage.objects;
CREATE POLICY public_read_app_releases ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'app-releases'::text));
DROP POLICY IF EXISTS p_punches_all_hr_company ON public.punches;
CREATE POLICY p_punches_all_hr_company ON public.punches AS PERMISSIVE FOR ALL TO authenticated USING ((company_id = current_hr_company_id())) WITH CHECK ((company_id = current_hr_company_id()));
DROP POLICY IF EXISTS p_app_release_config_select_all ON public.app_release_config;
CREATE POLICY p_app_release_config_select_all ON public.app_release_config AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS p_client_portal_tokens_hr_company ON public.client_portal_tokens;
CREATE POLICY p_client_portal_tokens_hr_company ON public.client_portal_tokens AS PERMISSIVE FOR ALL TO public USING ((company_id = current_hr_company_id()));
DROP POLICY IF EXISTS p_client_portal_events_hr_company ON public.client_portal_events;
CREATE POLICY p_client_portal_events_hr_company ON public.client_portal_events AS PERMISSIVE FOR ALL TO public USING ((company_id = current_hr_company_id()));
DROP POLICY IF EXISTS p_operational_escalation_rules_hr_company ON public.operational_escalation_rules;
CREATE POLICY p_operational_escalation_rules_hr_company ON public.operational_escalation_rules AS PERMISSIVE FOR ALL TO public USING ((company_id = current_hr_company_id()));
DROP POLICY IF EXISTS p_operational_escalation_events_hr_company ON public.operational_escalation_events;
CREATE POLICY p_operational_escalation_events_hr_company ON public.operational_escalation_events AS PERMISSIVE FOR ALL TO public USING ((company_id = current_hr_company_id()));
DROP POLICY IF EXISTS service_role_only ON public.xero_oauth_states;
CREATE POLICY service_role_only ON public.xero_oauth_states AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_only ON public.xero_connections;
CREATE POLICY service_role_only ON public.xero_connections AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_only ON public.xero_contact_links;
CREATE POLICY service_role_only ON public.xero_contact_links AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_only ON public.xero_journal_links;
CREATE POLICY service_role_only ON public.xero_journal_links AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);

-- 4. Old function versions that production no longer has --------------
DO $drop$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND (p.proname, p.pronargs) IN (('add_item_variant',4), ('contractor_portal_save_quote_draft',11), ('contractor_portal_upload_quote',13), ('employee_get_documents',2), ('employee_get_last_punch',1), ('employee_get_my_punches',4), ('employee_get_payslips',2), ('employee_is_on_leave_today',2), ('employee_submit_document',5), ('employee_update_profile',10), ('get_variant_group',2), ('record_stock_adjustment',10))
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $drop$;

NOTIFY pgrst, 'reload schema';
