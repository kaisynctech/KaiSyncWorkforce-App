-- Work reports: many per job (each technician, each visit), shown to the office and, when allowed, the client.
-- job_cards stays as it is (one per job, used by older screens / the mobile app); every job card with text
-- is mirrored into one report so nothing written there is lost or hidden.

CREATE TABLE IF NOT EXISTS public.job_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_by_user uuid,
  report_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Johannesburg')::date),
  start_time timestamptz,
  end_time timestamptz,
  work_performed text NOT NULL CHECK (char_length(btrim(work_performed)) BETWEEN 1 AND 20000),
  materials_used text CHECK (materials_used IS NULL OR char_length(materials_used) <= 5000),
  marks_job_complete boolean NOT NULL DEFAULT false,
  visible_to_client boolean NOT NULL DEFAULT true,
  source_job_card_id uuid UNIQUE REFERENCES public.job_cards(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time >= start_time)
);
CREATE INDEX IF NOT EXISTS job_reports_job_idx ON public.job_reports (job_id, report_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS job_reports_company_idx ON public.job_reports (company_id);

CREATE OR REPLACE FUNCTION public._job_report_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = NEW.job_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'JOB_NOT_IN_COMPANY';
  END IF;
  IF NEW.employee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id = NEW.employee_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_IN_COMPANY';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by_user IS NULL THEN NEW.created_by_user := auth.uid(); END IF;
  NEW.work_performed := btrim(NEW.work_performed);
  NEW.materials_used := nullif(btrim(coalesce(NEW.materials_used, '')), '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER job_reports_check BEFORE INSERT OR UPDATE ON public.job_reports
  FOR EACH ROW EXECUTE FUNCTION public._job_report_check();

ALTER TABLE public.job_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_reports_select ON public.job_reports FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.view'));
CREATE POLICY job_reports_insert ON public.job_reports FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (public.user_company_ids())
    AND (public.user_has_permission(company_id, 'jobs.edit') OR public.user_has_permission(company_id, 'jobs.create')));
CREATE POLICY job_reports_update ON public.job_reports FOR UPDATE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));
CREATE POLICY job_reports_remove ON public.job_reports FOR DELETE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));

-- Mirror: a job card with text becomes (or updates) one report.
CREATE OR REPLACE FUNCTION public._job_card_to_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF btrim(coalesce(NEW.work_performed, '')) = '' THEN RETURN NEW; END IF;
  INSERT INTO public.job_reports (company_id, job_id, employee_id, report_date, start_time, end_time,
                                  work_performed, materials_used, marks_job_complete, source_job_card_id, created_at)
  VALUES (NEW.company_id, NEW.job_id, NEW.employee_id,
          coalesce((coalesce(NEW.start_time, NEW.updated_at, now()) AT TIME ZONE 'Africa/Johannesburg')::date,
                   (now() AT TIME ZONE 'Africa/Johannesburg')::date),
          NEW.start_time,
          CASE WHEN NEW.end_time >= NEW.start_time OR NEW.start_time IS NULL THEN NEW.end_time END,
          NEW.work_performed, NEW.materials_used, coalesce(NEW.is_completed, false), NEW.id, coalesce(NEW.created_at, now()))
  ON CONFLICT (source_job_card_id) DO UPDATE SET
    employee_id = excluded.employee_id,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    work_performed = excluded.work_performed,
    materials_used = excluded.materials_used,
    marks_job_complete = excluded.marks_job_complete;
  RETURN NEW;
END $$;

CREATE TRIGGER job_cards_to_report AFTER INSERT OR UPDATE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public._job_card_to_report();

-- Existing job cards with text become reports now.
INSERT INTO public.job_reports (company_id, job_id, employee_id, report_date, start_time, end_time,
                                work_performed, materials_used, marks_job_complete, source_job_card_id, created_at)
SELECT jc.company_id, jc.job_id, jc.employee_id,
       (coalesce(jc.start_time, jc.updated_at, jc.created_at, now()) AT TIME ZONE 'Africa/Johannesburg')::date,
       jc.start_time,
       CASE WHEN jc.end_time >= jc.start_time OR jc.start_time IS NULL THEN jc.end_time END,
       jc.work_performed, jc.materials_used, coalesce(jc.is_completed, false), jc.id, coalesce(jc.created_at, now())
FROM public.job_cards jc
WHERE btrim(coalesce(jc.work_performed, '')) <> ''
  AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = jc.job_id AND j.company_id = jc.company_id)
ON CONFLICT (source_job_card_id) DO NOTHING;

-- ── Technician (code login) ──
CREATE OR REPLACE FUNCTION public.employee_list_job_reports(
  p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id, 'employee_id', r.employee_id,
      'author', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
      'report_date', r.report_date, 'start_time', r.start_time, 'end_time', r.end_time,
      'work_performed', r.work_performed, 'materials_used', r.materials_used,
      'marks_job_complete', r.marks_job_complete, 'created_at', r.created_at, 'updated_at', r.updated_at,
      'mine', r.employee_id = p_employee_id
    ) ORDER BY r.report_date DESC, r.created_at DESC)
    FROM public.job_reports r
    LEFT JOIN public.employees e ON e.id = r.employee_id
    WHERE r.company_id = p_company_id AND r.job_id = p_job_id
  ), '[]'::json);
END $$;

CREATE OR REPLACE FUNCTION public.employee_save_job_report(
  p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_report_id uuid DEFAULT NULL,
  p_report_date date DEFAULT NULL, p_start_time timestamptz DEFAULT NULL, p_end_time timestamptz DEFAULT NULL,
  p_work_performed text DEFAULT NULL, p_materials_used text DEFAULT NULL,
  p_marks_job_complete boolean DEFAULT false, p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_row public.job_reports%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;
  IF btrim(coalesce(p_work_performed, '')) = '' THEN RAISE EXCEPTION 'WORK_PERFORMED_REQUIRED'; END IF;

  IF p_report_id IS NULL THEN
    INSERT INTO public.job_reports (company_id, job_id, employee_id, report_date, start_time, end_time,
                                    work_performed, materials_used, marks_job_complete)
    VALUES (p_company_id, p_job_id, p_employee_id,
            coalesce(p_report_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date),
            p_start_time, p_end_time, p_work_performed, p_materials_used, coalesce(p_marks_job_complete, false))
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.job_reports
       SET report_date = coalesce(p_report_date, report_date),
           start_time = p_start_time, end_time = p_end_time,
           work_performed = p_work_performed, materials_used = p_materials_used,
           marks_job_complete = coalesce(p_marks_job_complete, false)
     WHERE id = p_report_id AND company_id = p_company_id AND job_id = p_job_id AND employee_id = p_employee_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_YOURS'; END IF;
  END IF;

  IF coalesce(p_marks_job_complete, false) THEN
    UPDATE public.jobs SET status = 'completed', closed_at = coalesce(closed_at, now()), updated_at = now()
     WHERE id = p_job_id AND company_id = p_company_id AND status NOT IN ('completed', 'cancelled');
  END IF;
  RETURN row_to_json(v_row);
END $$;

-- ── Client portal: reports the office allows the client to see, on jobs the client can already open ──
CREATE OR REPLACE FUNCTION public.client_portal_list_job_reports(p_company_code text, p_client_code text, p_job_id uuid)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF public.client_portal_get_job(p_company_code, p_client_code, p_job_id) IS NULL THEN
    RETURN '[]'::json;
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id,
      'author', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
      'report_date', r.report_date, 'start_time', r.start_time, 'end_time', r.end_time,
      'work_performed', r.work_performed, 'materials_used', r.materials_used,
      'marks_job_complete', r.marks_job_complete
    ) ORDER BY r.report_date DESC, r.created_at DESC)
    FROM public.job_reports r
    LEFT JOIN public.employees e ON e.id = r.employee_id
    WHERE r.job_id = p_job_id AND r.visible_to_client
  ), '[]'::json);
END $$;
