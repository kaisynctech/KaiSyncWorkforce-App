-- ============================================================
-- KaiSync Commercial Engine — Phase 4: Automation
-- 2026-08-11
--
-- Adds: commercial_automation_rules (UUID-based, replaces the
--       empty bigint automation_rules shell), execution log,
--       overdue invoice notifier RPC, milestone due reminder RPC,
--       default rule seeds for all companies
--
-- IMPORTANT: Does NOT touch the old `automation_rules` table
--            (bigint IDs, left in place to avoid breakage)
-- ============================================================


-- ============================================================
-- 1. COMMERCIAL AUTOMATION RULES
--    UUID-based. Replaces the empty bigint automation_rules shell
--    for all commercial engine automation.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.commercial_automation_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  name            text        NOT NULL,
  description     text,
  trigger_type    text        NOT NULL,
    -- quote_accepted | invoice_overdue | milestone_due | po_approved | quote_expiring
  trigger_config  jsonb       NOT NULL DEFAULT '{}',
    -- trigger_type = 'invoice_overdue':  { "days_overdue": 1 }
    -- trigger_type = 'milestone_due':    { "days_before": 3 }
    -- trigger_type = 'quote_expiring':   { "days_before": 7 }
  action_type     text        NOT NULL,
    -- create_project | create_rfq | send_notification | create_milestone_invoice
  action_config   jsonb       NOT NULL DEFAULT '{}',
    -- action_type = 'create_project':       { "auto_assign_manager": true }
    -- action_type = 'create_rfq':           { "from_quote_lines": true }
    -- action_type = 'send_notification':    { "title": "...", "body_template": "..." }
  is_active       boolean     NOT NULL DEFAULT false,   -- off by default; user enables
  is_system       boolean     NOT NULL DEFAULT true,    -- system rules can't be deleted
  run_count       integer     NOT NULL DEFAULT 0,
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commercial_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation_rules_select" ON public.commercial_automation_rules FOR SELECT
  USING (company_id = ANY(public.user_company_ids()));
CREATE POLICY "automation_rules_update" ON public.commercial_automation_rules FOR UPDATE
  USING (company_id = ANY(public.user_company_ids())
    AND public.user_has_permission(company_id, 'projects.edit'));
-- No INSERT/DELETE for non-system rules (seeded by migration)


-- ============================================================
-- 2. AUTOMATION RULE EXECUTIONS (audit log)
--    Immutable — append only, no UPDATE/DELETE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.automation_rule_executions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL,
  rule_id             uuid        REFERENCES public.commercial_automation_rules(id) ON DELETE SET NULL,
  trigger_type        text        NOT NULL,
  trigger_entity_id   text        NOT NULL,   -- stringified UUID of the triggering entity
  trigger_entity_type text        NOT NULL,   -- 'quote' | 'invoice' | 'milestone' | 'po'
  action_type         text        NOT NULL,
  status              text        NOT NULL DEFAULT 'success',
    -- success | failed | skipped
  result              jsonb       NOT NULL DEFAULT '{}',
  error_message       text,
  executed_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exec_select" ON public.automation_rule_executions FOR SELECT
  USING (company_id = ANY(public.user_company_ids())
    AND public.user_has_permission(company_id, 'projects.view'));
CREATE POLICY "exec_insert" ON public.automation_rule_executions FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids()));
CREATE POLICY "exec_no_update" ON public.automation_rule_executions FOR UPDATE
  USING (false);
CREATE POLICY "exec_no_delete" ON public.automation_rule_executions FOR DELETE
  USING (false);


-- ============================================================
-- 3. SEED DEFAULT AUTOMATION RULES FOR ALL COMPANIES
--    is_active = false — each company opts in from Settings > Automations
-- ============================================================
INSERT INTO public.commercial_automation_rules
  (company_id, name, description, trigger_type, trigger_config, action_type, action_config, is_active, is_system)
SELECT
  c.id,
  rules.name,
  rules.description,
  rules.trigger_type,
  rules.trigger_config::jsonb,
  rules.action_type,
  rules.action_config::jsonb,
  false,
  true
FROM public.companies c
CROSS JOIN (VALUES
  (
    'Quote Accepted → Create Project',
    'Automatically creates a project (client deal) when a quote is accepted.',
    'quote_accepted',
    '{"auto_assign_manager": true}',
    'create_project',
    '{"set_status": "in_progress", "copy_quote_notes": true}'
  ),
  (
    'Quote Accepted → Generate RFQ',
    'Automatically creates an RFQ from the quote line items when a quote is accepted.',
    'quote_accepted',
    '{}',
    'create_rfq',
    '{"from_quote_lines": true, "status": "draft"}'
  ),
  (
    'Invoice Overdue → Notify Owner',
    'Sends an in-app notification when an invoice becomes overdue.',
    'invoice_overdue',
    '{"days_overdue": 1}',
    'send_notification',
    '{"title": "Invoice overdue", "body_template": "Invoice {invoice_number} for {client_name} is overdue by {days_overdue} day(s). Balance: {balance_due}.", "notify_role": "owner"}'
  ),
  (
    'Milestone Due Soon → Remind Manager',
    'Sends an in-app reminder 3 days before a milestone due date.',
    'milestone_due',
    '{"days_before": 3}',
    'send_notification',
    '{"title": "Milestone due soon", "body_template": "Milestone \"{milestone_name}\" on project {project_title} is due in {days_before} day(s).", "notify_role": "manager"}'
  ),
  (
    'Quote Expiring → Remind Sales',
    'Notifies the owner 7 days before a sent quote expires.',
    'quote_expiring',
    '{"days_before": 7}',
    'send_notification',
    '{"title": "Quote expiring soon", "body_template": "Quote {quote_number} for {client_name} expires in {days_before} day(s).", "notify_role": "owner"}'
  )
) AS rules(name, description, trigger_type, trigger_config, action_type, action_config)
ON CONFLICT DO NOTHING;


-- ============================================================
-- 4. OVERDUE INVOICE NOTIFIER RPC
--    Called daily (Vercel Cron or manual trigger from UI).
--    Finds overdue invoices, creates app_notifications, logs execution.
--    Dedupes on date so each invoice only notifies once per day.
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_overdue_invoices(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule        public.commercial_automation_rules%ROWTYPE;
  v_invoice     RECORD;
  v_count       integer := 0;
  v_today       text := to_char(CURRENT_DATE, 'YYYY-MM-DD');
  v_dedupe_key  text;
  v_body        text;
  v_days_overdue integer;
BEGIN
  -- Get the active rule
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

  -- Loop overdue invoices
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

    -- Build notification body from template
    v_body := (v_rule.action_config->>'body_template');
    v_body := REPLACE(v_body, '{invoice_number}', COALESCE(v_invoice.invoice_number, 'N/A'));
    v_body := REPLACE(v_body, '{client_name}', COALESCE(v_invoice.client_name, 'Unknown'));
    v_body := REPLACE(v_body, '{days_overdue}', v_days_overdue::text);
    v_body := REPLACE(v_body, '{balance_due}', 'R ' || ROUND(v_invoice.balance_due, 2)::text);

    -- Insert notification (dedupe_key prevents duplicates)
    INSERT INTO public.app_notifications (
      company_id, audience, type, title, body,
      ref_type, ref_id, dedupe_key,
      data
    )
    VALUES (
      p_company_id,
      'owner',
      'invoice_overdue',
      v_rule.action_config->>'title',
      v_body,
      'finance_invoice',
      v_invoice.id::text,
      v_dedupe_key,
      jsonb_build_object(
        'invoice_id',      v_invoice.id,
        'invoice_number',  v_invoice.invoice_number,
        'balance_due',     v_invoice.balance_due,
        'days_overdue',    v_days_overdue
      )
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    -- Log execution
    INSERT INTO public.automation_rule_executions
      (company_id, rule_id, trigger_type, trigger_entity_id, trigger_entity_type, action_type, status, result)
    VALUES
      (p_company_id, v_rule.id, 'invoice_overdue', v_invoice.id::text, 'invoice',
       'send_notification', 'success',
       jsonb_build_object('invoice_number', v_invoice.invoice_number, 'days_overdue', v_days_overdue));

    v_count := v_count + 1;
  END LOOP;

  -- Update rule run stats
  UPDATE public.commercial_automation_rules
  SET run_count = run_count + 1, last_run_at = now()
  WHERE id = v_rule.id;

  RETURN jsonb_build_object('processed', v_count);
END;
$$;


-- ============================================================
-- 5. MILESTONE DUE REMINDER RPC
--    Called daily. Notifies N days before milestone due_date.
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_due_milestones(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule        public.commercial_automation_rules%ROWTYPE;
  v_ms          RECORD;
  v_count       integer := 0;
  v_today       text := to_char(CURRENT_DATE, 'YYYY-MM-DD');
  v_days_before integer;
  v_dedupe_key  text;
  v_body        text;
BEGIN
  SELECT * INTO v_rule
  FROM public.commercial_automation_rules
  WHERE company_id = p_company_id
    AND trigger_type = 'milestone_due'
    AND action_type = 'send_notification'
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no active milestone_due rule');
  END IF;

  v_days_before := COALESCE((v_rule.trigger_config->>'days_before')::int, 3);

  FOR v_ms IN
    SELECT
      pm.id, pm.name AS milestone_name, pm.due_date,
      cd.title AS project_title, cd.id AS deal_id
    FROM public.project_milestones pm
    JOIN public.client_deals cd ON cd.id = pm.deal_id
    WHERE pm.company_id = p_company_id
      AND pm.status IN ('pending', 'in_progress')
      AND pm.due_date = CURRENT_DATE + v_days_before
  LOOP
    v_dedupe_key := 'milestone_due_' || v_ms.id::text || '_' || v_today;

    v_body := (v_rule.action_config->>'body_template');
    v_body := REPLACE(v_body, '{milestone_name}', COALESCE(v_ms.milestone_name, 'Unnamed'));
    v_body := REPLACE(v_body, '{project_title}', COALESCE(v_ms.project_title, 'Unknown project'));
    v_body := REPLACE(v_body, '{days_before}', v_days_before::text);

    INSERT INTO public.app_notifications (
      company_id, audience, type, title, body,
      ref_type, ref_id, dedupe_key, data
    )
    VALUES (
      p_company_id,
      'manager',
      'milestone_due',
      v_rule.action_config->>'title',
      v_body,
      'project_milestone',
      v_ms.id::text,
      v_dedupe_key,
      jsonb_build_object(
        'milestone_id',   v_ms.id,
        'milestone_name', v_ms.milestone_name,
        'project_title',  v_ms.project_title,
        'deal_id',        v_ms.deal_id,
        'due_date',       v_ms.due_date
      )
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    INSERT INTO public.automation_rule_executions
      (company_id, rule_id, trigger_type, trigger_entity_id, trigger_entity_type, action_type, status, result)
    VALUES
      (p_company_id, v_rule.id, 'milestone_due', v_ms.id::text, 'milestone',
       'send_notification', 'success',
       jsonb_build_object('milestone_name', v_ms.milestone_name, 'days_before', v_days_before));

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.commercial_automation_rules
  SET run_count = run_count + 1, last_run_at = now()
  WHERE id = v_rule.id;

  RETURN jsonb_build_object('processed', v_count);
END;
$$;


-- ============================================================
-- 6. QUOTE EXPIRING REMINDER RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_expiring_quotes(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule        public.commercial_automation_rules%ROWTYPE;
  v_quote       RECORD;
  v_count       integer := 0;
  v_today       text := to_char(CURRENT_DATE, 'YYYY-MM-DD');
  v_days_before integer;
  v_dedupe_key  text;
  v_body        text;
BEGIN
  SELECT * INTO v_rule
  FROM public.commercial_automation_rules
  WHERE company_id = p_company_id
    AND trigger_type = 'quote_expiring'
    AND action_type = 'send_notification'
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no active quote_expiring rule');
  END IF;

  v_days_before := COALESCE((v_rule.trigger_config->>'days_before')::int, 7);

  FOR v_quote IN
    SELECT
      cq.id, cq.quote_number, cq.valid_until,
      c.name AS client_name
    FROM public.commercial_quotes cq
    LEFT JOIN public.clients c ON c.id = cq.client_id
    WHERE cq.company_id = p_company_id
      AND cq.status = 'sent'
      AND cq.valid_until = CURRENT_DATE + v_days_before
  LOOP
    v_dedupe_key := 'quote_expiring_' || v_quote.id::text || '_' || v_today;

    v_body := (v_rule.action_config->>'body_template');
    v_body := REPLACE(v_body, '{quote_number}', COALESCE(v_quote.quote_number, 'N/A'));
    v_body := REPLACE(v_body, '{client_name}', COALESCE(v_quote.client_name, 'Unknown'));
    v_body := REPLACE(v_body, '{days_before}', v_days_before::text);

    INSERT INTO public.app_notifications (
      company_id, audience, type, title, body,
      ref_type, ref_id, dedupe_key, data
    )
    VALUES (
      p_company_id,
      'owner',
      'quote_expiring',
      v_rule.action_config->>'title',
      v_body,
      'commercial_quote',
      v_quote.id::text,
      v_dedupe_key,
      jsonb_build_object(
        'quote_id',     v_quote.id,
        'quote_number', v_quote.quote_number,
        'client_name',  v_quote.client_name,
        'valid_until',  v_quote.valid_until
      )
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    INSERT INTO public.automation_rule_executions
      (company_id, rule_id, trigger_type, trigger_entity_id, trigger_entity_type, action_type, status, result)
    VALUES
      (p_company_id, v_rule.id, 'quote_expiring', v_quote.id::text, 'quote',
       'send_notification', 'success',
       jsonb_build_object('quote_number', v_quote.quote_number, 'days_before', v_days_before));

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.commercial_automation_rules
  SET run_count = run_count + 1, last_run_at = now()
  WHERE id = v_rule.id;

  RETURN jsonb_build_object('processed', v_count);
END;
$$;


-- ============================================================
-- 7. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_auto_rules_company  ON public.commercial_automation_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_auto_rules_trigger  ON public.commercial_automation_rules(company_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_auto_exec_company   ON public.automation_rule_executions(company_id);
CREATE INDEX IF NOT EXISTS idx_auto_exec_rule      ON public.automation_rule_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_auto_exec_entity    ON public.automation_rule_executions(trigger_entity_id);
CREATE INDEX IF NOT EXISTS idx_app_notif_company   ON public.app_notifications(company_id);
CREATE INDEX IF NOT EXISTS idx_app_notif_type      ON public.app_notifications(company_id, type);
CREATE INDEX IF NOT EXISTS idx_app_notif_unread    ON public.app_notifications(company_id, is_read) WHERE is_read = false;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
