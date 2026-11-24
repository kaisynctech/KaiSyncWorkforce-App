-- Phase 3: service plans. A plan says "service this client's site/area every N months, rotating through
-- services (e.g. Minor, Minor, Major)". Jobs are created automatically a few days before they are due
-- (daily at 05:15 SAST), or on demand with the "Create due jobs" button.

CREATE TABLE IF NOT EXISTS public.service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  area_id uuid REFERENCES public.site_areas(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  service_ids uuid[] NOT NULL CHECK (cardinality(service_ids) BETWEEN 1 AND 12),
  interval_months integer NOT NULL DEFAULT 1 CHECK (interval_months BETWEEN 1 AND 24),
  first_due date NOT NULL,
  visits_created integer NOT NULL DEFAULT 0 CHECK (visits_created >= 0),
  next_due date NOT NULL,
  lead_days integer NOT NULL DEFAULT 7 CHECK (lead_days BETWEEN 0 AND 90),
  start_time time NOT NULL DEFAULT '08:00',
  employee_ids uuid[] NOT NULL DEFAULT '{}',
  include_equipment boolean NOT NULL DEFAULT true,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  is_active boolean NOT NULL DEFAULT true,
  last_generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_plans_company_idx ON public.service_plans (company_id, is_active, next_due);
CREATE INDEX IF NOT EXISTS service_plans_client_idx ON public.service_plans (client_id);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS service_plan_id uuid REFERENCES public.service_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_due_date date;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_plan_visit_key ON public.jobs (service_plan_id, plan_due_date);

-- Plan rules: client, site, area and services all belong to the company and fit together.
-- next_due is always first_due + visits_created × interval (no month-end drift).
CREATE OR REPLACE FUNCTION public._service_plan_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = NEW.client_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'CLIENT_NOT_IN_COMPANY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = NEW.site_id AND company_id = NEW.company_id AND client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'SITE_NOT_FOR_CLIENT';
  END IF;
  IF NEW.area_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.site_areas WHERE id = NEW.area_id AND site_id = NEW.site_id) THEN
    RAISE EXCEPTION 'AREA_NOT_IN_SITE';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.service_ids) s(id)
             WHERE NOT EXISTS (SELECT 1 FROM public.job_services j WHERE j.id = s.id AND j.company_id = NEW.company_id)) THEN
    RAISE EXCEPTION 'SERVICE_NOT_IN_COMPANY';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.employee_ids) e(id)
             WHERE NOT EXISTS (SELECT 1 FROM public.employees x WHERE x.id = e.id AND x.company_id = NEW.company_id)) THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_IN_COMPANY';
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.next_due := (NEW.first_due + make_interval(months => NEW.interval_months * NEW.visits_created))::date;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER service_plans_check BEFORE INSERT OR UPDATE ON public.service_plans
  FOR EACH ROW EXECUTE FUNCTION public._service_plan_check();

ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_plans_select ON public.service_plans FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids())
    AND (public.user_has_permission(company_id, 'jobs.view') OR public.user_has_permission(company_id, 'clients.view')));
CREATE POLICY service_plans_insert ON public.service_plans FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.create'));
CREATE POLICY service_plans_update ON public.service_plans FOR UPDATE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));
CREATE POLICY service_plans_remove ON public.service_plans FOR DELETE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));

-- Creates the jobs that are due (next_due − lead_days ≤ today), at most 12 visits per plan per run.
-- Signed-in users: their own company, needs jobs.create. Scheduler (no user): every company.
CREATE OR REPLACE FUNCTION public.generate_due_plan_jobs(p_company_id uuid DEFAULT NULL, p_plan_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  v_role text := coalesce(auth.role(), '');
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_plan public.service_plans%ROWTYPE;
  v_service public.job_services%ROWTYPE;
  v_job uuid;
  v_area_path text;
  v_site_name text;
  v_start timestamptz;
  v_made integer := 0;
  v_loops integer;
BEGIN
  IF v_role = 'anon' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
       OR NOT public.user_has_permission(p_company_id, 'jobs.create') THEN
      RAISE EXCEPTION 'UNAUTHORIZED';
    END IF;
  END IF;

  FOR v_plan IN
    SELECT * FROM public.service_plans p
    WHERE p.is_active
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (p_plan_id IS NULL OR p.id = p_plan_id)
      AND p.next_due - p.lead_days <= v_today
    ORDER BY p.next_due
    FOR UPDATE SKIP LOCKED
  LOOP
    v_loops := 0;
    SELECT name INTO v_site_name FROM public.sites WHERE id = v_plan.site_id;
    SELECT CASE WHEN pa.name IS NOT NULL THEN pa.name || ' › ' || a.name ELSE a.name END INTO v_area_path
      FROM public.site_areas a LEFT JOIN public.site_areas pa ON pa.id = a.parent_area_id WHERE a.id = v_plan.area_id;

    WHILE v_plan.next_due - v_plan.lead_days <= v_today AND v_loops < 12 LOOP
      v_loops := v_loops + 1;
      v_job := NULL;
      SELECT * INTO v_service FROM public.job_services
        WHERE id = v_plan.service_ids[1 + (v_plan.visits_created % cardinality(v_plan.service_ids))];
      v_start := (v_plan.next_due + v_plan.start_time) AT TIME ZONE 'Africa/Johannesburg';

      INSERT INTO public.jobs (company_id, title, description, status, client_id, site_id, area_id, service_id,
                               scheduled_start, scheduled_end, estimated_cost, job_code,
                               assignee_employee_id, assigned_employee_ids, service_plan_id, plan_due_date)
      VALUES (
        v_plan.company_id,
        left(coalesce(v_service.name, 'Service') || ' – ' || coalesce(v_area_path, v_site_name, v_plan.name), 200),
        nullif(concat_ws(E'\n', 'Service plan: ' || v_plan.name, v_plan.notes), ''),
        'scheduled', v_plan.client_id, v_plan.site_id, v_plan.area_id, v_service.id,
        v_start,
        v_start + make_interval(mins => coalesce(v_service.default_duration_minutes, 60)),
        coalesce((SELECT agreed_price FROM public.client_job_services c WHERE c.client_id = v_plan.client_id AND c.service_id = v_service.id),
                 v_service.default_price, 0),
        public._next_job_code(v_plan.company_id),
        v_plan.employee_ids[1], v_plan.employee_ids, v_plan.id, v_plan.next_due)
      ON CONFLICT (service_plan_id, plan_due_date) DO NOTHING
      RETURNING id INTO v_job;

      IF v_job IS NOT NULL THEN
        v_made := v_made + 1;
        INSERT INTO public.job_checklist_items (company_id, job_id, description, is_checked, sort_order)
        SELECT v_plan.company_id, v_job, btrim(step), false, (ord - 1)::int
        FROM jsonb_array_elements_text(coalesce(v_service.checklist, '[]'::jsonb)) WITH ORDINALITY AS t(step, ord)
        WHERE btrim(step) <> '';
        IF v_plan.include_equipment AND v_plan.area_id IS NOT NULL THEN
          INSERT INTO public.job_assets (company_id, job_id, asset_id)
          WITH RECURSIVE inside(id) AS (
            SELECT v_plan.area_id
            UNION SELECT a.id FROM public.site_areas a JOIN inside i ON a.parent_area_id = i.id
          )
          SELECT v_plan.company_id, v_job, x.id FROM public.assets x
          WHERE x.company_id = v_plan.company_id AND x.status = 'active' AND x.area_id IN (SELECT id FROM inside)
          ON CONFLICT (job_id, asset_id) DO NOTHING;
        END IF;
      END IF;

      UPDATE public.service_plans SET visits_created = visits_created + 1, last_generated_at = now()
        WHERE id = v_plan.id RETURNING * INTO v_plan;
    END LOOP;
  END LOOP;
  RETURN v_made;
END $$;

SELECT cron.schedule('service-plans-daily', '15 3 * * *', 'SELECT public.generate_due_plan_jobs()');
