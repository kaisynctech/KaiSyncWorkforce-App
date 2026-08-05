
-- Enable RLS on all new tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_member_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Helper: returns uuid[] of company IDs the current user belongs to.
-- SECURITY DEFINER bypasses RLS when reading employees, preventing recursion.
CREATE OR REPLACE FUNCTION user_company_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT company_id FROM employees
    WHERE user_id = auth.uid() AND is_active = true
  );
$$;

-- ── companies ──────────────────────────────────────────────────────────────
CREATE POLICY "companies_select" ON companies FOR SELECT TO authenticated
  USING (id = ANY(user_company_ids()));
CREATE POLICY "companies_insert" ON companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "companies_update" ON companies FOR UPDATE TO authenticated
  USING (id = ANY(user_company_ids()))
  WITH CHECK (id = ANY(user_company_ids()));

-- ── employees ──────────────────────────────────────────────────────────────
-- Allow own record lookup (needed right after registration before company context is set)
CREATE POLICY "employees_select" ON employees FOR SELECT TO authenticated
  USING (company_id = ANY(user_company_ids()) OR user_id = auth.uid());
CREATE POLICY "employees_insert" ON employees FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "employees_update" ON employees FOR UPDATE TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));
CREATE POLICY "employees_delete" ON employees FOR DELETE TO authenticated
  USING (company_id = ANY(user_company_ids()));

-- ── company_relationships ──────────────────────────────────────────────────
CREATE POLICY "company_relationships_select" ON company_relationships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR company_id = ANY(user_company_ids()));
CREATE POLICY "company_relationships_insert" ON company_relationships FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "company_relationships_update" ON company_relationships FOR UPDATE TO authenticated
  USING (company_id = ANY(user_company_ids()));

-- ── company-scoped tables (full CRUD for members) ──────────────────────────
CREATE POLICY "clients_all" ON clients FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "sites_all" ON sites FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "units_all" ON units FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "residents_all" ON residents FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "jobs_all" ON jobs FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "job_cards_all" ON job_cards FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "job_checklist_items_all" ON job_checklist_items FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "job_codes_all" ON job_codes FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "contractors_all" ON contractors FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "contractor_member_links_all" ON contractor_member_links FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "time_punches_all" ON time_punches FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "labor_entries_all" ON labor_entries FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "leave_requests_all" ON leave_requests FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "payment_approvals_all" ON payment_approvals FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "inventory_items_all" ON inventory_items FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "inventory_usage_all" ON inventory_usage FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "assets_all" ON assets FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "compliance_entries_all" ON compliance_entries FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "incident_reports_all" ON incident_reports FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "pa_task_templates_all" ON pa_task_templates FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "pa_tasks_all" ON pa_tasks FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "workflow_form_templates_all" ON workflow_form_templates FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "workflow_form_submissions_all" ON workflow_form_submissions FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "message_threads_all" ON message_threads FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "app_messages_all" ON app_messages FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "work_teams_all" ON work_teams FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY "calendar_events_all" ON calendar_events FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));
;
