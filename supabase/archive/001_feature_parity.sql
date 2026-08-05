-- KaiFlow MAUI Feature Parity Migration
-- Run this in the Supabase SQL Editor to enable the following features:
--   - MyShifts: RSVP accept/decline
--   - HrIncidents: assign to employee
--   - Messages: company feed thread
--   - HrSettings: branch management
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Shift attendance responses (RSVP on calendar_events)
--    Stores { "<employee_id>": "accepted"|"declined"|"pending" }
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS attendance_responses JSONB DEFAULT '{}'::jsonb;

-- 2. Incident assignee
ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

-- 3. Message thread type (for company-wide feed)
ALTER TABLE message_threads
  ADD COLUMN IF NOT EXISTS type_raw TEXT NOT NULL DEFAULT 'direct';

CREATE INDEX IF NOT EXISTS idx_message_threads_type_raw
  ON message_threads (company_id, type_raw);

-- 4. Branches table
CREATE TABLE IF NOT EXISTS branches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  address        TEXT,
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  radius_meters  DOUBLE PRECISION NOT NULL DEFAULT 200,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branches_company_id ON branches (company_id);

-- Enable RLS on branches
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can read branches"
  ON branches FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM employees WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "HR can manage branches"
  ON branches FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM employees
      WHERE user_id = auth.uid()
        AND access_level IN ('owner','admin','hr_admin','hr')
    )
  );
