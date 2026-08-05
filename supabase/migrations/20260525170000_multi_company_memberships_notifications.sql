-- Multi-company memberships, in-app registration notifications, UUID app_notifications FKs.

TRUNCATE TABLE public.app_notification_deliveries, public.app_notifications RESTART IDENTITY CASCADE;
DROP POLICY IF EXISTS p_app_notifications_hr ON public.app_notifications;
DROP POLICY IF EXISTS p_app_notifications_hr_insert ON public.app_notifications;
DROP POLICY IF EXISTS p_app_notifications_employee ON public.app_notifications;
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_company_id_fkey,
  DROP CONSTRAINT IF EXISTS app_notifications_recipient_employee_id_fkey;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_notifications'
      AND column_name = 'company_id'
      AND udt_name = 'int8'
  ) THEN
    ALTER TABLE public.app_notifications
      ALTER COLUMN company_id TYPE uuid USING NULL,
      ALTER COLUMN recipient_employee_id TYPE uuid USING NULL;
  END IF;
END $$;
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_company_id_fkey,
  DROP CONSTRAINT IF EXISTS app_notifications_recipient_employee_id_fkey;
ALTER TABLE public.app_notifications
  ADD CONSTRAINT app_notifications_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD CONSTRAINT app_notifications_recipient_employee_id_fkey
    FOREIGN KEY (recipient_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;
CREATE POLICY p_app_notifications_hr ON public.app_notifications
  FOR ALL USING (
    audience IN ('hr', 'all')
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.user_id = auth.uid()
        AND e.company_id = app_notifications.company_id
        AND e.access_level IN ('owner', 'hr_admin', 'admin', 'manager', 'hr')
        AND e.is_active = true
    )
    AND (
      recipient_auth_user_id IS NULL
      OR recipient_auth_user_id = auth.uid()
    )
  );
CREATE POLICY p_app_notifications_hr_insert ON public.app_notifications
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.user_id = auth.uid()
        AND e.company_id = app_notifications.company_id
        AND e.access_level IN ('owner', 'hr_admin', 'admin', 'manager', 'hr')
        AND e.is_active = true
    )
    AND (
      (audience = 'employee' AND recipient_employee_id IS NOT NULL)
      OR (audience = 'hr' AND recipient_auth_user_id IS NOT NULL)
      OR audience = 'all'
    )
  );
DROP POLICY IF EXISTS p_app_notifications_employee ON public.app_notifications;
CREATE POLICY p_app_notifications_employee ON public.app_notifications
  FOR ALL TO authenticated
  USING (
    audience IN ('employee', 'all')
    AND (
      recipient_auth_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = recipient_employee_id
          AND e.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    audience IN ('employee', 'all')
    AND (
      recipient_auth_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = recipient_employee_id
          AND e.user_id = auth.uid()
      )
    )
  );
CREATE OR REPLACE FUNCTION public.approve_pending_employee(p_employee_id uuid)
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

    SELECT * INTO v_company FROM companies WHERE id = v_emp.company_id;

    INSERT INTO app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data
    ) VALUES (
      v_emp.company_id,
      'employee',
      v_emp.user_id,
      p_employee_id,
      'registration_approved',
      'Welcome to ' || coalesce(v_company.name, 'your company'),
      'Your account at ' || coalesce(v_company.name, 'this company') ||
        ' has been approved. Open My Companies to get started.',
      'employee',
      p_employee_id::text,
      'registration_approved:' || p_employee_id::text,
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
CREATE OR REPLACE FUNCTION public.employee_get_my_memberships(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

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
      WHERE e.user_id = p_user_id
    ) t
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_get_my_memberships(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.employee_get_my_notifications(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN (
    SELECT coalesce(json_agg(row_to_json(n) ORDER BY n.created_at DESC), '[]'::json)
    FROM (
      SELECT
        id, company_id, type, title, body, ref_type, ref_id,
        data, is_read, read_at, created_at
      FROM app_notifications
      WHERE audience IN ('employee', 'all')
        AND (
          recipient_auth_user_id = p_user_id
          OR recipient_employee_id IN (
            SELECT id FROM employees WHERE user_id = p_user_id
          )
        )
      ORDER BY created_at DESC
      LIMIT 50
    ) n
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_get_my_notifications(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.employee_mark_notification_read(
  p_user_id uuid,
  p_notification_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE app_notifications
  SET is_read = true, read_at = now()
  WHERE id = p_notification_id
    AND (
      recipient_auth_user_id = p_user_id
      OR recipient_employee_id IN (SELECT id FROM employees WHERE user_id = p_user_id)
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_mark_notification_read(uuid, bigint) TO authenticated;
