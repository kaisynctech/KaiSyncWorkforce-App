-- W3: Employee import runs on the server in batches (Nyarie, 22 Oct 2026).
-- Before: the browser created one employee at a time (~4 round trips per row, and every manager
-- lookup re-read the whole company), so 294 rows took 6.5 minutes and 10,000 would take hours.
-- A row whose manager appeared later in the file was skipped.
--
-- Now:
--  * hr_import_employees(company, rows, dry_run): checks or creates up to 500 rows per call.
--    Each row is isolated (one bad row never stops the batch). Duplicates of an existing employee
--    (same ID number, email or employee number) are refused so a file can't be imported twice.
--    Branch and time template are matched by name (case, spaces and dashes ignored).
--    Roles follow exactly the same rules as set_employee_role (it is called for non-employee roles).
--  * hr_import_link_managers(company, links): second pass that sets "reports to" once every
--    row exists, so file order no longer matters. Managers match on employee number, email or
--    full name; a name shared by two people is reported instead of guessed.
--  * The per-row head-count trigger is paused during an import and recounted once at the end.
--  * Indexes for company lookups by name, ID number (also used by worker sign-in) and email.
--  * The lookup functions run with enable_seqscan off: while a company's table grows from a few
--    hundred to many thousands of rows inside one import, the planner's statistics are stale and it
--    would otherwise keep scanning the whole table for every row (measured: 22 s per 500 rows).
--    JIT is off for them too: with seq scans discouraged every tiny query looks "expensive" and
--    would be JIT-compiled (~100 ms each).

CREATE INDEX IF NOT EXISTS idx_employees_company_fullname
  ON public.employees (company_id, lower(btrim(name) || ' ' || btrim(surname)));
CREATE INDEX IF NOT EXISTS idx_employees_company_id_number
  ON public.employees (company_id, lower(btrim(id_number))) WHERE id_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_company_email
  ON public.employees (company_id, lower(btrim(email))) WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION public._refresh_saas_employee_count(p_company_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.saas_company_subscriptions
  SET current_employee_count = (
        SELECT count(*)::integer FROM public.employees e
        WHERE e.company_id = p_company_id AND coalesce(e.is_active, true)),
      updated_at = now()
  WHERE company_id = p_company_id;
$$;

-- Head count: skip the per-row recount while an import batch runs (it recounts once at the end).
CREATE OR REPLACE FUNCTION public.sync_saas_employee_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF current_setting('kaisync.bulk_import', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_company_id := OLD.company_id;
  ELSE
    v_company_id := NEW.company_id;
  END IF;
  PERFORM public._refresh_saas_employee_count(v_company_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- W2 fixes: (1) the "is this number taken?" check now matches the unique index (it scanned the whole
-- table on every new employee, which made large imports slow down as the company grew);
-- (2) number 10000 and above: lpad(…, 4) truncated 10000 to "1000", so the 10,000th employee looped
-- forever. Numbers now continue IV-9999, IV-10000, IV-10001.
CREATE OR REPLACE FUNCTION public._next_employee_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET enable_seqscan TO off SET jit TO off AS $$
DECLARE v_prefix text; v_next integer; v_candidate text;
BEGIN
  SELECT employee_number_prefix, employee_number_next INTO v_prefix, v_next
  FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_prefix IS NULL OR trim(v_prefix) = '' THEN RETURN NULL; END IF;
  LOOP
    -- lpad() cuts longer text, so 10000 would become 1000 (taken) and loop forever.
    v_candidate := trim(v_prefix) || '-' || CASE WHEN v_next < 10000 THEN lpad(v_next::text, 4, '0') ELSE v_next::text END;
    v_next := v_next + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.employees
                          WHERE company_id = p_company_id
                            AND employee_number IS NOT NULL AND trim(employee_number) <> ''
                            AND lower(trim(employee_number)) = lower(v_candidate));
  END LOOP;
  UPDATE public.companies SET employee_number_next = v_next WHERE id = p_company_id;
  RETURN v_candidate;
END;
$$;

-- Case, spaces and punctuation are ignored: "Site — Pretoria East Mall" = "site - pretoria east mall",
-- "Office 08:00–17:00 (Mon–Fri)" = "office 08:00-17:00 (mon-fri)".
CREATE OR REPLACE FUNCTION public._import_label_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]+', ' ', 'g')), '');
$$;

-- Resolves a manager label to one employee: employee number, then email, then full name.
-- Returns NULL when not found; raises AMBIGUOUS when a full name matches more than one person.
CREATE OR REPLACE FUNCTION public._import_find_person(p_company_id uuid, p_label text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET enable_seqscan TO off SET jit TO off AS $$
DECLARE v_label text := lower(btrim(coalesce(p_label, ''))); v_id uuid; v_n integer;
BEGIN
  IF v_label = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.employees
   WHERE company_id = p_company_id AND employee_number IS NOT NULL AND trim(employee_number) <> ''
     AND lower(trim(employee_number)) = v_label LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT id INTO v_id FROM public.employees
   WHERE company_id = p_company_id AND email IS NOT NULL AND lower(btrim(email)) = v_label LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT count(*), min(id::text)::uuid INTO v_n, v_id FROM public.employees
   WHERE company_id = p_company_id
     AND lower(btrim(name) || ' ' || btrim(surname)) = regexp_replace(v_label, '\s+', ' ', 'g');
  IF v_n > 1 THEN RAISE EXCEPTION 'AMBIGUOUS'; END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_import_employees(p_company_id uuid, p_rows jsonb, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET enable_seqscan TO off SET jit TO off AS $$
DECLARE
  v_caller_role text;
  r jsonb;
  v_row integer;
  v_errors text[];
  v_name text; v_surname text; v_email text; v_id_number text; v_number text;
  v_role text; v_branch_label text; v_template_label text; v_manager_label text;
  v_branch_id uuid; v_branch_name text; v_template_id uuid; v_manager_id uuid; v_manager_pending text;
  v_new_id uuid; v_new_number text;
  v_results jsonb := '[]'::jsonb;
  v_created integer := 0; v_failed integer := 0;
  v_started timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.require_user_permission(p_company_id, 'employees.create');
  v_caller_role := public.get_my_role(p_company_id);
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ROWS_REQUIRED: send an array of rows'; END IF;
  IF jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'BATCH_TOO_LARGE: send at most 500 rows per call'; END IF;

  IF NOT p_dry_run THEN PERFORM set_config('kaisync.bulk_import', 'on', true); END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_row := nullif(r ->> 'row', '')::integer;
    v_errors := ARRAY[]::text[];
    v_branch_id := NULL; v_branch_name := NULL; v_template_id := NULL; v_manager_id := NULL; v_manager_pending := NULL;
    v_new_id := NULL; v_new_number := NULL;
    v_name := nullif(btrim(r ->> 'name'), '');
    v_surname := coalesce(btrim(r ->> 'surname'), '');
    v_email := nullif(lower(btrim(r ->> 'email')), '');
    v_id_number := nullif(btrim(r ->> 'id_number'), '');
    v_number := nullif(btrim(r ->> 'employee_number'), '');
    v_role := coalesce(nullif(lower(btrim(r ->> 'access_level')), ''), 'employee');
    v_branch_label := nullif(btrim(r ->> 'branch'), '');
    v_template_label := nullif(btrim(r ->> 'time_template'), '');
    v_manager_label := nullif(btrim(r ->> 'manager'), '');

    IF v_name IS NULL THEN v_errors := array_append(v_errors, 'First name is missing.'); END IF;

    -- Already in the company? (stops a file being imported twice)
    IF v_id_number IS NOT NULL AND EXISTS (SELECT 1 FROM public.employees WHERE company_id = p_company_id
         AND id_number IS NOT NULL AND lower(btrim(id_number)) = lower(v_id_number)) THEN
      v_errors := array_append(v_errors, format('Someone with ID number %s already exists.', v_id_number));
    END IF;
    IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.employees WHERE company_id = p_company_id
         AND email IS NOT NULL AND lower(btrim(email)) = v_email) THEN
      v_errors := array_append(v_errors, format('Someone with email %s already exists.', v_email));
    END IF;
    IF v_number IS NOT NULL AND EXISTS (SELECT 1 FROM public.employees WHERE company_id = p_company_id
         AND employee_number IS NOT NULL AND trim(employee_number) <> ''
         AND lower(trim(employee_number)) = lower(v_number)) THEN
      v_errors := array_append(v_errors, format('Employee number %s is already used.', v_number));
    END IF;

    -- Role: same rules as set_employee_role.
    IF v_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
      v_errors := array_append(v_errors, format('Access level "%s" is not allowed here. Use Employee, Manager, HR or Admin.', r ->> 'access_level'));
    ELSIF v_role <> 'employee' AND (
         NOT public.role_is_hr_or_above(v_caller_role)
      OR (v_role = 'admin' AND v_caller_role IS DISTINCT FROM 'owner')
      OR (v_caller_role = 'hr' AND v_role NOT IN ('manager', 'employee'))) THEN
      v_errors := array_append(v_errors, format('You cannot give the %s access level.', v_role));
    END IF;

    IF v_branch_label IS NOT NULL THEN
      SELECT id, name INTO v_branch_id, v_branch_name FROM public.branches
       WHERE company_id = p_company_id AND public._import_label_key(name) = public._import_label_key(v_branch_label)
       ORDER BY coalesce(is_active, true) DESC LIMIT 1;
      IF v_branch_id IS NULL THEN v_errors := array_append(v_errors, format('Branch "%s" was not found.', v_branch_label)); END IF;
    END IF;

    IF v_template_label IS NOT NULL THEN
      SELECT id INTO v_template_id FROM public.employee_shift_templates
       WHERE company_id = p_company_id AND public._import_label_key(name) = public._import_label_key(v_template_label) LIMIT 1;
      IF v_template_id IS NULL THEN
        -- The start of a name is enough when only one template starts that way ("Site Standard").
        SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END INTO v_template_id FROM public.employee_shift_templates
         WHERE company_id = p_company_id
           AND public._import_label_key(name) LIKE public._import_label_key(v_template_label) || ' %';
      END IF;
      IF v_template_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.employee_shift_templates WHERE company_id = p_company_id
                   AND public._import_label_key(name) LIKE public._import_label_key(v_template_label) || ' %') THEN
          v_errors := array_append(v_errors, format('Time template "%s" matches more than one template. Use the full name.', v_template_label));
        ELSE
          v_errors := array_append(v_errors, format('Time template "%s" was not found.', v_template_label));
        END IF;
      END IF;
    END IF;

    IF v_manager_label IS NOT NULL THEN
      BEGIN
        v_manager_id := public._import_find_person(p_company_id, v_manager_label);
        IF v_manager_id IS NULL THEN v_manager_pending := v_manager_label; END IF;
      EXCEPTION WHEN raise_exception THEN
        v_errors := array_append(v_errors, format('Manager "%s" matches more than one person. Use their employee number or email.', v_manager_label));
      END;
    END IF;

    IF cardinality(v_errors) = 0 AND NOT p_dry_run THEN
      BEGIN
        INSERT INTO public.employees (
          company_id, name, surname, email, phone, id_number, employee_number, position,
          department, cost_center, branch_id, branch, shift_template_id, manager_id, manager_user_id,
          employment_type, worker_type, access_level, employment_date,
          monthly_salary, hourly_rate, daily_rate, weekly_rate, overtime_rate, double_time_rate,
          work_days_weekly, daily_hours, pay_by_hour, pay_basis, paye_rate_percent, uif_exempt,
          medical_aid_deduction, pension_deduction, union_deduction,
          bank_name, bank_account, bank_branch_code, account_type,
          is_active, registration_status)
        VALUES (
          p_company_id, v_name, v_surname, v_email, nullif(btrim(r ->> 'phone'), ''), v_id_number, v_number,
          nullif(btrim(r ->> 'position'), ''),
          nullif(btrim(r ->> 'department'), ''), nullif(btrim(r ->> 'department'), ''),
          v_branch_id, v_branch_name, v_template_id, v_manager_id,
          (SELECT user_id FROM public.employees WHERE id = v_manager_id),
          coalesce(nullif(btrim(r ->> 'employment_type'), ''), 'permanent'), 'employee', 'employee',
          nullif(r ->> 'employment_date', '')::date,
          coalesce((r ->> 'monthly_salary')::numeric, 0), coalesce((r ->> 'hourly_rate')::numeric, 0),
          coalesce((r ->> 'daily_rate')::numeric, 0), 0, 0, 0,
          coalesce(nullif((r ->> 'work_days_weekly')::numeric, 0), 5), coalesce(nullif((r ->> 'daily_hours')::numeric, 0), 8),
          coalesce((r ->> 'pay_by_hour')::boolean, false),
          CASE WHEN coalesce((r ->> 'pay_by_hour')::boolean, false) THEN coalesce(nullif(r ->> 'pay_basis', ''), 'hourly') END,
          nullif(r ->> 'paye_rate_percent', '')::numeric, coalesce((r ->> 'uif_exempt')::boolean, false),
          coalesce((r ->> 'medical_aid')::numeric, 0), coalesce((r ->> 'pension')::numeric, 0), coalesce((r ->> 'union_fee')::numeric, 0),
          nullif(btrim(r ->> 'bank_name'), ''), nullif(btrim(r ->> 'bank_account'), ''),
          nullif(btrim(r ->> 'bank_branch_code'), ''), nullif(btrim(r ->> 'account_type'), ''),
          true, 'active')
        RETURNING id, employee_number INTO v_new_id, v_new_number;
        IF v_role <> 'employee' THEN
          PERFORM public.set_employee_role(p_company_id, v_new_id, v_role);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_new_id := NULL;
        v_errors := array_append(v_errors, regexp_replace(SQLERRM, '^[A-Z_]+: ', ''));
      END;
    END IF;

    IF cardinality(v_errors) > 0 THEN v_failed := v_failed + 1;
    ELSIF NOT p_dry_run THEN v_created := v_created + 1;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'row', v_row,
      'status', CASE WHEN cardinality(v_errors) > 0 THEN 'error' WHEN p_dry_run THEN 'ready' ELSE 'created' END,
      'id', v_new_id,
      'employee_number', v_new_number,
      'errors', CASE WHEN cardinality(v_errors) > 0 THEN to_jsonb(v_errors) END,
      'manager_pending', v_manager_pending)));
  END LOOP;

  IF NOT p_dry_run THEN
    PERFORM set_config('kaisync.bulk_import', 'off', true);
    PERFORM public._refresh_saas_employee_count(p_company_id);
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
    VALUES (p_company_id, auth.uid(), 'EmployeeImport', 'employees_imported', CASE WHEN v_failed > 0 THEN 'warning' ELSE 'info' END,
            jsonb_build_object('created', v_created, 'failed', v_failed,
                               'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)), now());
  END IF;

  RETURN jsonb_build_object('created', v_created, 'failed', v_failed, 'rows', v_results);
END;
$$;

-- Second pass: links = [{ "id": "<employee id>", "manager": "<number, email or full name>" }]
CREATE OR REPLACE FUNCTION public.hr_import_link_managers(p_company_id uuid, p_links jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET enable_seqscan TO off SET jit TO off AS $$
DECLARE l jsonb; v_manager uuid; v_linked integer := 0; v_problems jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.require_user_permission(p_company_id, 'employees.edit');
  IF jsonb_typeof(p_links) IS DISTINCT FROM 'array' OR jsonb_array_length(p_links) > 2000 THEN
    RAISE EXCEPTION 'LINKS_INVALID: send at most 2000 links';
  END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(p_links) LOOP
    BEGIN
      v_manager := public._import_find_person(p_company_id, l ->> 'manager');
      IF v_manager IS NULL THEN
        v_problems := v_problems || jsonb_build_array(jsonb_build_object('id', l ->> 'id', 'problem', format('Manager "%s" was not found.', l ->> 'manager')));
      ELSIF v_manager = (l ->> 'id')::uuid THEN
        v_problems := v_problems || jsonb_build_array(jsonb_build_object('id', l ->> 'id', 'problem', 'A person cannot report to themselves.'));
      ELSE
        UPDATE public.employees SET manager_id = v_manager,
               manager_user_id = (SELECT user_id FROM public.employees WHERE id = v_manager)
         WHERE id = (l ->> 'id')::uuid AND company_id = p_company_id;
        IF FOUND THEN v_linked := v_linked + 1; END IF;
      END IF;
    EXCEPTION WHEN raise_exception THEN
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('id', l ->> 'id',
        'problem', format('Manager "%s" matches more than one person. Use their employee number or email.', l ->> 'manager')));
    END;
  END LOOP;
  RETURN jsonb_build_object('linked', v_linked, 'problems', v_problems);
END;
$$;

-- Access (applied as separate statements).
REVOKE ALL ON FUNCTION public._refresh_saas_employee_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_find_person(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_label_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_import_employees(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_import_link_managers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_import_employees(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_import_link_managers(uuid, jsonb) TO authenticated;
