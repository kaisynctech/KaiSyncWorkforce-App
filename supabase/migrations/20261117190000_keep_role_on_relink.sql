-- 20261117190000_keep_role_on_relink
-- Restored on 2026-11-24 from the live database. Applied to production on 17 Nov 2026 in the SQL editor.
-- Re-linking a person to a company keeps their role (owner/admin/hr/manager) instead of resetting it to employee.

CREATE OR REPLACE FUNCTION public._relationship_role_for(p_access_level text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE lower(coalesce(p_access_level, 'employee'))
    WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' WHEN 'hr' THEN 'hr' WHEN 'hr_admin' THEN 'hr'
    WHEN 'manager' THEN 'manager' ELSE 'employee' END;
$function$;
REVOKE ALL ON FUNCTION public._relationship_role_for(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._relationship_role_for(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._relationship_role_for(text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_self_register(p_user_id uuid, p_email text, p_first_name text, p_last_name text, p_company_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company  companies%rowtype;
  v_employee employees%rowtype;
BEGIN
  SELECT * INTO v_company FROM companies WHERE code = upper(trim(p_company_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found. Check the code from your employer.';
  END IF;

  SELECT * INTO v_employee
  FROM employees
  WHERE company_id = v_company.id
    AND lower(email) = lower(trim(p_email))
  ORDER BY
    CASE registration_status
      WHEN 'active' THEN 0
      WHEN 'pending' THEN 1
      ELSE 2
    END,
    created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_employee.registration_status = 'rejected' THEN
      RAISE EXCEPTION 'Your registration was declined. Contact your HR administrator.';
    END IF;

    IF v_employee.is_active AND v_employee.registration_status = 'active' THEN
      UPDATE employees
      SET user_id = p_user_id,
          registration_status = 'active',
          login_password_ready = true
      WHERE id = v_employee.id;

      -- Keep the person's real role (owner, admin, HR, manager): never demote on re-link.
      INSERT INTO company_relationships (user_id, company_id, role, is_active)
      VALUES (p_user_id, v_company.id, public._relationship_role_for(v_employee.access_level), true)
      ON CONFLICT (user_id, company_id)
      DO UPDATE SET is_active = true, role = EXCLUDED.role;

      RETURN json_build_object(
        'status', 'linked',
        'employee_id', v_employee.id,
        'company_id', v_company.id,
        'access_level', v_employee.access_level
      );
    END IF;

    IF v_employee.registration_status = 'pending' THEN
      UPDATE employees
      SET user_id = p_user_id,
          name = trim(p_first_name),
          surname = trim(p_last_name),
          email = lower(trim(p_email))
      WHERE id = v_employee.id;

      RETURN json_build_object(
        'status', 'pending',
        'employee_id', v_employee.id,
        'company_id', v_company.id,
        'company_name', v_company.name
      );
    END IF;
  END IF;

  INSERT INTO employees (
    id, company_id, user_id, name, surname, email,
    is_active, registration_status, access_level, employment_type, worker_type,
    login_password_ready
  )
  VALUES (
    gen_random_uuid(), v_company.id, p_user_id, trim(p_first_name), trim(p_last_name), lower(trim(p_email)),
    false, 'pending', 'employee', 'permanent', 'employee', true
  )
  RETURNING * INTO v_employee;

  RETURN json_build_object(
    'status', 'pending',
    'employee_id', v_employee.id,
    'company_id', v_company.id,
    'company_name', v_company.name
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.employee_self_register(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_self_register(uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_self_register(uuid,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.employee_self_register(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_self_register(uuid,text,text,text,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.approve_pending_employee(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp     employees%ROWTYPE;
  v_company companies%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- SF-2 fix: replace legacy access_level self-join with get_my_role
  IF get_my_role(v_emp.company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'Not authorized to approve this registration';
  END IF;

  UPDATE employees
  SET registration_status  = 'active',
      is_active            = true,
      login_password_ready = true
  WHERE id = p_employee_id;

  IF v_emp.user_id IS NOT NULL THEN
    -- Keep the person's real role (owner, admin, HR, manager): never demote on approval.
    INSERT INTO company_relationships (user_id, company_id, role, is_active)
    VALUES (v_emp.user_id, v_emp.company_id, public._relationship_role_for(v_emp.access_level), true)
    ON CONFLICT (user_id, company_id)
    DO UPDATE SET is_active = true, role = EXCLUDED.role;

    SELECT * INTO v_company FROM companies WHERE id = v_emp.company_id;

    INSERT INTO app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data
    ) VALUES (
      v_emp.company_id, 'employee', v_emp.user_id, p_employee_id,
      'registration_approved',
      'Welcome to ' || coalesce(v_company.name, 'your company'),
      'Your account at ' || coalesce(v_company.name, 'this company') ||
        ' has been approved. Open My Companies to get started.',
      'employee', p_employee_id::text,
      'registration_approved:' || p_employee_id::text,
      jsonb_build_object(
        'company_id',   v_emp.company_id,
        'employee_id',  p_employee_id,
        'company_name', v_company.name,
        'company_code', v_company.code
      )
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;

  BEGIN
    PERFORM write_audit_event(
      v_emp.company_id,
      'employee.registration_approved',
      'employee',
      p_employee_id::text,
      jsonb_build_object('registration_status', 'pending'),
      jsonb_build_object('registration_status', 'active')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.approve_pending_employee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pending_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pending_employee(uuid) TO service_role;

