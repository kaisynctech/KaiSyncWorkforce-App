-- Server-side code login sessions: company code 28 resolves to companies.code in Supabase.

CREATE TABLE IF NOT EXISTS public.employee_code_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token       text NOT NULL UNIQUE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  company_code        text NOT NULL,
  employee_login_code text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_employee_code_sessions_token
  ON public.employee_code_sessions(session_token)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_code_sessions_employee
  ON public.employee_code_sessions(employee_id)
  WHERE revoked_at IS NULL;
ALTER TABLE public.employee_code_sessions ENABLE ROW LEVEL SECURITY;
-- Restore id_number login + company fields on resolve.
DROP FUNCTION IF EXISTS public.employee_resolve_by_code(text, text);
CREATE OR REPLACE FUNCTION public.employee_resolve_by_code(p_company_code text, p_employee_code text)
RETURNS TABLE(
  company_id             uuid,
  employee_id            uuid,
  emp_user_id            uuid,
  employee_code          text,
  emp_name               text,
  emp_surname            text,
  employment_date        text,
  employment_type        text,
  emp_position           text,
  monthly_salary         numeric,
  hourly_rate            numeric,
  work_days_weekly       integer,
  daily_hours            numeric,
  emp_branch             text,
  access_level           text,
  login_password_ready   boolean,
  company_name           text,
  company_code           text,
  registration_status    text,
  is_active              boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id,
    e.id,
    e.user_id,
    COALESCE(e.employee_code, ''),
    COALESCE(e.name, ''),
    COALESCE(e.surname, ''),
    COALESCE(e.employment_date::text, ''),
    COALESCE(e.employment_type, ''),
    COALESCE(e.position, ''),
    COALESCE(e.monthly_salary, 0)::numeric,
    COALESCE(e.hourly_rate, 0)::numeric,
    COALESCE(e.work_days_weekly, 5)::integer,
    COALESCE(e.daily_hours, 8)::numeric,
    COALESCE(e.branch, ''),
    COALESCE(e.access_level, 'employee'),
    COALESCE(e.login_password_ready, false),
    COALESCE(c.name, ''),
    COALESCE(c.code, ''),
    COALESCE(e.registration_status, 'active'),
    COALESCE(e.is_active, true)
  FROM public.companies c
  JOIN public.employees e ON e.company_id = c.id
  WHERE (
    c.code = p_company_code
    OR (c.code ~ '^\d+$' AND p_company_code ~ '^\d+$'
        AND c.code::bigint = p_company_code::bigint)
  )
  AND (
    e.employee_code = p_employee_code
    OR e.id_number = p_employee_code
    OR (
      e.temp_login_code = p_employee_code
      AND e.temp_login_code_expires_at IS NOT NULL
      AND e.temp_login_code_expires_at > now()
    )
  )
  ORDER BY
    CASE WHEN e.temp_login_code = p_employee_code THEN 0
         WHEN e.employee_code = p_employee_code THEN 1
         ELSE 2 END,
    e.created_at
  LIMIT 1;
$function$;
GRANT EXECUTE ON FUNCTION public.employee_resolve_by_code(text, text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.employee_get_my_memberships_by_code(
  p_company_code text,
  p_employee_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT r.emp_user_id INTO v_uid
  FROM public.employee_resolve_by_code(p_company_code, p_employee_code) r
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN '[]'::json;
  END IF;

  IF v_uid IS NOT NULL THEN
    RETURN (
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.company_name), '[]'::json)
      FROM (
        SELECT
          e.id AS employee_id,
          e.company_id,
          e.registration_status,
          e.is_active,
          e.name,
          e.surname,
          e.position,
          e.branch,
          e.access_level,
          c.name AS company_name,
          c.code AS company_code
        FROM employees e
        JOIN companies c ON c.id = e.company_id
        WHERE e.user_id = v_uid
      ) t
    );
  END IF;

  RETURN (
    SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        r.employee_id,
        r.company_id,
        r.registration_status,
        r.is_active,
        r.emp_name AS name,
        r.emp_surname AS surname,
        r.emp_position AS position,
        r.emp_branch AS branch,
        r.access_level,
        r.company_name,
        r.company_code
      FROM public.employee_resolve_by_code(p_company_code, p_employee_code) r
    ) t
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_get_my_memberships_by_code(text, text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.employee_sign_in_with_code(
  p_company_code text,
  p_employee_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_token text;
  v_memberships json;
BEGIN
  SELECT * INTO v
  FROM public.employee_resolve_by_code(p_company_code, p_employee_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid company code or login code';
  END IF;

  IF v.registration_status = 'rejected' THEN
    RAISE EXCEPTION 'Registration was declined for this company';
  END IF;

  IF NOT v.is_active AND v.registration_status <> 'pending' THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE employee_id = v.employee_id
    AND revoked_at IS NULL;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  INSERT INTO public.employee_code_sessions (
    employee_id, company_id, company_code, employee_login_code, session_token
  ) VALUES (
    v.employee_id,
    v.company_id,
    v.company_code,
    trim(p_employee_code),
    v_token
  );

  v_memberships := public.employee_get_my_memberships_by_code(p_company_code, p_employee_code);

  RETURN json_build_object(
    'session_token', v_token,
    'employee', json_build_object(
      'id', v.employee_id,
      'company_id', v.company_id,
      'user_id', v.emp_user_id,
      'name', v.emp_name,
      'surname', v.emp_surname,
      'position', v.emp_position,
      'branch', v.emp_branch,
      'access_level', v.access_level,
      'employee_code', v.employee_code,
      'registration_status', v.registration_status,
      'is_active', v.is_active,
      'login_password_ready', v.login_password_ready
    ),
    'company', json_build_object(
      'id', v.company_id,
      'code', v.company_code,
      'name', v.company_name
    ),
    'memberships', v_memberships
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_sign_in_with_code(text, text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.employee_refresh_code_session(p_session_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess employee_code_sessions%ROWTYPE;
  v record;
  v_memberships json;
BEGIN
  SELECT * INTO v_sess
  FROM public.employee_code_sessions
  WHERE session_token = p_session_token
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Code session expired or invalid';
  END IF;

  SELECT * INTO v
  FROM public.employee_resolve_by_code(v_sess.company_code, v_sess.employee_login_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Login credentials no longer valid';
  END IF;

  UPDATE public.employee_code_sessions
  SET last_seen_at = now()
  WHERE id = v_sess.id;

  v_memberships := public.employee_get_my_memberships_by_code(
    v_sess.company_code,
    v_sess.employee_login_code
  );

  RETURN json_build_object(
    'session_token', v_sess.session_token,
    'employee', json_build_object(
      'id', v.employee_id,
      'company_id', v.company_id,
      'user_id', v.emp_user_id,
      'name', v.emp_name,
      'surname', v.emp_surname,
      'position', v.emp_position,
      'branch', v.emp_branch,
      'access_level', v.access_level,
      'employee_code', v.employee_code,
      'registration_status', v.registration_status,
      'is_active', v.is_active,
      'login_password_ready', v.login_password_ready
    ),
    'company', json_build_object(
      'id', v.company_id,
      'code', v.company_code,
      'name', v.company_name
    ),
    'memberships', v_memberships
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_refresh_code_session(text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.employee_revoke_code_session(p_session_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE session_token = p_session_token
    AND revoked_at IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_revoke_code_session(text) TO anon, authenticated;
