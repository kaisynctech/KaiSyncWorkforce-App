-- Contractor admin audit trail

CREATE TABLE IF NOT EXISTS public.contractor_admin_events (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contractor_id bigint NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  actor_employee_id bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contractor_admin_events_company_contractor
  ON public.contractor_admin_events(company_id, contractor_id, created_at DESC);

ALTER TABLE public.contractor_admin_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_contractor_admin_events_hr_company') THEN
    CREATE POLICY p_contractor_admin_events_hr_company ON public.contractor_admin_events
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
