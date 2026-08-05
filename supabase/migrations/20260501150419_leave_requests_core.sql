-- ============================================================
-- Leave Management (employee apply + HR approve)
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
      "leave":               true
    }'::jsonb;
UPDATE public.companies
SET enabled_modules = jsonb_set(
  COALESCE(enabled_modules, '{}'::jsonb),
  '{leave}',
  to_jsonb(COALESCE((enabled_modules->>'leave')::boolean, true)),
  true
);
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id                  bigserial PRIMARY KEY,
  company_id          bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id         bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type          text NOT NULL DEFAULT 'annual'
                      CHECK (leave_type IN ('annual','sick','family','unpaid','study','other')),
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  half_day_start      boolean NOT NULL DEFAULT false,
  half_day_end        boolean NOT NULL DEFAULT false,
  total_days          int NOT NULL DEFAULT 1,
  reason              text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','declined','cancelled')),
  decision_note       text,
  approver_hr_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at          timestamptz,
  payroll_synced_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_request_dates_chk CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company_status
  ON public.leave_requests(company_id, status, start_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company_employee
  ON public.leave_requests(company_id, employee_id, start_date);
CREATE TABLE IF NOT EXISTS public.leave_request_history (
  id                  bigserial PRIMARY KEY,
  company_id          bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  leave_request_id    bigint NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  actor_hr_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action              text NOT NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_request_history_request
  ON public.leave_request_history(company_id, leave_request_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.set_leave_requests_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_leave_requests_updated_at ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_updated_at
BEFORE UPDATE ON public.leave_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_leave_requests_updated_at();
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_request_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_leave_requests_hr') THEN
    CREATE POLICY p_leave_requests_hr ON public.leave_requests
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_leave_requests_employee_select') THEN
    CREATE POLICY p_leave_requests_employee_select ON public.leave_requests
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = leave_requests.company_id
            AND e.id = leave_requests.employee_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_leave_requests_employee_insert') THEN
    CREATE POLICY p_leave_requests_employee_insert ON public.leave_requests
      FOR INSERT WITH CHECK (
        status = 'pending' AND
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = leave_requests.company_id
            AND e.id = leave_requests.employee_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_leave_requests_employee_cancel') THEN
    CREATE POLICY p_leave_requests_employee_cancel ON public.leave_requests
      FOR UPDATE USING (
        status = 'pending' AND
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = leave_requests.company_id
            AND e.id = leave_requests.employee_id
            AND e.profile_id = auth.uid()
        )
      )
      WITH CHECK (
        status IN ('pending', 'cancelled') AND
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = leave_requests.company_id
            AND e.id = leave_requests.employee_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_leave_history_hr') THEN
    CREATE POLICY p_leave_history_hr ON public.leave_request_history
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_leave_history_employee_select') THEN
    CREATE POLICY p_leave_history_employee_select ON public.leave_request_history
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM public.leave_requests lr
          JOIN public.employees e ON e.id = lr.employee_id AND e.company_id = lr.company_id
          WHERE lr.id = leave_request_history.leave_request_id
            AND lr.company_id = leave_request_history.company_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
CREATE OR REPLACE VIEW public.v_payroll_leave_approved
WITH (security_invoker = true)
AS
SELECT
  lr.id,
  lr.company_id,
  lr.employee_id,
  e.name,
  e.surname,
  e.employee_code,
  lr.leave_type,
  lr.start_date,
  lr.end_date,
  lr.total_days,
  lr.status,
  lr.decided_at,
  lr.payroll_synced_at
FROM public.leave_requests lr
JOIN public.employees e
  ON e.id = lr.employee_id
 AND e.company_id = lr.company_id
WHERE lr.status = 'approved';
