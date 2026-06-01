-- Employee job list RPC (uuid schema) + resolve employee row via user_id for visibility.

DROP FUNCTION IF EXISTS public.employee_get_jobs_for_employee(bigint, bigint);

CREATE OR REPLACE FUNCTION public.employee_get_jobs_for_employee(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.jobs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT j.*
  FROM public.jobs j
  WHERE j.company_id = p_company_id
    AND (
      j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR (
        j.contractor_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.contractor_member_links cml
          WHERE cml.company_id = p_company_id
            AND cml.employee_id = p_employee_id
            AND cml.contractor_id = j.contractor_id
        )
      )
    )
  ORDER BY j.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.employee_get_jobs_for_employee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_jobs_for_employee(uuid, uuid) TO authenticated;

-- Patch visibility resolver to recognize employees linked by user_id (uuid schema).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'is_visible_to_me'
      AND pg_get_function_identity_arguments(p.oid) LIKE '%uuid%'
  ) THEN
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'user_id'
  ) THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.is_visible_to_me(
  p_scope text,
  p_scope_id uuid,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_visibility text;
  v_parent_deal uuid;
  v_assignee uuid;
  v_my_employee_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_company_owner(p_company_id) THEN
    RETURN true;
  END IF;

  SELECT coalesce(
    (SELECT h.role FROM public.hr_users h
      WHERE h.auth_user_id = v_uid AND h.company_id = p_company_id
        AND coalesce(h.is_active, true) = true LIMIT 1),
    (SELECT e.access_level FROM public.employees e
      WHERE e.company_id = p_company_id
        AND (e.user_id = v_uid OR e.profile_id = v_uid)
      LIMIT 1)
  ) INTO v_role;

  v_role := CASE v_role
    WHEN 'hr' THEN 'hr_admin'
    WHEN 'payroll' THEN 'hr_admin'
    WHEN 'viewer' THEN 'employee'
    ELSE v_role
  END;

  IF (p_scope = 'job' AND public.has_permission(p_company_id, 'jobs.view'))
     OR (p_scope = 'deal' AND public.has_permission(p_company_id, 'projects.view')) THEN
    NULL;
  ELSE
    RETURN false;
  END IF;

  IF p_scope = 'job' THEN
    SELECT j.visibility, j.deal_id, j.assignee_employee_id
      INTO v_visibility, v_parent_deal, v_assignee
    FROM public.jobs j
    WHERE j.id = p_scope_id AND j.company_id = p_company_id;
    IF v_visibility IS NULL THEN RETURN false; END IF;
    IF v_visibility = 'inherit' THEN
      IF v_parent_deal IS NULL THEN
        v_visibility := 'all';
      ELSE
        SELECT cd.visibility INTO v_visibility
        FROM public.client_deals cd
        WHERE cd.id = v_parent_deal AND cd.company_id = p_company_id;
        v_visibility := coalesce(v_visibility, 'all');
      END IF;
    END IF;
  ELSIF p_scope = 'deal' THEN
    SELECT cd.visibility INTO v_visibility
    FROM public.client_deals cd
    WHERE cd.id = p_scope_id AND cd.company_id = p_company_id;
    IF v_visibility IS NULL THEN RETURN false; END IF;
    v_assignee := NULL;
  ELSE
    RETURN false;
  END IF;

  SELECT e.id INTO v_my_employee_id
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND (e.user_id = v_uid OR e.profile_id = v_uid)
  LIMIT 1;

  IF v_visibility = 'all' THEN
    IF v_role = 'employee' THEN
      IF p_scope <> 'job' OR v_my_employee_id IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = p_scope_id AND j.company_id = p_company_id
          AND (
            j.assignee_employee_id = v_my_employee_id
            OR v_my_employee_id = ANY(coalesce(j.assigned_employee_ids, '{}'::uuid[]))
          )
      );
    END IF;
    RETURN true;
  END IF;

  IF v_my_employee_id IS NULL THEN RETURN false; END IF;

  IF v_visibility = 'private' THEN
    RETURN v_assignee IS NOT NULL AND v_assignee = v_my_employee_id;
  END IF;

  IF v_visibility = 'restricted' THEN
    IF v_assignee IS NOT NULL AND v_assignee = v_my_employee_id THEN RETURN true; END IF;
    IF v_assignee IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = v_assignee AND e.manager_user_id = v_uid
    ) THEN RETURN true; END IF;
    RETURN false;
  END IF;

  RETURN false;
END;
$body$;
    $fn$;
    REVOKE ALL ON FUNCTION public.is_visible_to_me(text, uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_visible_to_me(text, uuid, uuid) TO authenticated;
  END IF;
END $$;
