-- W2: Employee numbers, separate from the sign-in code (Nyarie, 22 Oct 2026).
-- employees.employee_code stays the private sign-in code (company code + code signs a worker in).
-- employees.employee_number is the staff number shown on profiles, lists, payslips and reports.
--  * Each company has a prefix (e.g. IV) and a counter; numbers look like IV-0001.
--  * New companies get a default prefix from their name's initials. Existing companies get none until
--    HR sets one in Settings (no surprise changes); HR can then number everyone without a number.
--  * Staff numbers companies already typed into employee_code are copied into employee_number
--    (except the automatic "<code>-OWNER"/"-HR…" owner codes). Sign-in codes are not changed.
--  * Unique per company (case-insensitive). HR can type their own number; blank = automatic.

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_number text;
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS employee_number_prefix text,
  ADD COLUMN IF NOT EXISTS employee_number_next integer NOT NULL DEFAULT 1;

-- Copy staff numbers that were typed into the sign-in code (only where unique within the company).
UPDATE public.employees e SET employee_number = trim(e.employee_code)
WHERE e.employee_number IS NULL
  AND nullif(trim(e.employee_code), '') IS NOT NULL
  AND trim(e.employee_code) !~* '-(owner|hr_admin|hr)$'
  AND NOT EXISTS (SELECT 1 FROM public.employees o WHERE o.company_id = e.company_id AND o.id <> e.id
                  AND lower(trim(o.employee_code)) = lower(trim(e.employee_code)));

CREATE UNIQUE INDEX IF NOT EXISTS employees_company_employee_number_uq
  ON public.employees (company_id, lower(trim(employee_number)))
  WHERE employee_number IS NOT NULL AND trim(employee_number) <> '';

-- Default prefix for new companies: initials of the first two words of the name (letters only).
CREATE OR REPLACE FUNCTION public._default_employee_number_prefix(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(upper(string_agg(left(w, 1), '')), ''), 'EMP')
  FROM (SELECT w FROM regexp_split_to_table(regexp_replace(coalesce(p_name, ''), '[^A-Za-z ]', ' ', 'g'), '\s+') AS w
        WHERE w <> '' LIMIT 2) s;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_company_employee_number_prefix()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_number_prefix IS NULL THEN
    NEW.employee_number_prefix := public._default_employee_number_prefix(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_company_employee_number_prefix ON public.companies;
CREATE TRIGGER trg_company_employee_number_prefix BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_company_employee_number_prefix();

-- Next free number for a company (locks the company row so two inserts never get the same number).
CREATE OR REPLACE FUNCTION public._next_employee_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prefix text; v_next integer; v_candidate text;
BEGIN
  SELECT employee_number_prefix, employee_number_next INTO v_prefix, v_next
  FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_prefix IS NULL OR trim(v_prefix) = '' THEN RETURN NULL; END IF;
  LOOP
    v_candidate := trim(v_prefix) || '-' || lpad(v_next::text, 4, '0');
    v_next := v_next + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.employees
                          WHERE company_id = p_company_id AND lower(trim(employee_number)) = lower(v_candidate));
  END LOOP;
  UPDATE public.companies SET employee_number_next = v_next WHERE id = p_company_id;
  RETURN v_candidate;
END;
$$;
REVOKE ALL ON FUNCTION public._next_employee_number(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_fn_employee_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.employee_number IS NOT NULL THEN NEW.employee_number := nullif(trim(NEW.employee_number), ''); END IF;
  IF TG_OP = 'INSERT' AND NEW.employee_number IS NULL THEN
    NEW.employee_number := public._next_employee_number(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_employee_number ON public.employees;
CREATE TRIGGER trg_employee_number BEFORE INSERT OR UPDATE OF employee_number ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_employee_number();

-- Settings: read/set the prefix, and number everyone who has no number yet.
CREATE OR REPLACE FUNCTION public.hr_get_employee_number_settings(p_company_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'employees.view');
  RETURN (SELECT json_build_object(
    'prefix', c.employee_number_prefix,
    'next_number', c.employee_number_next,
    'without_number', (SELECT count(*) FROM public.employees e WHERE e.company_id = c.id AND e.employee_number IS NULL),
    'can_edit', public.user_has_permission(p_company_id, 'employees.edit'))
    FROM public.companies c WHERE c.id = p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_set_employee_number_prefix(p_company_id uuid, p_prefix text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prefix text := upper(nullif(trim(coalesce(p_prefix, '')), ''));
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'employees.edit');
  IF v_prefix IS NOT NULL AND v_prefix !~ '^[A-Z0-9]{1,6}$' THEN
    RAISE EXCEPTION 'PREFIX_INVALID: use 1 to 6 letters or digits';
  END IF;
  UPDATE public.companies SET employee_number_prefix = v_prefix WHERE id = p_company_id;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (p_company_id, auth.uid(), 'Settings', 'employee_number_prefix_set', 'info', jsonb_build_object('prefix', v_prefix), now());
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_assign_missing_employee_numbers(p_company_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_n integer := 0;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'employees.edit');
  IF (SELECT nullif(trim(employee_number_prefix), '') FROM public.companies WHERE id = p_company_id) IS NULL THEN
    RAISE EXCEPTION 'PREFIX_REQUIRED: set an employee number prefix first';
  END IF;
  FOR r IN SELECT id FROM public.employees WHERE company_id = p_company_id AND employee_number IS NULL
           ORDER BY employment_date NULLS LAST, created_at LOOP
    UPDATE public.employees SET employee_number = public._next_employee_number(p_company_id) WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (p_company_id, auth.uid(), 'Settings', 'employee_numbers_assigned', 'info', jsonb_build_object('count', v_n), now());
  RETURN v_n;
END;
$$;

-- Access: signed-in app users can read/write the new column (column-level grants, like the rest of employees).
GRANT SELECT, INSERT, UPDATE (employee_number) ON public.employees TO authenticated;
REVOKE ALL ON FUNCTION public._default_employee_number_prefix(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_fn_company_employee_number_prefix() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_fn_employee_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_get_employee_number_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_set_employee_number_prefix(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_assign_missing_employee_numbers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_get_employee_number_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_set_employee_number_prefix(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_assign_missing_employee_numbers(uuid) TO authenticated;
