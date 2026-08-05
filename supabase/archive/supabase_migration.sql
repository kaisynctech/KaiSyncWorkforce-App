-- =====================================================================
-- KaiFlow Timesheets — Full UUID Schema Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run All
-- =====================================================================

-- ─── Helper: returns all company UUIDs the current user belongs to ───
CREATE OR REPLACE FUNCTION user_company_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(company_id), '{}')
  FROM company_relationships
  WHERE user_id = auth.uid() AND is_active = true;
$$;

-- ─── companies ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL,
  name                text NOT NULL,
  plan_code           text,
  subscription_active boolean NOT NULL DEFAULT true,
  trial_started_at    timestamptz,
  enabled_modules     jsonb NOT NULL DEFAULT '{}',
  custom_settings     jsonb NOT NULL DEFAULT '{}',
  owner_user_id       uuid NOT NULL,
  contact_email       text,
  contact_phone       text,
  address             text,
  logo_url            text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── company_relationships ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_relationships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'employee',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── employees ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  surname           text NOT NULL DEFAULT '',
  employee_code     text,
  employment_type   text NOT NULL DEFAULT 'permanent',
  access_level      text NOT NULL DEFAULT 'employee',
  worker_type       text,
  position          text,
  branch            text,
  employment_date   date,
  hourly_rate       float8 NOT NULL DEFAULT 0,
  daily_rate        float8 NOT NULL DEFAULT 0,
  weekly_rate       float8 NOT NULL DEFAULT 0,
  monthly_salary    float8 NOT NULL DEFAULT 0,
  overtime_rate     float8 NOT NULL DEFAULT 0,
  double_time_rate  float8 NOT NULL DEFAULT 0,
  daily_hours       float8 NOT NULL DEFAULT 8,
  work_days_weekly  int NOT NULL DEFAULT 5,
  email             text,
  phone             text,
  manager_user_id   uuid,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id           uuid,
  is_active         boolean NOT NULL DEFAULT true,
  profile_photo_url text,
  id_number         text,
  bank_account      text,
  bank_name         text,
  bank_branch_code  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── clients ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  type                 text,
  contact_person       text,
  phone                text,
  email                text,
  address              text,
  notes                text,
  linked_company_id    uuid,
  source_contractor_id uuid,
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── sites ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id),
  name          text NOT NULL,
  address       text,
  latitude      float8,
  longitude     float8,
  notes         text,
  radius_meters float8 NOT NULL DEFAULT 200,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── units ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  unit_number text NOT NULL,
  address     text,
  floor       int,
  unit_type   text,
  is_occupied boolean NOT NULL DEFAULT false,
  notes       text,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── residents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS residents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  unit_id       uuid REFERENCES units(id),
  name          text NOT NULL,
  surname       text,
  phone         text,
  email         text,
  move_in_date  date,
  move_out_date date,
  notes         text,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── assets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid REFERENCES sites(id),
  unit_id          uuid REFERENCES units(id),
  asset_type       text NOT NULL,
  label            text,
  manufacturer     text,
  model_number     text,
  serial_number    text,
  install_date     date,
  warranty_expires date,
  status           text NOT NULL DEFAULT 'active',
  notes            text,
  photo_urls       text[] NOT NULL DEFAULT '{}',
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── job_codes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── jobs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                  text NOT NULL,
  description            text,
  client_id              uuid REFERENCES clients(id),
  site_id                uuid REFERENCES sites(id),
  unit_id                uuid REFERENCES units(id),
  scheduled_start        timestamptz,
  scheduled_end          timestamptz,
  status                 text NOT NULL DEFAULT 'scheduled',
  priority               text NOT NULL DEFAULT 'none',
  opened_at              timestamptz,
  first_response_at      timestamptz,
  closed_at              timestamptz,
  assignee_employee_id   uuid REFERENCES employees(id),
  assigned_employee_ids  uuid[] NOT NULL DEFAULT '{}',
  contractor_employee_id uuid,
  estimated_cost         float8 NOT NULL DEFAULT 0,
  actual_cost            float8 NOT NULL DEFAULT 0,
  inventory_cost         float8 NOT NULL DEFAULT 0,
  labor_cost             float8 NOT NULL DEFAULT 0,
  is_callback            boolean NOT NULL DEFAULT false,
  is_preventive          boolean NOT NULL DEFAULT false,
  parent_job_id          uuid REFERENCES jobs(id),
  external_ref           text,
  site_radius_mode       boolean NOT NULL DEFAULT false,
  site_radius_meters     float8 NOT NULL DEFAULT 200,
  resident_reporter      text,
  photo_urls             text[] NOT NULL DEFAULT '{}',
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ─── job_cards ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_cards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                 uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id            uuid REFERENCES employees(id),
  work_performed         text,
  materials_used         text,
  client_signature_url   text,
  employee_signature_url text,
  client_name_signed     text,
  photo_urls             text[] NOT NULL DEFAULT '{}',
  checklist_items        jsonb NOT NULL DEFAULT '[]',
  start_time             timestamptz,
  end_time               timestamptz,
  is_completed           boolean NOT NULL DEFAULT false,
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ─── job_checklist_items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description text NOT NULL,
  is_checked  boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
);

-- ─── time_punches ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_punches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  type        text NOT NULL,
  date_time   timestamptz NOT NULL DEFAULT now(),
  latitude    float8,
  longitude   float8,
  address     text,
  job_id      uuid REFERENCES jobs(id),
  notes       text,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── labor_entries ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  job_id      uuid REFERENCES jobs(id),
  job_code_id uuid REFERENCES job_codes(id),
  work_date   date NOT NULL,
  hours       float8 NOT NULL DEFAULT 0,
  hourly_rate float8 NOT NULL DEFAULT 0,
  source_type text,
  notes       text,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── leave_requests ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES employees(id),
  leave_type          text NOT NULL,
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  half_day_start      boolean NOT NULL DEFAULT false,
  half_day_end        boolean NOT NULL DEFAULT false,
  total_days          float8 NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pending',
  reason              text,
  decision_note       text,
  approver_hr_user_id uuid,
  decided_at          timestamptz,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── incident_reports ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incident_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL REFERENCES employees(id),
  job_id           uuid REFERENCES jobs(id),
  site_id          uuid REFERENCES sites(id),
  description      text NOT NULL,
  severity         text NOT NULL DEFAULT 'low',
  photo_urls       text[] NOT NULL DEFAULT '{}',
  is_closed        boolean NOT NULL DEFAULT false,
  resolution_notes text,
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── inventory_items ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  sku              text,
  description      text,
  unit_of_measure  text,
  unit_cost        float8 NOT NULL DEFAULT 0,
  selling_price    float8 NOT NULL DEFAULT 0,
  quantity_on_hand float8 NOT NULL DEFAULT 0,
  reorder_level    float8 NOT NULL DEFAULT 0,
  supplier         text,
  is_active        boolean NOT NULL DEFAULT true,
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── inventory_usage ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_usage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  job_id            uuid REFERENCES jobs(id),
  employee_id       uuid REFERENCES employees(id),
  quantity_used     float8 NOT NULL DEFAULT 0,
  unit_cost_at_use  float8 NOT NULL DEFAULT 0,
  notes             text,
  used_at           timestamptz NOT NULL DEFAULT now(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
);

-- ─── payment_approvals ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  regular_hours  float8 NOT NULL DEFAULT 0,
  overtime_hours float8 NOT NULL DEFAULT 0,
  gross_pay      float8 NOT NULL DEFAULT 0,
  deductions     float8 NOT NULL DEFAULT 0,
  net_pay        float8 NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending',
  approved_by    uuid,
  approved_at    timestamptz,
  paid_at        timestamptz,
  notes          text,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── contractors ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  registration_number text,
  contact_person      text,
  phone               text,
  email               text,
  address             text,
  bank_account        text,
  bank_name           text,
  bank_branch_code    text,
  rating              float8 NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── contractor_member_links ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_member_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id),
  role          text,
  is_primary    boolean NOT NULL DEFAULT false,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── work_teams ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_teams (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  description        text,
  leader_employee_id uuid REFERENCES employees(id),
  member_ids         uuid[] NOT NULL DEFAULT '{}',
  is_active          boolean NOT NULL DEFAULT true,
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── message_threads ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_threads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject              text,
  participant_ids      uuid[] NOT NULL DEFAULT '{}',
  last_message_at      timestamptz,
  last_message_preview text,
  is_archived          boolean NOT NULL DEFAULT false,
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── app_messages ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL,
  body            text NOT NULL,
  attachment_urls text[] NOT NULL DEFAULT '{}',
  read_by_ids     uuid[] NOT NULL DEFAULT '{}',
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── pa_task_templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pa_task_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  default_priority text NOT NULL DEFAULT 'medium',
  recurrence_rule  text,
  is_active        boolean NOT NULL DEFAULT true,
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── pa_tasks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pa_tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL,
  description          text,
  status               text NOT NULL DEFAULT 'pending',
  priority             text NOT NULL DEFAULT 'medium',
  site_id              uuid REFERENCES sites(id),
  unit_id              uuid REFERENCES units(id),
  assigned_employee_id uuid REFERENCES employees(id),
  template_id          uuid REFERENCES pa_task_templates(id),
  due_date             date,
  completed_at         timestamptz,
  photo_urls           text[] NOT NULL DEFAULT '{}',
  notes                text,
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── compliance_entries ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid REFERENCES sites(id),
  asset_id           uuid REFERENCES assets(id),
  compliance_type    text NOT NULL,
  certificate_number text,
  issued_date        date,
  expiry_date        date,
  issued_by          text,
  document_url       text,
  notes              text,
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── workflow_form_templates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_form_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  fields      jsonb NOT NULL DEFAULT '[]',
  is_active   boolean NOT NULL DEFAULT true,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── workflow_form_submissions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_form_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid REFERENCES workflow_form_templates(id),
  submitted_by uuid,
  job_id       uuid REFERENCES jobs(id),
  site_id      uuid REFERENCES sites(id),
  data         jsonb NOT NULL DEFAULT '{}',
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

-- ─── calendar_events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  start_time    timestamptz NOT NULL,
  end_time      timestamptz,
  is_all_day    boolean NOT NULL DEFAULT false,
  attendee_ids  uuid[] NOT NULL DEFAULT '{}',
  location      text,
  event_type    text,
  linked_job_id uuid REFERENCES jobs(id),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Row Level Security
-- =====================================================================

ALTER TABLE companies                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_relationships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE units                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE residents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_codes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_cards                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_checklist_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_punches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_usage           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors               ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_member_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_teams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_task_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_tasks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_form_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events           ENABLE ROW LEVEL SECURITY;

-- ─── Policies: companies ─────────────────────────────────────────────
CREATE POLICY "companies_select" ON companies
  FOR SELECT USING (id = ANY(user_company_ids()) OR owner_user_id = auth.uid());
CREATE POLICY "companies_insert" ON companies
  FOR INSERT WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "companies_update" ON companies
  FOR UPDATE USING (id = ANY(user_company_ids()));

-- ─── Policies: company_relationships ────────────────────────────────
CREATE POLICY "company_relationships_select" ON company_relationships
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "company_relationships_insert" ON company_relationships
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "company_relationships_update" ON company_relationships
  FOR UPDATE USING (user_id = auth.uid());

-- ─── Policies: employees ─────────────────────────────────────────────
CREATE POLICY "employees_select" ON employees
  FOR SELECT USING (company_id = ANY(user_company_ids()) OR user_id = auth.uid());
CREATE POLICY "employees_insert" ON employees
  FOR INSERT WITH CHECK (company_id = ANY(user_company_ids()));
CREATE POLICY "employees_update" ON employees
  FOR UPDATE USING (company_id = ANY(user_company_ids()));
CREATE POLICY "employees_delete" ON employees
  FOR DELETE USING (company_id = ANY(user_company_ids()));

-- ─── Policies: all other tables (company_id-scoped) ──────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'clients','sites','units','residents','assets','job_codes',
    'jobs','job_cards','job_checklist_items','time_punches',
    'labor_entries','leave_requests','incident_reports',
    'inventory_items','inventory_usage','payment_approvals',
    'contractors','contractor_member_links','work_teams',
    'message_threads','app_messages','pa_task_templates','pa_tasks',
    'compliance_entries','workflow_form_templates',
    'workflow_form_submissions','calendar_events'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "%1$s_select" ON %1$s FOR SELECT USING (company_id = ANY(user_company_ids()))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "%1$s_insert" ON %1$s FOR INSERT WITH CHECK (company_id = ANY(user_company_ids()))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "%1$s_update" ON %1$s FOR UPDATE USING (company_id = ANY(user_company_ids()))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "%1$s_delete" ON %1$s FOR DELETE USING (company_id = ANY(user_company_ids()))',
      tbl
    );
  END LOOP;
END;
$$;

-- =====================================================================
-- Trigger: auto-create company_relationship when company is inserted
-- so GetUserCompaniesAsync() works immediately after registration
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_auto_company_relationship()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO company_relationships (user_id, company_id, role, is_active)
  VALUES (NEW.owner_user_id, NEW.id, 'owner', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_company_relationship
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION fn_auto_company_relationship();
