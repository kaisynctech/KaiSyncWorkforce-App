-- Multi-job projects, contractor codes/portal, job site sign-in/out (employees + contractors).

-- Contractor portal code
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS contractor_code text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contractors_company_contractor_code
  ON public.contractors (company_id, upper(trim(contractor_code)))
  WHERE contractor_code IS NOT NULL AND trim(contractor_code) <> '';

-- Job site visits (employees + contractors)
CREATE TABLE IF NOT EXISTS public.job_site_visits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id              uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  party_type          text NOT NULL CHECK (party_type IN ('employee', 'contractor')),
  employee_id         uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  contractor_id       uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  sign_in_at          timestamptz NOT NULL DEFAULT now(),
  sign_out_at         timestamptz,
  sign_in_latitude    double precision,
  sign_in_longitude   double precision,
  sign_in_address     text,
  sign_out_latitude   double precision,
  sign_out_longitude  double precision,
  sign_out_address    text,
  reported_by_name    text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_site_visits_party_chk CHECK (
    (party_type = 'employee' AND employee_id IS NOT NULL AND contractor_id IS NULL)
    OR (party_type = 'contractor' AND contractor_id IS NOT NULL AND employee_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_job_site_visits_job
  ON public.job_site_visits (job_id, sign_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_site_visits_employee_open
  ON public.job_site_visits (employee_id)
  WHERE sign_out_at IS NULL AND party_type = 'employee';

CREATE INDEX IF NOT EXISTS idx_job_site_visits_contractor_open
  ON public.job_site_visits (contractor_id)
  WHERE sign_out_at IS NULL AND party_type = 'contractor';

-- Incidents from contractor portal
ALTER TABLE public.incident_reports
  ALTER COLUMN employee_id DROP NOT NULL;

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL;

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS reported_by_name text;

-- Contractor messages on job threads
ALTER TABLE public.app_messages
  ADD COLUMN IF NOT EXISTS sender_contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL;

ALTER TABLE public.app_messages
  ADD COLUMN IF NOT EXISTS sender_display_name text;

-- Helper: employee assigned to job
CREATE OR REPLACE FUNCTION public._employee_assigned_to_job(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = p_job_id
      AND j.company_id = p_company_id
      AND (
        j.assignee_employee_id = p_employee_id
        OR j.assigned_employee_ids @> ARRAY[p_employee_id]
        OR j.contractor_employee_id = p_employee_id
      )
  );
$$;

-- Helper: contractor owns job
CREATE OR REPLACE FUNCTION public._contractor_owns_job(
  p_company_id uuid,
  p_contractor_id uuid,
  p_job_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = p_job_id
      AND j.company_id = p_company_id
      AND j.contractor_id = p_contractor_id
  );
$$;

-- Resolve contractor by company + contractor code
CREATE OR REPLACE FUNCTION public.contractor_resolve_by_code(
  p_company_code   text,
  p_contractor_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT
      ct.id AS contractor_id,
      ct.company_id,
      ct.name AS contractor_name,
      ct.contractor_code,
      c.code AS company_code
    FROM public.contractors ct
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND ct.is_active = true
      AND ct.contractor_code IS NOT NULL
    LIMIT 1
  ) t;
$$;

-- Contractor portal: list jobs
CREATE OR REPLACE FUNCTION public.contractor_portal_list_jobs(
  p_company_code    text,
  p_contractor_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC), '[]'::json)
  FROM (
    SELECT
      j.id,
      j.title,
      j.status,
      j.job_code,
      j.scheduled_start,
      j.scheduled_end,
      j.contractor_cost,
      j.deal_id,
      j.client_id,
      j.site_id,
      j.photo_urls_before,
      j.photo_urls_after,
      j.created_at,
      j.updated_at,
      (
        SELECT v.id FROM public.job_site_visits v
        WHERE v.job_id = j.id
          AND v.contractor_id = ct.id
          AND v.sign_out_at IS NULL
        ORDER BY v.sign_in_at DESC
        LIMIT 1
      ) AS open_visit_id
    FROM public.jobs j
    INNER JOIN public.contractors ct ON ct.id = j.contractor_id
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND ct.is_active = true
      AND j.company_id = ct.company_id
  ) t;
$$;

-- Employee: sign in on job site
CREATE OR REPLACE FUNCTION public.employee_job_site_sign_in(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_reported_by_name text DEFAULT NULL,
  p_notes            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.job_site_visits%ROWTYPE;
BEGIN
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.job_site_visits v
    WHERE v.company_id = p_company_id
      AND v.employee_id = p_employee_id
      AND v.sign_out_at IS NULL
      AND v.party_type = 'employee'
  ) THEN
    RAISE EXCEPTION 'ALREADY_ON_SITE';
  END IF;

  INSERT INTO public.job_site_visits (
    company_id, job_id, party_type, employee_id,
    sign_in_at, sign_in_latitude, sign_in_longitude, sign_in_address,
    reported_by_name, notes
  ) VALUES (
    p_company_id, p_job_id, 'employee', p_employee_id,
    now(), p_latitude, p_longitude, p_address,
    p_reported_by_name, p_notes
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

-- Employee: sign out
CREATE OR REPLACE FUNCTION public.employee_job_site_sign_out(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_notes            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.job_site_visits%ROWTYPE;
BEGIN
  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      sign_out_latitude = p_latitude,
      sign_out_longitude = p_longitude,
      sign_out_address = p_address,
      notes = coalesce(p_notes, v.notes)
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.job_id = p_job_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_OPEN_VISIT';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;

-- Employee: open visit
CREATE OR REPLACE FUNCTION public.employee_job_site_open_visit(
  p_company_id  uuid,
  p_employee_id uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(v)
  FROM public.job_site_visits v
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  ORDER BY v.sign_in_at DESC
  LIMIT 1;
$$;

-- Contractor portal: sign in
CREATE OR REPLACE FUNCTION public.contractor_portal_site_sign_in(
  p_company_code     text,
  p_contractor_code  text,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_reported_by_name text DEFAULT NULL,
  p_notes            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_row public.job_site_visits%ROWTYPE;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND';
  END IF;

  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.job_site_visits v
    WHERE v.contractor_id = v_ct.id
      AND v.sign_out_at IS NULL
      AND v.party_type = 'contractor'
  ) THEN
    RAISE EXCEPTION 'ALREADY_ON_SITE';
  END IF;

  INSERT INTO public.job_site_visits (
    company_id, job_id, party_type, contractor_id,
    sign_in_at, sign_in_latitude, sign_in_longitude, sign_in_address,
    reported_by_name, notes
  ) VALUES (
    v_ct.company_id, p_job_id, 'contractor', v_ct.id,
    now(), p_latitude, p_longitude, p_address,
    p_reported_by_name, p_notes
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

-- Contractor portal: sign out
CREATE OR REPLACE FUNCTION public.contractor_portal_site_sign_out(
  p_company_code    text,
  p_contractor_code text,
  p_job_id          uuid,
  p_latitude        double precision DEFAULT NULL,
  p_longitude       double precision DEFAULT NULL,
  p_address         text DEFAULT NULL,
  p_notes           text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_row public.job_site_visits%ROWTYPE;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND';
  END IF;

  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      sign_out_latitude = p_latitude,
      sign_out_longitude = p_longitude,
      sign_out_address = p_address,
      notes = coalesce(p_notes, v.notes)
  WHERE v.contractor_id = v_ct.id
    AND v.job_id = p_job_id
    AND v.party_type = 'contractor'
    AND v.sign_out_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_OPEN_VISIT';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;

-- Contractor portal: open visit
CREATE OR REPLACE FUNCTION public.contractor_portal_open_visit(
  p_company_code    text,
  p_contractor_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(v)
  FROM public.job_site_visits v
  INNER JOIN public.contractors ct ON ct.id = v.contractor_id
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND v.party_type = 'contractor'
    AND v.sign_out_at IS NULL
  ORDER BY v.sign_in_at DESC
  LIMIT 1;
$$;

-- Visits for a job (HR authenticated + anon for portal history via contractor code)
CREATE OR REPLACE FUNCTION public.get_job_site_visits(p_job_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.sign_in_at DESC), '[]'::json)
  FROM (
    SELECT
      v.*,
      trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')) AS employee_name,
      ct.name AS contractor_name
    FROM public.job_site_visits v
    LEFT JOIN public.employees e ON e.id = v.employee_id
    LEFT JOIN public.contractors ct ON ct.id = v.contractor_id
    WHERE v.job_id = p_job_id
  ) t;
$$;

-- Contractor portal: visit history for contractor
CREATE OR REPLACE FUNCTION public.contractor_portal_visit_history(
  p_company_code    text,
  p_contractor_code text,
  p_job_id          uuid DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.sign_in_at DESC), '[]'::json)
  FROM (
    SELECT v.*
    FROM public.job_site_visits v
    INNER JOIN public.contractors ct ON ct.id = v.contractor_id
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND v.party_type = 'contractor'
      AND (p_job_id IS NULL OR v.job_id = p_job_id)
  ) t;
$$;

-- Contractor portal: create incident
CREATE OR REPLACE FUNCTION public.contractor_portal_create_incident(
  p_company_code     text,
  p_contractor_code  text,
  p_job_id           uuid,
  p_description      text,
  p_severity         text DEFAULT 'low',
  p_reported_by_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_row public.incident_reports%ROWTYPE;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  INSERT INTO public.incident_reports (
    id, company_id, job_id, contractor_id, description, severity,
    reported_by_name, is_closed, created_at
  ) VALUES (
    gen_random_uuid(), v_ct.company_id, p_job_id, v_ct.id, trim(p_description),
    coalesce(nullif(trim(p_severity), ''), 'low'),
    p_reported_by_name, false, now()
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

-- Contractor portal: append photo URL to job
CREATE OR REPLACE FUNCTION public.contractor_portal_append_job_photo(
  p_company_code    text,
  p_contractor_code text,
  p_job_id          uuid,
  p_phase           text,
  p_photo_url       text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

  IF lower(trim(p_phase)) = 'after' THEN
    UPDATE public.jobs
    SET photo_urls_after = array_append(coalesce(photo_urls_after, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE public.jobs
    SET photo_urls_before = array_append(coalesce(photo_urls_before, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id;
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  RETURN row_to_json(v_job);
END;
$$;

-- Contractor portal: send message on job thread
CREATE OR REPLACE FUNCTION public.contractor_portal_send_job_message(
  p_company_code     text,
  p_contractor_code  text,
  p_job_id           uuid,
  p_body             text,
  p_sender_name      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_thread_id uuid;
  v_subject text;
  v_msg public.app_messages%ROWTYPE;
  v_manager uuid;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  v_manager := coalesce(v_job.assignee_employee_id, v_job.contractor_employee_id);
  v_subject := 'Job:' || p_job_id::text;

  SELECT t.id INTO v_thread_id
  FROM public.message_threads t
  WHERE t.company_id = v_ct.company_id
    AND t.subject = v_subject
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.message_threads (id, company_id, subject, participant_ids, type_raw, created_at)
    VALUES (
      gen_random_uuid(),
      v_ct.company_id,
      v_subject,
      CASE WHEN v_manager IS NOT NULL THEN ARRAY[v_manager] ELSE '{}' END,
      'job',
      now()
    )
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.app_messages (
    id, thread_id, sender_id, body, company_id, created_at,
    sender_contractor_id, sender_display_name
  ) VALUES (
    gen_random_uuid(),
    v_thread_id,
    coalesce(v_manager, v_ct.id),
    trim(p_body),
    v_ct.company_id,
    now(),
    v_ct.id,
    coalesce(nullif(trim(p_sender_name), ''), v_ct.name)
  )
  RETURNING * INTO v_msg;

  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = left(trim(p_body), 120)
  WHERE id = v_thread_id;

  RETURN row_to_json(v_msg);
END;
$$;

-- Contractor portal: get job messages
CREATE OR REPLACE FUNCTION public.contractor_portal_get_job_messages(
  p_company_code    text,
  p_contractor_code text,
  p_job_id          uuid
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_subject text;
  v_thread_id uuid;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RETURN '[]'::json; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RETURN '[]'::json;
  END IF;

  v_subject := 'Job:' || p_job_id::text;
  SELECT t.id INTO v_thread_id
  FROM public.message_threads t
  WHERE t.company_id = v_ct.company_id AND t.subject = v_subject
  LIMIT 1;

  IF v_thread_id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN (
    SELECT coalesce(json_agg(row_to_json(m) ORDER BY m.created_at), '[]'::json)
    FROM public.app_messages m
    WHERE m.thread_id = v_thread_id
  );
END;
$$;

-- Job count on client portal projects
CREATE OR REPLACE FUNCTION public.client_portal_list_projects(
  p_company_code text,
  p_client_code  text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
  FROM (
    SELECT
      d.id,
      d.company_id,
      d.client_id,
      d.project_code,
      d.title,
      d.status,
      d.offer_amount,
      d.amount_paid,
      d.progress_percent,
      d.agreement_notes,
      d.last_update_note,
      d.last_update_at,
      d.expected_close_date,
      d.job_id,
      d.created_at,
      d.updated_at,
      (SELECT count(*)::int FROM public.jobs j WHERE j.deal_id = d.id) AS job_count
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND d.visibility <> 'private'
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_resolve_by_code(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_list_jobs(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_sign_in(uuid,uuid,uuid,double precision,double precision,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_sign_out(uuid,uuid,uuid,double precision,double precision,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_open_visit(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_in(text,text,uuid,double precision,double precision,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_out(text,text,uuid,double precision,double precision,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_open_visit(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_job_site_visits(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_visit_history(text,text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_create_incident(text,text,uuid,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_append_job_photo(text,text,uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_send_job_message(text,text,uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_job_messages(text,text,uuid) TO anon, authenticated;
