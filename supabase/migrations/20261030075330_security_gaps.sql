-- Security gaps (approved 30 Oct 2026): private files, teams, adding employees, directory, view_payroll.
-- Policies are changed with ALTER POLICY (same names) so nothing is dropped.

-- ── A. Private files (workforce-media) ──────────────────────────────────────
-- Helper: the company a file belongs to (2nd folder), or null for old paths.
CREATE OR REPLACE FUNCTION public._media_company(p_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN (storage.foldername(p_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN ((storage.foldername(p_name))[2])::uuid END;
$$;

-- Can the signed-in user read this file? Own company only; employee documents and leave
-- attachments only for HR and above (managers too for leave) or the employee themselves.
CREATE OR REPLACE FUNCTION public.media_staff_can_read(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f text[] := storage.foldername(p_name);
  v_company uuid := public._media_company(p_name);
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF public.media_read_granted(p_name) THEN RETURN true; END IF;

  IF f[1] = 'leave_attachments' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id::text = f[2]
        AND e.company_id = ANY (public.user_company_ids())
        AND (e.user_id = auth.uid()
             OR public.role_is_hr_or_above(public.get_my_role(e.company_id))
             OR public.get_my_role(e.company_id) = 'manager'));
  END IF;

  IF v_company IS NULL THEN
    -- Old files saved without a company folder: HR and above only.
    RETURN EXISTS (SELECT 1 FROM unnest(public.user_company_ids()) c(id)
                   WHERE public.role_is_hr_or_above(public.get_my_role(c.id)));
  END IF;

  IF NOT (v_company = ANY (public.user_company_ids())) THEN RETURN false; END IF;

  IF f[1] = 'employee_documents' THEN
    v_role := public.get_my_role(v_company);
    RETURN public.role_is_hr_or_above(v_role)
        OR EXISTS (SELECT 1 FROM public.employees e
                   WHERE e.id::text = f[3] AND e.company_id = v_company AND e.user_id = auth.uid());
  END IF;

  RETURN true;
END $$;

-- Anyone (no sign-in): was "read the whole bucket" → now only files the server granted.
ALTER POLICY p_workforce_media_public_select ON storage.objects
  TO anon USING (bucket_id = 'workforce-media' AND public.media_read_granted(name));
-- Contractor portal folders: were open to everyone → granted files only (the portal grants first).
ALTER POLICY p_workforce_media_contractor_portal_select ON storage.objects
  TO anon USING (bucket_id = 'workforce-media' AND public.media_read_granted(name));
ALTER POLICY p_workforce_media_contractor_quotes_select ON storage.objects
  TO anon USING (bucket_id = 'workforce-media' AND public.media_read_granted(name));
-- Signed-in staff: was "every company's files" → own company, with the rules above.
ALTER POLICY p_workforce_media_hr_select ON storage.objects
  TO authenticated USING (bucket_id = 'workforce-media' AND public.media_staff_can_read(name));

-- ── 1. Teams: everyone in the company may see them; only "Edit employees" may change them ──
ALTER POLICY work_teams_all ON public.work_teams
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'employees.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'employees.edit'));
CREATE POLICY work_teams_select ON public.work_teams FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()));

-- ── 2. Adding employees needs "Create employees" ──
ALTER POLICY employees_insert ON public.employees
  WITH CHECK (company_id = ANY (public.user_company_ids())
              AND access_level = 'employee'
              AND public.user_has_permission(company_id, 'employees.create'));

-- ── 4. "View payroll": off for Employee and Manager (it guards nothing today) ──
UPDATE public.company_role_permissions SET allowed = false
WHERE permission_key = 'payments.view_payroll' AND role IN ('employee', 'manager') AND allowed;

DO $d$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.seed_company_role_permissions(uuid)'::regprocedure);
  v_new := regexp_replace(v_def, $r$(\['employee','payments\.view_payroll',\s*)'true'\]$r$, $r$\1'false']$r$);
  IF v_new <> v_def THEN EXECUTE v_new; END IF;
END $d$;

-- ── 3. Employee directory: not callable without sign-in ──
REVOKE EXECUTE ON FUNCTION public.list_employee_directory(uuid, text, text, text, text, uuid, integer, integer) FROM PUBLIC, anon;
