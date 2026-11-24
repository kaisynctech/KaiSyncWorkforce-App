-- Stop the signed-in client from reading or writing PIN hashes and temporary login codes.
-- Table-level SELECT/INSERT would still cover those columns, so replace them with
-- column grants that omit the secrets. service_role keeps its existing table grants.

REVOKE SELECT, INSERT ON TABLE public.employees FROM anon, authenticated;

GRANT SELECT (
  id,
  user_id,
  company_id,
  name,
  surname,
  employee_code,
  employment_type,
  access_level,
  worker_type,
  position,
  branch,
  employment_date,
  hourly_rate,
  daily_rate,
  weekly_rate,
  monthly_salary,
  overtime_rate,
  double_time_rate,
  daily_hours,
  work_days_weekly,
  email,
  phone,
  manager_user_id,
  is_active,
  profile_photo_url,
  id_number,
  bank_account,
  bank_name,
  bank_branch_code,
  created_at,
  login_password_ready,
  employment_type_label,
  shift_template_id,
  registration_status,
  bank_details_updated_at,
  bank_details_updated_by,
  pay_basis,
  paye_rate_percent,
  uif_exempt,
  termination_date,
  medical_aid_deduction,
  pension_deduction,
  union_deduction,
  pay_full_monthly_salary,
  paye_fixed_amount,
  uif_rate_percent,
  uif_fixed_amount,
  tax_number,
  paye_reference,
  medical_aid_member_number,
  pension_fund_number,
  tax_directive_number,
  tax_directive_rate_percent,
  date_of_birth,
  cost_center,
  pin_set_at,
  pin_reset_required,
  pin_failed_attempts,
  pin_locked_until,
  login_failed_attempts,
  is_account_locked,
  locked_at,
  locked_reason,
  branch_id,
  manager_id,
  pay_by_hour,
  account_type,
  department
) ON TABLE public.employees TO anon, authenticated;

GRANT INSERT (
  id,
  user_id,
  company_id,
  name,
  surname,
  employee_code,
  employment_type,
  access_level,
  worker_type,
  position,
  branch,
  employment_date,
  hourly_rate,
  daily_rate,
  weekly_rate,
  monthly_salary,
  overtime_rate,
  double_time_rate,
  daily_hours,
  work_days_weekly,
  email,
  phone,
  manager_user_id,
  is_active,
  profile_photo_url,
  id_number,
  bank_account,
  bank_name,
  bank_branch_code,
  created_at,
  login_password_ready,
  employment_type_label,
  shift_template_id,
  registration_status,
  bank_details_updated_at,
  bank_details_updated_by,
  pay_basis,
  paye_rate_percent,
  uif_exempt,
  termination_date,
  medical_aid_deduction,
  pension_deduction,
  union_deduction,
  pay_full_monthly_salary,
  paye_fixed_amount,
  uif_rate_percent,
  uif_fixed_amount,
  tax_number,
  paye_reference,
  medical_aid_member_number,
  pension_fund_number,
  tax_directive_number,
  tax_directive_rate_percent,
  date_of_birth,
  cost_center,
  pin_set_at,
  pin_reset_required,
  pin_failed_attempts,
  pin_locked_until,
  login_failed_attempts,
  is_account_locked,
  locked_at,
  locked_reason,
  branch_id,
  manager_id,
  pay_by_hour,
  account_type,
  department
) ON TABLE public.employees TO anon, authenticated;

-- NULL means the viewer may see every employee in the company.
-- Otherwise the array is self, direct reports, and work-team expansion.
CREATE OR REPLACE FUNCTION public.hr_employee_scope_ids(
  p_company_id uuid,
  p_viewer_id uuid,
  p_user_id uuid,
  p_access text
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_ids uuid[];
  v_extra uuid[];
BEGIN
  v_role := lower(replace(replace(coalesce(p_access, ''), ' ', '_'), '-', '_'));
  IF v_role IN ('owner', 'admin', 'hr', 'hr_admin', 'hradmin') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(e.id), ARRAY[]::uuid[])
    INTO v_extra
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.id <> p_viewer_id
    AND (
      e.manager_id = p_viewer_id
      OR (p_user_id IS NOT NULL AND e.manager_user_id = p_user_id)
    );

  v_ids := ARRAY[p_viewer_id] || v_extra;

  SELECT COALESCE(array_agg(DISTINCT mid), ARRAY[]::uuid[])
    INTO v_extra
  FROM public.work_teams t
  CROSS JOIN LATERAL unnest(COALESCE(t.member_ids, ARRAY[]::uuid[])) AS mid
  WHERE t.company_id = p_company_id
    AND t.leader_employee_id = p_viewer_id;

  v_ids := v_ids || v_extra;

  SELECT COALESCE(array_agg(DISTINCT t.leader_employee_id), ARRAY[]::uuid[])
    INTO v_extra
  FROM public.work_teams t
  WHERE t.company_id = p_company_id
    AND t.leader_employee_id IS NOT NULL
    AND p_viewer_id = ANY (COALESCE(t.member_ids, ARRAY[]::uuid[]));

  v_ids := v_ids || v_extra;

  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[])
    INTO v_ids
  FROM unnest(v_ids) AS x;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_employee_scope_ids(uuid, uuid, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.employee_scope_state(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user uuid;
  v_access text;
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Company is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.id, e.user_id, e.access_level
    INTO v_id, v_user, v_access
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.user_id = auth.uid()
    AND e.is_active = true
  ORDER BY e.created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    IF public.platform_is_admin() THEN
      RETURN jsonb_build_object(
        'sees_all', true,
        'ids', NULL,
        'viewer', NULL
      );
    END IF;
    RAISE EXCEPTION 'Not a member of this company' USING ERRCODE = 'P0001';
  END IF;

  v_ids := public.hr_employee_scope_ids(p_company_id, v_id, v_user, v_access);

  RETURN jsonb_build_object(
    'sees_all', v_ids IS NULL,
    'ids', CASE WHEN v_ids IS NULL THEN NULL ELSE to_jsonb(v_ids) END,
    'viewer', jsonb_build_object(
      'id', v_id,
      'company_id', p_company_id,
      'user_id', v_user,
      'access_level', v_access
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_scope_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_scope_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.employee_can_view(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state jsonb;
  v_ids uuid[];
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.company_id = p_company_id
  ) THEN
    RETURN false;
  END IF;

  v_state := public.employee_scope_state(p_company_id);
  IF COALESCE((v_state ->> 'sees_all')::boolean, false) THEN
    RETURN true;
  END IF;

  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[])
    INTO v_ids
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(v_state -> 'ids') = 'array' THEN v_state -> 'ids'
      ELSE '[]'::jsonb
    END
  ) AS x;

  RETURN p_employee_id = ANY (v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.employee_can_view(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_can_view(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_employee_directory(
  p_company_id uuid,
  p_search text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state jsonb;
  v_sees_all boolean;
  v_ids uuid[];
  v_limit integer;
  v_offset integer;
  v_search text;
  v_role text;
  v_type text;
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

  WITH scoped AS (
    SELECT e.id
    FROM public.employees e
    WHERE e.company_id = p_company_id
      AND (v_sees_all OR e.id = ANY (v_ids))
      AND (
        v_search IS NULL
        OR strpos(lower(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.employee_code, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.department, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.position, '')), lower(v_search)) > 0
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
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
  )
  SELECT count(*)::integer INTO v_total FROM scoped;

  WITH scoped AS (
    SELECT
      e.id,
      e.company_id,
      e.name,
      e.surname,
      e.employee_code,
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
      e.shift_template_id
    FROM public.employees e
    WHERE e.company_id = p_company_id
      AND (v_sees_all OR e.id = ANY (v_ids))
      AND (
        v_search IS NULL
        OR strpos(lower(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.employee_code, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.department, '')), lower(v_search)) > 0
        OR strpos(lower(coalesce(e.position, '')), lower(v_search)) > 0
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
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
    ORDER BY lower(e.name), lower(e.surname), e.id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(scoped) ORDER BY lower(scoped.name), lower(scoped.surname), scoped.id), '[]'::jsonb)
    INTO v_rows
  FROM scoped;

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.list_employee_directory(uuid, text, text, text, text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_employee_directory(uuid, text, text, text, text, uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.list_employee_directory(uuid, text, text, text, text, uuid, integer, integer) IS
  'Paged employee directory. Owner, Admin, and HR see the company. Managers see their line and work teams. Omits secrets, pay, and banking.';
