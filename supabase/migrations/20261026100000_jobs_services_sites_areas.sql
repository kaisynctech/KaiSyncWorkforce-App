-- Jobs Phase 1 (Nyarie approved 26 Oct 2026): job services, client service lists, areas inside sites.
-- Asked for by Winterstech (SAB Rosslyn: areas like Brewhouse > Service Room; services Major / Minor /
-- Breakdown), built for every company.
--
-- job_services          the company's own list of services (Jobs > Job services)
-- client_job_services   services that apply to one client, with an optional agreed price
--                        (a client with no list sees the whole company list)
-- site_areas            areas inside a client site, can be nested (Brewhouse > Service Room)
-- jobs.service_id / jobs.area_id   what was done and where (jobs.site_id already existed)

-- 1) Company service list
CREATE TABLE IF NOT EXISTS public.job_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category text CHECK (category IS NULL OR length(category) <= 80),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  default_duration_minutes integer CHECK (default_duration_minutes IS NULL OR default_duration_minutes BETWEEN 0 AND 10080),
  default_price numeric(12,2) CHECK (default_price IS NULL OR default_price >= 0),
  -- Steps copied into the job checklist when the service is picked, e.g. ["Clean filters", "Check gas"].
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checklist) = 'array'),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_services_company_name_key ON public.job_services (company_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS job_services_company_active_idx ON public.job_services (company_id, is_active, sort_order);

-- 2) Services that apply to one client (optional), with an optional agreed price
CREATE TABLE IF NOT EXISTS public.client_job_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.job_services(id) ON DELETE CASCADE,
  agreed_price numeric(12,2) CHECK (agreed_price IS NULL OR agreed_price >= 0),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, service_id)
);
CREATE INDEX IF NOT EXISTS client_job_services_company_client_idx ON public.client_job_services (company_id, client_id);
CREATE INDEX IF NOT EXISTS client_job_services_service_idx ON public.client_job_services (service_id);

-- 3) Areas inside a site (nested one level or more)
CREATE TABLE IF NOT EXISTS public.site_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  parent_area_id uuid REFERENCES public.site_areas(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  -- 1 = first priority. Free for companies to use or ignore.
  priority smallint CHECK (priority IS NULL OR priority BETWEEN 1 AND 9),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_area_id IS NULL OR parent_area_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS site_areas_name_key
  ON public.site_areas (site_id, coalesce(parent_area_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
CREATE INDEX IF NOT EXISTS site_areas_company_site_idx ON public.site_areas (company_id, site_id);
CREATE INDEX IF NOT EXISTS site_areas_parent_idx ON public.site_areas (parent_area_id);

-- An area's parent must be in the same site; the site and area must belong to the same company.
CREATE OR REPLACE FUNCTION public._site_area_check()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.id = NEW.site_id AND s.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'The site does not belong to this company' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.site_areas p WHERE p.id = NEW.parent_area_id AND p.site_id = NEW.site_id
  ) THEN
    RAISE EXCEPTION 'The parent area must be in the same site' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS site_areas_check ON public.site_areas;
CREATE TRIGGER site_areas_check BEFORE INSERT OR UPDATE ON public.site_areas
  FOR EACH ROW EXECUTE FUNCTION public._site_area_check();

-- Client service rows must point at this company's client and service.
CREATE OR REPLACE FUNCTION public._client_job_service_check()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.company_id = NEW.company_id)
     OR NOT EXISTS (SELECT 1 FROM public.job_services s WHERE s.id = NEW.service_id AND s.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Client and service must belong to this company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS client_job_services_check ON public.client_job_services;
CREATE TRIGGER client_job_services_check BEFORE INSERT OR UPDATE ON public.client_job_services
  FOR EACH ROW EXECUTE FUNCTION public._client_job_service_check();

CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS job_services_touch ON public.job_services;
CREATE TRIGGER job_services_touch BEFORE UPDATE ON public.job_services
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- 4) Jobs: which service, which area
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.job_services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.site_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS jobs_service_idx ON public.jobs (company_id, service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_area_idx ON public.jobs (company_id, area_id) WHERE area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_site_idx ON public.jobs (company_id, site_id) WHERE site_id IS NOT NULL;

-- A job's service, site and area must be this company's, and the area must be in the job's site.
CREATE OR REPLACE FUNCTION public._job_service_area_check()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.job_services s WHERE s.id = NEW.service_id AND s.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'The job service does not belong to this company' USING ERRCODE = '23514';
  END IF;
  IF NEW.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sites s WHERE s.id = NEW.site_id AND s.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'The site does not belong to this company' USING ERRCODE = '23514';
  END IF;
  IF NEW.area_id IS NOT NULL THEN
    IF NEW.site_id IS NULL THEN
      SELECT a.site_id INTO NEW.site_id FROM public.site_areas a WHERE a.id = NEW.area_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.site_areas a WHERE a.id = NEW.area_id AND a.site_id = NEW.site_id AND a.company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'The area must be in the job''s site' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jobs_service_area_check ON public.jobs;
CREATE TRIGGER jobs_service_area_check BEFORE INSERT OR UPDATE OF service_id, site_id, area_id, company_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public._job_service_area_check();

-- 5) Row-level security (same pattern as jobs / clients)
ALTER TABLE public.job_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_job_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_services_select ON public.job_services;
CREATE POLICY job_services_select ON public.job_services FOR SELECT TO authenticated
  USING (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'jobs.view') OR user_has_permission(company_id, 'clients.view')));
DROP POLICY IF EXISTS job_services_write ON public.job_services;
CREATE POLICY job_services_write ON public.job_services FOR ALL TO authenticated
  USING (company_id = ANY (user_company_ids()) AND user_has_permission(company_id, 'jobs.edit'))
  WITH CHECK (company_id = ANY (user_company_ids()) AND user_has_permission(company_id, 'jobs.edit'));

DROP POLICY IF EXISTS client_job_services_select ON public.client_job_services;
CREATE POLICY client_job_services_select ON public.client_job_services FOR SELECT TO authenticated
  USING (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'jobs.view') OR user_has_permission(company_id, 'clients.view')));
DROP POLICY IF EXISTS client_job_services_write ON public.client_job_services;
CREATE POLICY client_job_services_write ON public.client_job_services FOR ALL TO authenticated
  USING (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'clients.edit') OR user_has_permission(company_id, 'jobs.edit')))
  WITH CHECK (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'clients.edit') OR user_has_permission(company_id, 'jobs.edit')));

DROP POLICY IF EXISTS site_areas_select ON public.site_areas;
CREATE POLICY site_areas_select ON public.site_areas FOR SELECT TO authenticated
  USING (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'jobs.view') OR user_has_permission(company_id, 'clients.view')));
-- Adding an area: anyone who can create or edit jobs (quick add from the job form) or edit clients.
DROP POLICY IF EXISTS site_areas_insert ON public.site_areas;
CREATE POLICY site_areas_insert ON public.site_areas FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'jobs.create') OR user_has_permission(company_id, 'jobs.edit') OR user_has_permission(company_id, 'clients.edit')));
DROP POLICY IF EXISTS site_areas_update ON public.site_areas;
CREATE POLICY site_areas_update ON public.site_areas FOR UPDATE TO authenticated
  USING (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'jobs.edit') OR user_has_permission(company_id, 'clients.edit')))
  WITH CHECK (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'jobs.edit') OR user_has_permission(company_id, 'clients.edit')));
DROP POLICY IF EXISTS site_areas_remove ON public.site_areas;
CREATE POLICY site_areas_remove ON public.site_areas FOR DELETE TO authenticated
  USING (company_id = ANY (user_company_ids()) AND (user_has_permission(company_id, 'jobs.edit') OR user_has_permission(company_id, 'clients.edit')));

-- 6) Access: Supabase's default privileges already give authenticated the table rights; row-level
-- security above decides what each person can do. anon has no policies, so it sees nothing.
-- Applied 26 Oct 2026 (apply_migration, without the DROP ... IF EXISTS lines since all objects were new).
