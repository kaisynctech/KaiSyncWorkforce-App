-- Fix employee self-registration: no duplicate pending rows, company link on approve, HR auth.

CREATE OR REPLACE FUNCTION public.employee_self_register(
  p_user_id      uuid,
  p_email        text,
  p_first_name   text,
  p_last_name    text,
  p_company_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

      INSERT INTO company_relationships (user_id, company_id, role, is_active)
      VALUES (p_user_id, v_company.id, 'employee', true)
      ON CONFLICT (user_id, company_id)
      DO UPDATE SET is_active = true, role = 'employee';

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
$$;
CREATE OR REPLACE FUNCTION public.approve_pending_employee(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%rowtype;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  PERFORM 1 FROM employees hr
  WHERE hr.user_id = auth.uid()
    AND hr.company_id = v_emp.company_id
    AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'manager')
    AND hr.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to approve this registration';
  END IF;

  UPDATE employees
  SET registration_status = 'active',
      is_active = true,
      login_password_ready = true
  WHERE id = p_employee_id;

  IF v_emp.user_id IS NOT NULL THEN
    INSERT INTO company_relationships (user_id, company_id, role, is_active)
    VALUES (v_emp.user_id, v_emp.company_id, 'employee', true)
    ON CONFLICT (user_id, company_id)
    DO UPDATE SET is_active = true, role = 'employee';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.reject_pending_employee(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%rowtype;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  PERFORM 1 FROM employees hr
  WHERE hr.user_id = auth.uid()
    AND hr.company_id = v_emp.company_id
    AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'manager')
    AND hr.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to reject this registration';
  END IF;

  UPDATE employees
  SET registration_status = 'rejected',
      is_active = false
  WHERE id = p_employee_id;
END;
$$;
