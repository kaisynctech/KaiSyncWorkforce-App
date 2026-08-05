set search_path = public;
-- ---------------------------------------------------------------------------
-- Contractor admin (employee app): HR-only RLS on employees / contractors /
-- contractor_members blocked invites and member CRUD. These SECURITY DEFINER
-- RPCs assert the caller is a contractor lead for the org, then perform the
-- mutation with row_security off. HR flows stay unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contractor_admin_assert(
  p_company_id bigint,
  p_contractor_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    JOIN public.contractor_members cm
      ON cm.employee_id = e.id
     AND cm.company_id = p_company_id
     AND cm.contractor_id = p_contractor_id
    WHERE e.company_id = p_company_id
      AND e.profile_id = auth.uid()
      AND (
        cm.is_primary = true
        OR lower(trim(coalesce(cm.role_label, ''))) IN ('owner', 'manager', 'lead')
      )
  )
  INTO v_ok;

  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'Not authorized as contractor admin';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.contractor_admin_assert(bigint, bigint) FROM public;
-- Who may trigger invite_worker: active HR for company OR contractor lead for
-- a contractor that includes the target employee (matched by email).
CREATE OR REPLACE FUNCTION public.invite_worker_actor_authorized(
  p_company_id bigint,
  p_actor_auth_uid uuid,
  p_target_email text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.hr_users h
      WHERE h.auth_user_id = p_actor_auth_uid
        AND h.company_id = p_company_id
        AND COALESCE(h.is_active, true)
    )
    OR EXISTS (
      SELECT 1
      FROM public.employees actor
      JOIN public.contractor_members cm_a
        ON cm_a.employee_id = actor.id
       AND cm_a.company_id = p_company_id
      JOIN public.employees target
        ON target.company_id = p_company_id
       AND lower(trim(coalesce(target.email, ''))) = lower(trim(coalesce(p_target_email, '')))
      JOIN public.contractor_members cm_t
        ON cm_t.employee_id = target.id
       AND cm_t.contractor_id = cm_a.contractor_id
       AND cm_t.company_id = p_company_id
      WHERE actor.profile_id = p_actor_auth_uid
        AND actor.company_id = p_company_id
        AND (
          cm_a.is_primary = true
          OR lower(trim(coalesce(cm_a.role_label, ''))) IN ('owner', 'manager', 'lead')
        )
    );
$$;
GRANT EXECUTE ON FUNCTION public.invite_worker_actor_authorized(bigint, uuid, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.contractor_admin_set_allow_all_jobs(
  p_company_id bigint,
  p_contractor_id bigint,
  p_allow boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.contractor_admin_assert(p_company_id, p_contractor_id);
  UPDATE public.contractors
  SET allow_members_view_all_jobs = p_allow,
      updated_at = now()
  WHERE id = p_contractor_id
    AND company_id = p_company_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.contractor_admin_set_allow_all_jobs(bigint, bigint, boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.contractor_admin_create_and_link_member(
  p_company_id bigint,
  p_contractor_id bigint,
  p_name text,
  p_surname text,
  p_email text,
  p_phone text,
  p_worker_type text,
  p_role_label text,
  p_is_primary boolean
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_wt text := lower(trim(coalesce(p_worker_type, 'contractor')));
  v_new_id bigint;
  v_code text;
BEGIN
  PERFORM public.contractor_admin_assert(p_company_id, p_contractor_id);

  IF v_wt NOT IN ('contractor', 'subcontractor') THEN
    RAISE EXCEPTION 'Invalid worker_type';
  END IF;

  INSERT INTO public.employees (
    company_id,
    name,
    surname,
    employee_code,
    employment_date,
    employment_type,
    employment_type_label,
    position,
    monthly_salary,
    hourly_rate,
    weekly_rate,
    daily_rate,
    work_days_weekly,
    daily_hours,
    branch,
    access_level,
    worker_type,
    invite_status,
    email,
    phone
  ) VALUES (
    p_company_id,
    coalesce(nullif(trim(p_name), ''), 'Member'),
    coalesce(nullif(trim(p_surname), ''), 'User'),
    '',
    CURRENT_DATE,
    'Contractor member',
    'Contractor member',
    'Contractor member',
    0,
    0,
    0,
    0,
    5,
    8,
    '',
    'employee',
    v_wt,
    'not_sent',
    CASE WHEN nullif(trim(lower(p_email)), '') IS NULL THEN NULL ELSE trim(lower(p_email)) END,
    CASE WHEN nullif(trim(p_phone), '') IS NULL THEN NULL ELSE trim(p_phone) END
  )
  RETURNING id INTO v_new_id;

  v_code := 'CTR-' || lpad(v_new_id::text, 6, '0');

  UPDATE public.employees
  SET employee_code = v_code
  WHERE id = v_new_id
    AND company_id = p_company_id;

  INSERT INTO public.contractor_members (
    company_id,
    contractor_id,
    employee_id,
    role_label,
    is_primary
  ) VALUES (
    p_company_id,
    p_contractor_id,
    v_new_id,
    nullif(trim(p_role_label), ''),
    coalesce(p_is_primary, false)
  );

  RETURN v_new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.contractor_admin_create_and_link_member(
  bigint, bigint, text, text, text, text, text, text, boolean
) TO authenticated;
CREATE OR REPLACE FUNCTION public.contractor_admin_replace_members(
  p_company_id bigint,
  p_contractor_id bigint,
  p_members jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  m jsonb;
  v_eid bigint;
  v_ok boolean;
BEGIN
  PERFORM public.contractor_admin_assert(p_company_id, p_contractor_id);

  IF p_members IS NULL OR jsonb_typeof(p_members) <> 'array' THEN
    RAISE EXCEPTION 'p_members must be a JSON array';
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(p_members)
  LOOP
    v_eid := nullif(trim(m->>'employee_id'), '')::bigint;
    IF v_eid IS NULL THEN
      RAISE EXCEPTION 'Invalid member row (employee_id)';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = v_eid AND e.company_id = p_company_id
    ) INTO v_ok;
    IF NOT coalesce(v_ok, false) THEN
      RAISE EXCEPTION 'Employee % not in company', v_eid;
    END IF;
  END LOOP;

  DELETE FROM public.contractor_members
  WHERE company_id = p_company_id
    AND contractor_id = p_contractor_id;

  FOR m IN SELECT * FROM jsonb_array_elements(p_members)
  LOOP
    v_eid := (m->>'employee_id')::bigint;
    INSERT INTO public.contractor_members (
      company_id,
      contractor_id,
      employee_id,
      role_label,
      is_primary
    ) VALUES (
      p_company_id,
      p_contractor_id,
      v_eid,
      nullif(trim(m->>'role_label'), ''),
      coalesce((m->>'is_primary')::boolean, false)
    );
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.contractor_admin_replace_members(bigint, bigint, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.contractor_admin_set_member_email(
  p_company_id bigint,
  p_contractor_id bigint,
  p_member_employee_id bigint,
  p_email text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_norm text := trim(lower(coalesce(p_email, '')));
BEGIN
  PERFORM public.contractor_admin_assert(p_company_id, p_contractor_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.contractor_members cm
    WHERE cm.company_id = p_company_id
      AND cm.contractor_id = p_contractor_id
      AND cm.employee_id = p_member_employee_id
  ) THEN
    RAISE EXCEPTION 'Member is not linked to this contractor';
  END IF;

  UPDATE public.employees e
  SET email = CASE WHEN v_norm = '' THEN NULL ELSE v_norm END
  WHERE e.id = p_member_employee_id
    AND e.company_id = p_company_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.contractor_admin_set_member_email(bigint, bigint, bigint, text) TO authenticated;
-- Allow contractor leads to insert their own audit rows (HR policy remains).
DROP POLICY IF EXISTS p_contractor_admin_events_contractor_admin_insert ON public.contractor_admin_events;
CREATE POLICY p_contractor_admin_events_contractor_admin_insert ON public.contractor_admin_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees e
      JOIN public.contractor_members cm
        ON cm.employee_id = e.id
       AND cm.contractor_id = contractor_admin_events.contractor_id
       AND cm.company_id = contractor_admin_events.company_id
      WHERE e.profile_id = auth.uid()
        AND e.company_id = contractor_admin_events.company_id
        AND (
          cm.is_primary = true
          OR lower(trim(coalesce(cm.role_label, ''))) IN ('owner', 'manager', 'lead')
        )
    )
    AND actor_employee_id IN (
      SELECT e2.id FROM public.employees e2
      WHERE e2.profile_id = auth.uid()
        AND e2.company_id = contractor_admin_events.company_id
    )
  );
