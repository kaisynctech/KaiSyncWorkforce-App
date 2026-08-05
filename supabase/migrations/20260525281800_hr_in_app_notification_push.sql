-- HR users receive in-app notifications (audience=hr) via realtime; include in get_my_notifications RPC.

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
      WHERE audience IN ('employee', 'hr', 'all')
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
