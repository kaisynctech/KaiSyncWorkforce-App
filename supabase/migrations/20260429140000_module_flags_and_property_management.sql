-- ============================================================
-- Day 2 — Module flags + Property management schema
-- Adds enabled_modules to companies; introduces issue_categories,
-- sla_targets, units, residents, job_feedback; extends jobs with
-- priority/cost/SLA/timestamp/assignment columns; seeds defaults.
-- ============================================================

-- 1. Module flags on companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT
    '{
      "ticketing":           true,
      "scheduling":          true,
      "payroll":             true,
      "paperless":           true,
      "compliance":          true,
      "contractors":         false,
      "property_management": false,
      "asset_compliance":    false,
      "reporting_external":  false
    }'::jsonb;

-- 2. Issue categories per company
CREATE TABLE IF NOT EXISTS public.issue_categories (
  id          bigserial PRIMARY KEY,
  company_id  bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text,
  sort_order  int DEFAULT 100,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_categories_company_name
  ON public.issue_categories(company_id, lower(name));
ALTER TABLE public.issue_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_issue_categories_all_hr_company') THEN
    CREATE POLICY p_issue_categories_all_hr_company ON public.issue_categories
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

-- 3. SLA targets per priority per company
CREATE TABLE IF NOT EXISTS public.sla_targets (
  id                bigserial PRIMARY KEY,
  company_id        bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  priority          text NOT NULL CHECK (priority IN ('critical','high','medium','low')),
  response_minutes  int NOT NULL,
  resolution_hours  int NOT NULL,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (company_id, priority)
);
ALTER TABLE public.sla_targets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_sla_targets_all_hr_company') THEN
    CREATE POLICY p_sla_targets_all_hr_company ON public.sla_targets
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

-- 4. Units (sub-property within sites)
CREATE TABLE IF NOT EXISTS public.units (
  id                bigserial PRIMARY KEY,
  company_id        bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id           bigint REFERENCES public.sites(id) ON DELETE CASCADE,
  unit_number       text NOT NULL,
  label             text,
  occupancy_status  text DEFAULT 'occupied'
                    CHECK (occupancy_status IN ('occupied','vacant','reserved','off_market')),
  floor             text,
  notes             text,
  created_at        timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_units_site_number
  ON public.units(site_id, lower(unit_number));
CREATE INDEX IF NOT EXISTS idx_units_company_id ON public.units(company_id);
CREATE INDEX IF NOT EXISTS idx_units_site_id    ON public.units(site_id);
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_units_all_hr_company') THEN
    CREATE POLICY p_units_all_hr_company ON public.units
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

-- 5. Residents
CREATE TABLE IF NOT EXISTS public.residents (
  id            bigserial PRIMARY KEY,
  company_id    bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id       bigint REFERENCES public.units(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  phone         text,
  email         text,
  move_in_date  date,
  move_out_date date,
  is_primary    boolean DEFAULT true,
  notes         text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_residents_unit_id    ON public.residents(unit_id);
CREATE INDEX IF NOT EXISTS idx_residents_company_id ON public.residents(company_id);
CREATE INDEX IF NOT EXISTS idx_residents_email      ON public.residents(lower(email)) WHERE email IS NOT NULL;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_residents_all_hr_company') THEN
    CREATE POLICY p_residents_all_hr_company ON public.residents
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

-- 6. Job feedback (post-closure)
CREATE TABLE IF NOT EXISTS public.job_feedback (
  id              bigserial PRIMARY KEY,
  company_id      bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id          bigint REFERENCES public.jobs(id) ON DELETE CASCADE,
  resident_id     bigint REFERENCES public.residents(id) ON DELETE SET NULL,
  rating_1_to_5   smallint CHECK (rating_1_to_5 BETWEEN 1 AND 5),
  comments        text,
  channel         text,
  submitted_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_feedback_job ON public.job_feedback(job_id);
ALTER TABLE public.job_feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_job_feedback_all_hr_company') THEN
    CREATE POLICY p_job_feedback_all_hr_company ON public.job_feedback
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

-- 7. Extend jobs with maintenance/SLA/cost fields
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS priority               text,
  ADD COLUMN IF NOT EXISTS issue_category_id      bigint REFERENCES public.issue_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id                bigint REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reporter_resident_id   bigint REFERENCES public.residents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opened_at              timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at      timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at              timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_cost         numeric(12,2),
  ADD COLUMN IF NOT EXISTS actual_cost            numeric(12,2),
  ADD COLUMN IF NOT EXISTS assignee_employee_id   bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contractor_employee_id bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_callback            boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_preventive          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_job_id          bigint REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sla_target_id          bigint REFERENCES public.sla_targets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_ref           text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_priority_chk') THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_priority_chk
      CHECK (priority IS NULL OR priority IN ('critical','high','medium','low'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_priority      ON public.jobs(priority);
CREATE INDEX IF NOT EXISTS idx_jobs_unit_id       ON public.jobs(unit_id);
CREATE INDEX IF NOT EXISTS idx_jobs_category      ON public.jobs(issue_category_id);
CREATE INDEX IF NOT EXISTS idx_jobs_assignee      ON public.jobs(assignee_employee_id);
CREATE INDEX IF NOT EXISTS idx_jobs_opened_at     ON public.jobs(opened_at);
CREATE INDEX IF NOT EXISTS idx_jobs_closed_at     ON public.jobs(closed_at);
CREATE INDEX IF NOT EXISTS idx_jobs_external_ref  ON public.jobs(external_ref) WHERE external_ref IS NOT NULL;

-- 8. Seed default SLA targets and issue categories for each existing company
INSERT INTO public.sla_targets (company_id, priority, response_minutes, resolution_hours)
SELECT c.id, p.priority, p.response_minutes, p.resolution_hours
FROM public.companies c
CROSS JOIN (VALUES
  ('critical', 240,  24),
  ('high',    1440,  72),
  ('medium',  2880, 168),
  ('low',     4320, 336)
) AS p(priority, response_minutes, resolution_hours)
ON CONFLICT (company_id, priority) DO NOTHING;

INSERT INTO public.issue_categories (company_id, name, slug, sort_order)
SELECT c.id, x.name, x.slug, x.sort_order
FROM public.companies c
CROSS JOIN (VALUES
  ('Plumbing',           'plumbing',          10),
  ('Electrical',         'electrical',        20),
  ('Geyser / Hot water', 'geyser',            30),
  ('Fire safety',        'fire_safety',       40),
  ('Lift / Elevator',    'lift',              50),
  ('HVAC',               'hvac',              60),
  ('Structural',         'structural',        70),
  ('Doors / Windows',    'doors_windows',     80),
  ('Pest control',       'pest_control',      90),
  ('Cleaning',           'cleaning',         100),
  ('Other',              'other',            999)
) AS x(name, slug, sort_order)
ON CONFLICT DO NOTHING;
