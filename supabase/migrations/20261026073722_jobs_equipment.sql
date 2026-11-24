-- Phase 2: equipment inside client areas, ticked on job cards, with per-unit service history.
-- Additive only: new columns on assets, one new table, one extra permissive select policy, two worker RPCs.

-- 1. Equipment gets an area, a quantity and a size/capacity.
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.site_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  ADD COLUMN IF NOT EXISTS capacity text CHECK (capacity IS NULL OR char_length(capacity) <= 80);

CREATE INDEX IF NOT EXISTS assets_area_idx ON public.assets (area_id) WHERE area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_company_site_idx ON public.assets (company_id, site_id);

CREATE OR REPLACE FUNCTION public._asset_area_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_site uuid; v_company uuid;
BEGIN
  IF NEW.area_id IS NULL THEN RETURN NEW; END IF;
  SELECT site_id, company_id INTO v_site, v_company FROM public.site_areas WHERE id = NEW.area_id;
  IF v_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'AREA_NOT_IN_COMPANY'; END IF;
  IF NEW.site_id IS NULL THEN NEW.site_id := v_site;
  ELSIF NEW.site_id <> v_site THEN RAISE EXCEPTION 'AREA_NOT_IN_SITE'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER assets_area_check BEFORE INSERT OR UPDATE OF area_id, site_id, company_id
  ON public.assets FOR EACH ROW EXECUTE FUNCTION public._asset_area_check();

-- People who can see jobs can see the equipment on them (the existing assets.view policy stays).
CREATE POLICY assets_select_for_jobs ON public.assets FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.view'));

-- 2. Which units were serviced on a job.
CREATE TABLE IF NOT EXISTS public.job_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'not_done')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  done_at timestamptz,
  done_by_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, asset_id)
);
CREATE INDEX IF NOT EXISTS job_assets_asset_idx ON public.job_assets (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_assets_company_idx ON public.job_assets (company_id);

CREATE OR REPLACE FUNCTION public._job_asset_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = NEW.job_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'JOB_NOT_IN_COMPANY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id = NEW.asset_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'ASSET_NOT_IN_COMPANY';
  END IF;
  IF NEW.status = 'pending' THEN NEW.done_at := NULL;
  ELSIF NEW.done_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN NEW.done_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER job_assets_check BEFORE INSERT OR UPDATE ON public.job_assets
  FOR EACH ROW EXECUTE FUNCTION public._job_asset_check();

ALTER TABLE public.job_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_assets_select ON public.job_assets FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids())
    AND (public.user_has_permission(company_id, 'jobs.view') OR public.user_has_permission(company_id, 'assets.view')));
CREATE POLICY job_assets_insert ON public.job_assets FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (public.user_company_ids())
    AND (public.user_has_permission(company_id, 'jobs.create') OR public.user_has_permission(company_id, 'jobs.edit')));
CREATE POLICY job_assets_update ON public.job_assets FOR UPDATE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));
CREATE POLICY job_assets_remove ON public.job_assets FOR DELETE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));

-- 3. Technician (code-login) access, same pattern as the checklist functions.
CREATE OR REPLACE FUNCTION public.employee_get_job_equipment(
  p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_session_token text DEFAULT NULL)
RETURNS TABLE (id uuid, asset_id uuid, label text, asset_type text, manufacturer text, model_number text,
  capacity text, quantity integer, area_name text, status text, notes text, done_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;
  RETURN QUERY
    SELECT ja.id, a.id, a.label, a.asset_type, a.manufacturer, a.model_number, a.capacity, a.quantity,
      CASE WHEN pa.name IS NOT NULL THEN pa.name || ' › ' || ar.name ELSE ar.name END,
      ja.status, ja.notes, ja.done_at
    FROM public.job_assets ja
    JOIN public.assets a ON a.id = ja.asset_id
    LEFT JOIN public.site_areas ar ON ar.id = a.area_id
    LEFT JOIN public.site_areas pa ON pa.id = ar.parent_area_id
    WHERE ja.job_id = p_job_id AND ja.company_id = p_company_id
    ORDER BY pa.name NULLS FIRST, ar.name NULLS FIRST, a.asset_type, a.label;
END $$;

CREATE OR REPLACE FUNCTION public.employee_set_job_equipment_status(
  p_company_id uuid, p_employee_id uuid, p_job_asset_id uuid, p_status text,
  p_notes text DEFAULT NULL, p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_job uuid;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF p_status NOT IN ('pending', 'done', 'not_done') THEN RAISE EXCEPTION 'BAD_STATUS'; END IF;
  SELECT job_id INTO v_job FROM public.job_assets WHERE id = p_job_asset_id AND company_id = p_company_id;
  IF v_job IS NULL THEN RAISE EXCEPTION 'EQUIPMENT_NOT_FOUND'; END IF;
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, v_job) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;
  UPDATE public.job_assets
     SET status = p_status,
         notes = COALESCE(left(p_notes, 2000), notes),
         done_by_employee_id = CASE WHEN p_status = 'pending' THEN NULL ELSE p_employee_id END
   WHERE id = p_job_asset_id;
END $$;

-- 4. Privileges: Supabase default privileges already grant anon/authenticated EXECUTE on new public
-- functions (the worker RPCs rely on that, like employee_update_checklist_item) and table rights on
-- job_assets; RLS above decides access.
