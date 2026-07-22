-- Rejection in-app notification + realtime publication for membership updates.

ALTER TABLE public.employees REPLICA IDENTITY FULL;
ALTER TABLE public.app_notifications REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'employees'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_notifications;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.reject_pending_employee(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%rowtype;
  v_company companies%rowtype;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  PERFORM 1 FROM employees hr
  WHERE hr.user_id = auth.uid()
    AND hr.company_id = v_emp.company_id
    AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'manager', 'hr')
    AND hr.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to reject this registration';
  END IF;

  UPDATE employees
  SET registration_status = 'rejected',
      is_active = false
  WHERE id = p_employee_id;

  IF v_emp.user_id IS NOT NULL THEN
    SELECT * INTO v_company FROM companies WHERE id = v_emp.company_id;

    INSERT INTO app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data
    ) VALUES (
      v_emp.company_id,
      'employee',
      v_emp.user_id,
      p_employee_id,
      'registration_rejected',
      'Registration declined — ' || coalesce(v_company.name, 'company'),
      'Your request to join ' || coalesce(v_company.name, 'this company') ||
        ' was declined. Contact their HR team if you need help.',
      'employee',
      p_employee_id::text,
      'registration_rejected:' || p_employee_id::text,
      jsonb_build_object(
        'company_id', v_emp.company_id,
        'employee_id', p_employee_id,
        'company_name', v_company.name,
        'company_code', v_company.code
      )
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
END;
$$;
