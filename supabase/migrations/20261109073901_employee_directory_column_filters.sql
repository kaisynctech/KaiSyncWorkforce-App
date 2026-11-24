-- Employees directory: additive per-column filters for Quotes/Money table chrome.
-- Keeps existing args; adds optional name / employee_number / id_number / department.
-- Defaults null preserve prior call sites (p_search-only behaviour unchanged).

DROP FUNCTION IF EXISTS public.list_employee_directory(uuid, text, text, text, text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.list_employee_directory(
  p_company_id uuid,
  p_search text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_name text DEFAULT NULL,
  p_employee_number text DEFAULT NULL,
  p_id_number text DEFAULT NULL,
  p_department text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_state jsonb;
  v_sees_all boolean;
  v_ids uuid[];
  v_limit integer;
  v_offset integer;
  v_search text;
  v_role text;
  v_type text;
  v_name text;
  v_emp_no text;
  v_id_no text;
  v_dept text;
  v_total integer;
  v_rows jsonb;
BEGIN
  v_state := public.employee_scope_state(p_company_id);
  v_sees_all := COALESCE((v_state ->> 'sees_all')::boolean, false);
  v_ids := ARRAY[]::uuid[];

  IF NOT v_sees_all THEN
    SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[])
      INTO v_ids
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(v_state -> 'ids') = 'array' THEN v_state -> 'ids'
        ELSE '[]'::jsonb
      END
    ) AS x;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_role := NULLIF(lower(btrim(COALESCE(p_role, ''))), '');
  v_type := NULLIF(lower(btrim(COALESCE(p_employment_type, ''))), '');
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_emp_no := NULLIF(btrim(COALESCE(p_employee_number, '')), '');
  v_id_no := NULLIF(btrim(COALESCE(p_id_number, '')), '');
  v_dept := NULLIF(btrim(COALESCE(p_department, '')), '');

  WITH scoped AS (
    SELECT e.id
    FROM public.employees e
    WHERE e.company_id = p_company_id
      AND (v_sees_all OR e.id = ANY (v_ids))
      AND (
        v_search IS NULL
        OR strpos(lower(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.employee_number, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.employee_code, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.id_number, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.department, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.position, '')), lower(v_search)) > 0
      )
      AND (
        v_name IS NULL
        OR strpos(lower(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')), lower(v_name)) > 0
      )
      AND (
        v_emp_no IS NULL
        OR strpos(lower(coalesce(e.employee_number, '')), lower(v_emp_no)) > 0
        OR strpos(lower(coalesce(e.employee_code, '')), lower(v_emp_no)) > 0
      )
      AND (
        v_id_no IS NULL
        OR strpos(lower(coalesce(e.id_number, '')), lower(v_id_no)) > 0
      )
      AND (
        v_dept IS NULL
        OR strpos(lower(coalesce(e.department, '')), lower(v_dept)) > 0
      )
      AND (
        v_role IS NULL
        OR (
          CASE lower(replace(replace(coalesce(e.access_level, ''), ' ', '_'), '-', '_'))
            WHEN 'owner' THEN 'owner'
            WHEN 'admin' THEN 'admin'
            WHEN 'manager' THEN 'manager'
            WHEN 'hr' THEN 'hr'
            WHEN 'hr_admin' THEN 'hr'
            WHEN 'hradmin' THEN 'hr'
            ELSE 'employee'
          END
        ) = v_role
      )
      AND (
        NULLIF(btrim(COALESCE(p_status, '')), '') IS NULL
        OR (p_status = 'active' AND e.is_active = true)
        OR (p_status = 'inactive' AND e.is_active = false)
      )
      AND (
        v_type IS NULL
        OR (
          CASE
            WHEN btrim(coalesce(e.employment_type, '')) = '' THEN 'permanent'
            WHEN lower(regexp_replace(btrim(e.employment_type), '[\s_]+', '-', 'g')) IN ('parttime', 'part-time') THEN 'part-time'
            ELSE lower(regexp_replace(btrim(e.employment_type), '[\s_]+', '-', 'g'))
          END
        ) = (
          CASE
            WHEN v_type IN ('parttime', 'part-time') THEN 'part-time'
            ELSE v_type
          END
        )
      )
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id OR EXISTS (
        SELECT 1 FROM public.employee_branch_assignments a
        WHERE a.employee_id = e.id AND a.branch_id = p_branch_id
      ))
  )
  SELECT count(*)::integer INTO v_total FROM scoped;

  WITH scoped AS (
    SELECT
      e.id,
      e.company_id,
      e.name,
      e.surname,
      e.employee_code,
      e.employee_number,
      e.id_number,
      e.email,
      e.phone,
      e.position,
      e.department,
      e.branch,
      e.branch_id,
      e.access_level,
      e.employment_type,
      e.is_active,
      e.manager_id,
      e.shift_template_id,
      e.enforce_branch_geofence
    FROM public.employees e
    WHERE e.company_id = p_company_id
      AND (v_sees_all OR e.id = ANY (v_ids))
      AND (
        v_search IS NULL
        OR strpos(lower(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.employee_number, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.employee_code, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.id_number, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.department, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.position, '')), lower(v_search)) > 0
      )
      AND (
        v_name IS NULL
        OR strpos(lower(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')), lower(v_name)) > 0
      )
      AND (
        v_emp_no IS NULL
        OR strpos(lower(coalesce(e.employee_number, '')), lower(v_emp_no)) > 0
        OR strpos(lower(coalesce(e.employee_code, '')), lower(v_emp_no)) > 0
      )
      AND (
        v_id_no IS NULL
        OR strpos(lower(coalesce(e.id_number, '')), lower(v_id_no)) > 0
      )
      AND (
        v_dept IS NULL
        OR strpos(lower(coalesce(e.department, '')), lower(v_dept)) > 0
      )
      AND (
        v_role IS NULL
        OR (
          CASE lower(replace(replace(coalesce(e.access_level, ''), ' ', '_'), '-', '_'))
            WHEN 'owner' THEN 'owner'
            WHEN 'admin' THEN 'admin'
            WHEN 'manager' THEN 'manager'
            WHEN 'hr' THEN 'hr'
            WHEN 'hr_admin' THEN 'hr'
            WHEN 'hradmin' THEN 'hr'
            ELSE 'employee'
          END
        ) = v_role
      )
      AND (
        NULLIF(btrim(COALESCE(p_status, '')), '') IS NULL
        OR (p_status = 'active' AND e.is_active = true)
        OR (p_status = 'inactive' AND e.is_active = false)
      )
      AND (
        v_type IS NULL
        OR (
          CASE
            WHEN btrim(coalesce(e.employment_type, '')) = '' THEN 'permanent'
            WHEN lower(regexp_replace(btrim(e.employment_type), '[\s_]+', '-', 'g')) IN ('parttime', 'part-time') THEN 'part-time'
            ELSE lower(regexp_replace(btrim(e.employment_type), '[\s_]+', '-', 'g'))
          END
        ) = (
          CASE
            WHEN v_type IN ('parttime', 'part-time') THEN 'part-time'
            ELSE v_type
          END
        )
      )
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id OR EXISTS (
        SELECT 1 FROM public.employee_branch_assignments a
        WHERE a.employee_id = e.id AND a.branch_id = p_branch_id
      ))
    ORDER BY lower(e.name), lower(e.surname), e.id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(scoped) ORDER BY lower(scoped.name), lower(scoped.surname), scoped.id), '[]'::jsonb)
    INTO v_rows
  FROM scoped;

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_employee_directory(
  uuid, text, text, text, text, uuid, integer, integer, text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_employee_directory(
  uuid, text, text, text, text, uuid, integer, integer, text, text, text, text
) TO authenticated, service_role;
