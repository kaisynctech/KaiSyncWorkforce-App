
CREATE OR REPLACE FUNCTION public.employee_update_leave_request(
  p_id             uuid,
  p_employee_id    uuid,
  p_leave_type     text,
  p_start_date     date,
  p_end_date       date,
  p_total_days     float,
  p_reason         text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  -- Only allow edits on pending rows that belong to this employee
  IF NOT EXISTS (
    SELECT 1 FROM public.leave_requests
    WHERE id = p_id
      AND employee_id = p_employee_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'leave_request_not_editable';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_dates';
  END IF;

  UPDATE public.leave_requests
  SET
    leave_type     = p_leave_type,
    start_date     = p_start_date,
    end_date       = p_end_date,
    total_days     = p_total_days,
    reason         = p_reason,
    attachment_url = p_attachment_url
  WHERE id = p_id;

  SELECT row_to_json(r) INTO v_result
  FROM (
    SELECT id, company_id, employee_id, leave_type,
           start_date, end_date, total_days,
           reason, attachment_url, status,
           decision_note, approver_hr_user_id, decided_at,
           created_at
    FROM public.leave_requests
    WHERE id = p_id
  ) r;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_update_leave_request(uuid, uuid, text, date, date, float, text, text) TO anon, authenticated;
;
