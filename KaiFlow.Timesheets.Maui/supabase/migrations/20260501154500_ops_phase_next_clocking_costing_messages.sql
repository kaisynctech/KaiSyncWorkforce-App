-- ============================================================
-- Phase: Manager clocking + job-code labor capture + messaging
-- ============================================================

ALTER TABLE public.companies
  ALTER COLUMN enabled_modules SET DEFAULT
    '{
      "ticketing":           true,
      "scheduling":          true,
      "payroll":             true,
      "paperless":           true,
      "compliance":          true,
      "contractors":         true,
      "property_management": true,
      "asset_compliance":    true,
      "reporting_external":  true,
      "my_pa":               true,
      "leave":               true,
      "messaging":           true
    }'::jsonb;
UPDATE public.companies
SET enabled_modules = jsonb_set(
  COALESCE(enabled_modules, '{}'::jsonb),
  '{messaging}',
  to_jsonb(COALESCE((enabled_modules->>'messaging')::boolean, true)),
  true
);
CREATE TABLE IF NOT EXISTS public.job_codes (
  id                bigserial PRIMARY KEY,
  company_id        bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code              text NOT NULL,
  title             text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  default_hourly_rate numeric(12,2),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_job_codes_company_code UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_job_codes_company_active
  ON public.job_codes(company_id, is_active);
CREATE TABLE IF NOT EXISTS public.labor_time_entries (
  id                bigserial PRIMARY KEY,
  company_id        bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id       bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  job_id            bigint NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  job_code_id       bigint REFERENCES public.job_codes(id) ON DELETE SET NULL,
  work_date         date NOT NULL,
  hours             numeric(10,2) NOT NULL CHECK (hours > 0),
  hourly_rate       numeric(12,2),
  source_type       text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','manager_bulk_clock')),
  source_ref        text,
  notes             text,
  created_by_hr_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_labor_entries_company_job
  ON public.labor_time_entries(company_id, job_id, work_date);
CREATE INDEX IF NOT EXISTS idx_labor_entries_company_employee
  ON public.labor_time_entries(company_id, employee_id, work_date);
CREATE OR REPLACE VIEW public.v_job_labor_rollup
WITH (security_invoker = true)
AS
SELECT
  l.company_id,
  l.job_id,
  SUM(l.hours)::numeric(12,2) AS total_hours,
  SUM(l.hours * COALESCE(l.hourly_rate, e.hourly_rate, 0))::numeric(12,2) AS total_labor_cost
FROM public.labor_time_entries l
JOIN public.employees e
  ON e.id = l.employee_id
 AND e.company_id = l.company_id
GROUP BY l.company_id, l.job_id;
CREATE OR REPLACE FUNCTION public.sync_job_labor_cost_from_entries()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.jobs j
  SET
    labor_cost = r.total_labor_cost,
    actual_cost = COALESCE(j.inventory_cost, 0) + COALESCE(r.total_labor_cost, 0) + COALESCE(j.other_cost, 0)
  FROM (
    SELECT company_id, job_id, SUM(hours * COALESCE(hourly_rate, 0))::numeric(12,2) AS total_labor_cost
    FROM public.labor_time_entries
    WHERE company_id = COALESCE(NEW.company_id, OLD.company_id)
      AND job_id = COALESCE(NEW.job_id, OLD.job_id)
    GROUP BY company_id, job_id
  ) r
  WHERE j.company_id = r.company_id
    AND j.id = r.job_id;

  UPDATE public.jobs
  SET
    labor_cost = NULL,
    actual_cost = COALESCE(inventory_cost, 0) + COALESCE(other_cost, 0)
  WHERE company_id = COALESCE(NEW.company_id, OLD.company_id)
    AND id = COALESCE(NEW.job_id, OLD.job_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.labor_time_entries l
      WHERE l.company_id = COALESCE(NEW.company_id, OLD.company_id)
        AND l.job_id = COALESCE(NEW.job_id, OLD.job_id)
    );

  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_job_labor_cost_ins ON public.labor_time_entries;
CREATE TRIGGER trg_sync_job_labor_cost_ins
AFTER INSERT ON public.labor_time_entries
FOR EACH ROW
EXECUTE FUNCTION public.sync_job_labor_cost_from_entries();
DROP TRIGGER IF EXISTS trg_sync_job_labor_cost_upd ON public.labor_time_entries;
CREATE TRIGGER trg_sync_job_labor_cost_upd
AFTER UPDATE ON public.labor_time_entries
FOR EACH ROW
EXECUTE FUNCTION public.sync_job_labor_cost_from_entries();
DROP TRIGGER IF EXISTS trg_sync_job_labor_cost_del ON public.labor_time_entries;
CREATE TRIGGER trg_sync_job_labor_cost_del
AFTER DELETE ON public.labor_time_entries
FOR EACH ROW
EXECUTE FUNCTION public.sync_job_labor_cost_from_entries();
CREATE TABLE IF NOT EXISTS public.app_messages (
  id                bigserial PRIMARY KEY,
  company_id        bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sender_employee_id bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  sender_hr_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_messages_sender_chk CHECK (
    sender_employee_id IS NOT NULL OR sender_hr_user_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_app_messages_company_time
  ON public.app_messages(company_id, created_at DESC);
ALTER TABLE public.job_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_job_codes_hr') THEN
    CREATE POLICY p_job_codes_hr ON public.job_codes
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_labor_entries_hr') THEN
    CREATE POLICY p_labor_entries_hr ON public.labor_time_entries
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_messages_hr') THEN
    CREATE POLICY p_messages_hr ON public.app_messages
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_messages_employee_select') THEN
    CREATE POLICY p_messages_employee_select ON public.app_messages
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = app_messages.company_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_messages_employee_insert') THEN
    CREATE POLICY p_messages_employee_insert ON public.app_messages
      FOR INSERT WITH CHECK (
        sender_employee_id IS NOT NULL
        AND sender_hr_user_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = app_messages.company_id
            AND e.id = app_messages.sender_employee_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
