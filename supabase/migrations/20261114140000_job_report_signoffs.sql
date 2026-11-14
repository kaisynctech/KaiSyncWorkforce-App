-- Job report (J-a): signed reports for a visit and for the whole job (decided 14 Nov 2026: both). Additions only,
-- except the private link kinds, which gain 'job_report'.
--
-- A sign-off keeps a frozen copy of what was signed (content: visits and time, work done, checklist, parts, chosen
-- photos, still to do) with both signatures (small PNG images as data URLs), so the signed PDF never changes when the
-- job changes later. Once the client has signed it is locked; changes need a new version (a new row).
-- "Not happy": the client's reason is kept and the office is told; the job's status does not change.

-- 1. Visit sign-off on or off: a company default, and per job (empty = the company default).
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS visit_signoff_default boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS visit_signoff boolean;

-- 2. The sign-offs.
CREATE TABLE IF NOT EXISTS public.job_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('visit', 'job')),
  report_id uuid REFERENCES public.job_reports(id) ON DELETE SET NULL,   -- the visit report (scope visit)
  visit_date date,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'awaiting_client', 'signed', 'not_happy')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  technician_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  technician_name text,
  technician_signature text CHECK (technician_signature IS NULL OR (technician_signature LIKE 'data:image/png;base64,%' AND length(technician_signature) < 300000)),
  technician_signed_at timestamptz,
  client_name text,
  client_signature text CHECK (client_signature IS NULL OR (client_signature LIKE 'data:image/png;base64,%' AND length(client_signature) < 300000)),
  client_comment text CHECK (client_comment IS NULL OR length(client_comment) <= 2000),
  client_signed_at timestamptz,
  signed_via text CHECK (signed_via IS NULL OR signed_via IN ('on_site', 'link')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_signoffs_job_idx ON public.job_signoffs (job_id, created_at);
-- One open (not yet signed) whole-job report per job; one sign-off per visit report.
CREATE UNIQUE INDEX IF NOT EXISTS job_signoffs_one_open_job_report ON public.job_signoffs (job_id)
  WHERE scope = 'job' AND status IN ('draft', 'awaiting_client', 'not_happy');
CREATE UNIQUE INDEX IF NOT EXISTS job_signoffs_one_per_visit ON public.job_signoffs (report_id)
  WHERE scope = 'visit' AND report_id IS NOT NULL;

ALTER TABLE public.job_signoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_signoffs_read ON public.job_signoffs;
CREATE POLICY job_signoffs_read ON public.job_signoffs FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.view'));
DROP POLICY IF EXISTS job_signoffs_write ON public.job_signoffs;
CREATE POLICY job_signoffs_write ON public.job_signoffs FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));
DROP POLICY IF EXISTS job_signoffs_change ON public.job_signoffs;
CREATE POLICY job_signoffs_change ON public.job_signoffs FOR UPDATE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit'));
DROP POLICY IF EXISTS job_signoffs_remove_draft ON public.job_signoffs;
CREATE POLICY job_signoffs_remove_draft ON public.job_signoffs FOR DELETE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'jobs.edit') AND status = 'draft');
REVOKE ALL ON public.job_signoffs FROM anon;

-- Signed is final: no changes after the client signed.
CREATE OR REPLACE FUNCTION public._trg_job_signoff_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'signed' THEN RAISE EXCEPTION 'REPORT_SIGNED_LOCKED'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_job_signoff_lock ON public.job_signoffs;
CREATE TRIGGER trg_job_signoff_lock BEFORE UPDATE ON public.job_signoffs
  FOR EACH ROW EXECUTE FUNCTION public._trg_job_signoff_lock();

-- The office hears about every client signature and every "Not happy".
CREATE OR REPLACE FUNCTION public._trg_job_signoff_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  IF NEW.status NOT IN ('signed', 'not_happy') OR (TG_OP = 'UPDATE' AND OLD.status = NEW.status) THEN RETURN NEW; END IF;
  SELECT jb.job_code, jb.title, c.name AS client INTO j
    FROM public.jobs jb LEFT JOIN public.clients c ON c.id = jb.client_id WHERE jb.id = NEW.job_id;
  PERFORM public._notify_office(NEW.company_id,
    CASE WHEN NEW.status = 'signed' THEN 'job_report_signed' ELSE 'job_report_not_happy' END,
    CASE WHEN NEW.status = 'signed'
      THEN coalesce(NEW.client_name, j.client, 'The client') || ' signed the ' || CASE WHEN NEW.scope = 'job' THEN 'job report' ELSE 'visit' END || ' for ' || coalesce(j.job_code, j.title, 'a job')
      ELSE coalesce(NEW.client_name, j.client, 'The client') || ' is not happy with ' || coalesce(j.job_code, j.title, 'a job') END,
    coalesce(nullif(trim(NEW.client_comment), ''), CASE WHEN NEW.status = 'signed' THEN 'Signed without a comment.' ELSE 'No reason given.' END),
    'job', NEW.job_id::text, 'job_signoff:' || NEW.id::text || ':' || NEW.status,
    jsonb_build_object('job_id', NEW.job_id, 'signoff_id', NEW.id, 'scope', NEW.scope));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_job_signoff_notify ON public.job_signoffs;
CREATE TRIGGER trg_job_signoff_notify AFTER INSERT OR UPDATE OF status ON public.job_signoffs
  FOR EACH ROW EXECUTE FUNCTION public._trg_job_signoff_notify();

-- 3. Technicians (code login): list the job's sign-offs, save a visit sign-off on site (also from the offline queue),
--    and send the whole-job report for signing.
CREATE OR REPLACE FUNCTION public.employee_list_job_signoffs(p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_session_token text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB'; END IF;
  RETURN json_build_object(
    'visit_signoff', coalesce((SELECT visit_signoff FROM public.jobs WHERE id = p_job_id),
                              (SELECT visit_signoff_default FROM public.companies WHERE id = p_company_id), false),
    'signoffs', coalesce((SELECT json_agg(json_build_object('id', s.id, 'scope', s.scope, 'report_id', s.report_id,
        'visit_date', s.visit_date, 'status', s.status, 'client_name', s.client_name, 'client_comment', s.client_comment,
        'client_signed_at', s.client_signed_at, 'version', s.version) ORDER BY s.created_at)
      FROM public.job_signoffs s WHERE s.company_id = p_company_id AND s.job_id = p_job_id), '[]'::json));
END $$;

CREATE OR REPLACE FUNCTION public.employee_save_visit_signoff(
  p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_report_id uuid, p_visit_date date, p_content jsonb,
  p_technician_signature text, p_client_name text, p_client_signature text, p_client_comment text, p_outcome text,
  p_session_token text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_now timestamptz := now();
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB'; END IF;
  IF p_outcome NOT IN ('signed', 'not_happy') THEN RAISE EXCEPTION 'BAD_OUTCOME'; END IF;
  IF length(trim(coalesce(p_client_name, ''))) < 2 THEN RAISE EXCEPTION 'CLIENT_NAME_REQUIRED'; END IF;
  IF p_outcome = 'signed' AND p_client_signature IS NULL THEN RAISE EXCEPTION 'CLIENT_SIGNATURE_REQUIRED'; END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.job_reports WHERE id = p_report_id AND job_id = p_job_id) THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND';
  END IF;
  SELECT nullif(btrim(concat_ws(' ', name, surname)), '') INTO v_name FROM public.employees WHERE id = p_employee_id;
  INSERT INTO public.job_signoffs (company_id, job_id, scope, report_id, visit_date, status, content,
    technician_employee_id, technician_name, technician_signature, technician_signed_at,
    client_name, client_signature, client_comment, client_signed_at, signed_via, created_by)
  VALUES (p_company_id, p_job_id, 'visit', p_report_id, coalesce(p_visit_date, (v_now AT TIME ZONE 'Africa/Johannesburg')::date),
    p_outcome, coalesce(p_content, '{}'::jsonb), p_employee_id, v_name, p_technician_signature,
    CASE WHEN p_technician_signature IS NOT NULL THEN v_now END,
    trim(p_client_name), CASE WHEN p_outcome = 'signed' THEN p_client_signature END, nullif(trim(p_client_comment), ''),
    v_now, 'on_site', NULL)
  ON CONFLICT (report_id) WHERE scope = 'visit' AND report_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'VISIT_ALREADY_SIGNED'; END IF;
  RETURN v_id;
END $$;

-- The whole-job report, put together on the technician's phone: saved with their signature and ready for the client
-- (on site next, or by the link this returns). Re-sending replaces the open one (not a signed one).
CREATE OR REPLACE FUNCTION public.employee_send_job_report(
  p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_content jsonb, p_technician_signature text,
  p_session_token text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_token text; v_ver int;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB'; END IF;
  SELECT nullif(btrim(concat_ws(' ', name, surname)), '') INTO v_name FROM public.employees WHERE id = p_employee_id;
  SELECT id INTO v_id FROM public.job_signoffs
    WHERE job_id = p_job_id AND scope = 'job' AND status IN ('draft', 'awaiting_client', 'not_happy');
  IF v_id IS NULL THEN
    SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM public.job_signoffs WHERE job_id = p_job_id AND scope = 'job';
    INSERT INTO public.job_signoffs (company_id, job_id, scope, version, status, content, technician_employee_id,
      technician_name, technician_signature, technician_signed_at)
    VALUES (p_company_id, p_job_id, 'job', v_ver, 'awaiting_client', coalesce(p_content, '{}'::jsonb), p_employee_id,
      v_name, p_technician_signature, CASE WHEN p_technician_signature IS NOT NULL THEN now() END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.job_signoffs SET status = 'awaiting_client', content = coalesce(p_content, content),
      technician_employee_id = p_employee_id, technician_name = v_name,
      technician_signature = coalesce(p_technician_signature, technician_signature),
      technician_signed_at = CASE WHEN p_technician_signature IS NOT NULL THEN now() ELSE technician_signed_at END,
      client_comment = NULL
    WHERE id = v_id;
  END IF;
  SELECT token INTO v_token FROM public.document_links WHERE doc_id = v_id AND kind = 'job_report' AND expires_at > now() + interval '14 days' LIMIT 1;
  IF v_token IS NULL THEN
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.document_links (token, company_id, kind, doc_id) VALUES (v_token, p_company_id, 'job_report', v_id);
  END IF;
  RETURN json_build_object('id', v_id, 'token', v_token);
END $$;

-- The client signs the whole-job report on the technician's phone (on site).
CREATE OR REPLACE FUNCTION public.employee_client_sign_job_report(
  p_company_id uuid, p_employee_id uuid, p_signoff_id uuid, p_client_name text, p_client_signature text,
  p_client_comment text, p_outcome text, p_session_token text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.job_signoffs%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  SELECT * INTO s FROM public.job_signoffs WHERE id = p_signoff_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND OR NOT public._employee_assigned_to_job(p_company_id, p_employee_id, s.job_id) THEN RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB'; END IF;
  IF s.status = 'signed' THEN RAISE EXCEPTION 'REPORT_SIGNED_LOCKED'; END IF;
  IF p_outcome NOT IN ('signed', 'not_happy') THEN RAISE EXCEPTION 'BAD_OUTCOME'; END IF;
  IF length(trim(coalesce(p_client_name, ''))) < 2 THEN RAISE EXCEPTION 'CLIENT_NAME_REQUIRED'; END IF;
  IF p_outcome = 'signed' AND p_client_signature IS NULL THEN RAISE EXCEPTION 'CLIENT_SIGNATURE_REQUIRED'; END IF;
  UPDATE public.job_signoffs SET status = p_outcome, client_name = trim(p_client_name),
    client_signature = CASE WHEN p_outcome = 'signed' THEN p_client_signature END,
    client_comment = nullif(trim(p_client_comment), ''), client_signed_at = now(), signed_via = 'on_site'
  WHERE id = p_signoff_id;
END $$;

REVOKE ALL ON FUNCTION public.employee_list_job_signoffs(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_save_visit_signoff(uuid, uuid, uuid, uuid, date, jsonb, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_send_job_report(uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_client_sign_job_report(uuid, uuid, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_list_job_signoffs(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_save_visit_signoff(uuid, uuid, uuid, uuid, date, jsonb, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_send_job_report(uuid, uuid, uuid, jsonb, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_client_sign_job_report(uuid, uuid, uuid, text, text, text, text, text) TO anon, authenticated;

-- 4. Private links can now open a job report; the office makes them with document_link_for('job_report', <sign-off id>).
ALTER TABLE public.document_links DROP CONSTRAINT IF EXISTS document_links_kind_check;
ALTER TABLE public.document_links ADD CONSTRAINT document_links_kind_check CHECK (kind IN ('invoice', 'quote', 'job_report'));

CREATE OR REPLACE FUNCTION public.document_link_for(p_kind text, p_doc_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid; v_token text;
BEGIN
  IF p_kind = 'quote' THEN
    SELECT company_id INTO v_company FROM public.commercial_quotes WHERE id = p_doc_id;
  ELSIF p_kind = 'invoice' THEN
    SELECT company_id INTO v_company FROM public.finance_invoices WHERE id = p_doc_id;
  ELSIF p_kind = 'job_report' THEN
    SELECT company_id INTO v_company FROM public.job_signoffs WHERE id = p_doc_id;
  ELSE
    RAISE EXCEPTION 'BAD_KIND';
  END IF;
  IF v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(v_company, CASE p_kind WHEN 'quote' THEN 'quotes.edit' WHEN 'invoice' THEN 'invoices.edit' ELSE 'jobs.edit' END) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT token INTO v_token FROM public.document_links
    WHERE doc_id = p_doc_id AND kind = p_kind AND company_id = v_company AND expires_at > now() + interval '14 days'
    ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NULL THEN
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.document_links (token, company_id, kind, doc_id) VALUES (v_token, v_company, p_kind, p_doc_id);
  END IF;
  RETURN v_token;
END $$;

-- Check
SELECT
  (SELECT count(*) FROM pg_policies WHERE tablename = 'job_signoffs') AS policies,                         -- 4
  (SELECT count(*) FROM pg_proc WHERE proname IN ('employee_list_job_signoffs', 'employee_save_visit_signoff',
     'employee_send_job_report', 'employee_client_sign_job_report')) AS technician_functions,               -- 4
  (SELECT count(*) FROM information_schema.columns WHERE (table_name, column_name) IN
     (('companies', 'visit_signoff_default'), ('jobs', 'visit_signoff'))) AS settings_columns;              -- 2
