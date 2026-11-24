-- Linked companies, stage 3 (approved 30 Oct 2026): the customer creates a job for its provider
-- from its own app. The job is the provider's own job for that client — open, unassigned,
-- with the provider's next job number — and the provider's office is alerted. The customer may
-- cancel it only while the provider has not assigned anyone.

-- Who created a job through a link. Points at the link (not at companies), so jobs keeps a
-- single link to companies and existing jobs → companies lookups stay unambiguous.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS created_by_link_id uuid REFERENCES public.company_links(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS created_by_user uuid;
-- "Nyaradzo Ndoro (test company)": shown on the provider's job page (they cannot read the other
-- company's staff list).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS created_by_label text;
CREATE INDEX IF NOT EXISTS jobs_created_by_link_idx ON public.jobs (created_by_link_id) WHERE created_by_link_id IS NOT NULL;

-- The provider's sites for us (to choose where the work is).
CREATE OR REPLACE FUNCTION public.linked_job_options(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  v_client := public._linked_client(p_company_id, p_link_id);
  RETURN json_build_object('sites', coalesce((
    SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'address', s.address) ORDER BY s.name)
    FROM public.sites s JOIN public.clients c ON c.id = v_client
    WHERE s.client_id = c.id AND s.company_id = c.company_id AND coalesce(s.is_active, true)
  ), '[]'::json));
END $$;

-- Alert the provider's office about a job from a linked customer.
CREATE OR REPLACE FUNCTION public._linked_job_notify(p_job public.jobs, p_type text, p_title text, p_body text)
RETURNS void LANGUAGE sql SET search_path = public AS $$
  INSERT INTO public.app_notifications (company_id, audience, recipient_auth_user_id, recipient_employee_id,
    type, title, body, ref_type, ref_id, dedupe_key, data)
  SELECT p_job.company_id, 'hr', e.user_id, e.id, p_type, p_title, p_body, 'job', p_job.id::text,
         p_type || ':' || p_job.id::text || ':' || e.id::text,
         jsonb_build_object('job_id', p_job.id, 'job_code', p_job.job_code, 'link_id', p_job.created_by_link_id)
  FROM public.employees e
  WHERE e.company_id = p_job.company_id AND e.is_active AND e.user_id IS NOT NULL
    AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
$$;

-- Create a job for the provider. Returns {id, job_code}.
CREATE OR REPLACE FUNCTION public.linked_create_job(p_company_id uuid, p_link_id uuid, p_title text, p_description text DEFAULT NULL,
  p_priority text DEFAULT 'medium', p_scheduled_start timestamptz DEFAULT NULL, p_site_id uuid DEFAULT NULL, p_address text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client public.clients%ROWTYPE; v_job public.jobs%ROWTYPE; v_label text; v_customer text;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = public._linked_client(p_company_id, p_link_id);
  IF nullif(trim(coalesce(p_title, '')), '') IS NULL THEN RAISE EXCEPTION 'TITLE_REQUIRED'; END IF;
  IF length(p_title) > 200 OR length(coalesce(p_description, '')) > 5000 OR length(coalesce(p_address, '')) > 500 THEN
    RAISE EXCEPTION 'TOO_LONG';
  END IF;
  IF coalesce(p_priority, 'medium') NOT IN ('low', 'medium', 'high') THEN RAISE EXCEPTION 'BAD_PRIORITY'; END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site_id AND s.client_id = v_client.id
                                           AND s.company_id = v_client.company_id) THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND';
  END IF;
  v_label := public._linked_actor_name(p_company_id);
  SELECT name INTO v_customer FROM public.companies WHERE id = p_company_id;

  INSERT INTO public.jobs (company_id, title, description, priority, scheduled_start, client_id, site_id, address,
    status, opened_at, visibility, job_code, created_by_link_id, created_by_user, created_by_label, created_at, updated_at)
  VALUES (v_client.company_id, trim(p_title), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_priority, 'medium'),
    p_scheduled_start, v_client.id, p_site_id, nullif(trim(coalesce(p_address, '')), ''),
    'open', now(), 'inherit', public._next_job_code(v_client.company_id), p_link_id, auth.uid(), v_label, now(), now())
  RETURNING * INTO v_job;

  PERFORM public._linked_job_notify(v_job, 'linked_job_created', 'New job from ' || v_customer,
    v_label || ' created job ' || coalesce(v_job.job_code, '') || ': ' || v_job.title || '. It is open and unassigned.');
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_job_created', jsonb_build_object('job_id', v_job.id, 'job_code', v_job.job_code));
  RETURN json_build_object('id', v_job.id, 'job_code', v_job.job_code);
END $$;

-- What we may do with one of the provider's jobs for us.
CREATE OR REPLACE FUNCTION public.linked_job_actions(p_company_id uuid, p_link_id uuid, p_job_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid; v_job public.jobs%ROWTYPE;
BEGIN
  v_client := public._linked_client(p_company_id, p_link_id);
  IF public._cpc_get_job(v_client, p_job_id) IS NULL THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  RETURN json_build_object(
    'created_by_us', v_job.created_by_link_id = p_link_id,
    'created_by_label', CASE WHEN v_job.created_by_link_id = p_link_id THEN v_job.created_by_label END,
    'can_cancel', v_job.created_by_link_id = p_link_id
                  AND v_job.assignee_employee_id IS NULL AND cardinality(v_job.assigned_employee_ids) = 0
                  AND v_job.status NOT IN ('cancelled', 'completed', 'closed', 'invoiced'));
END $$;

-- Cancel a job we created, only while the provider has not assigned anyone.
CREATE OR REPLACE FUNCTION public.linked_cancel_job(p_company_id uuid, p_link_id uuid, p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid; v_job public.jobs%ROWTYPE; v_customer text;
BEGIN
  v_client := public._linked_client(p_company_id, p_link_id);
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND client_id = v_client FOR UPDATE;
  IF v_job.id IS NULL OR v_job.created_by_link_id IS DISTINCT FROM p_link_id THEN RAISE EXCEPTION 'JOB_NOT_YOURS'; END IF;
  IF v_job.assignee_employee_id IS NOT NULL OR cardinality(v_job.assigned_employee_ids) > 0 THEN RAISE EXCEPTION 'JOB_ALREADY_ASSIGNED'; END IF;
  IF v_job.status IN ('cancelled', 'completed', 'closed', 'invoiced') THEN RAISE EXCEPTION 'JOB_ALREADY_CLOSED'; END IF;
  UPDATE public.jobs SET status = 'cancelled', closed_at = now(), updated_at = now() WHERE id = v_job.id RETURNING * INTO v_job;
  SELECT name INTO v_customer FROM public.companies WHERE id = p_company_id;
  PERFORM public._linked_job_notify(v_job, 'linked_job_cancelled', 'Job cancelled by ' || v_customer,
    public._linked_actor_name(p_company_id) || ' cancelled job ' || coalesce(v_job.job_code, '') || ': ' || v_job.title || '.');
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_job_cancelled', jsonb_build_object('job_id', v_job.id));
END $$;

-- Permissions (run separately): _linked_job_notify — no direct calls; linked_* — signed-in only.
