
-- 1. Add attachment_url column
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS attachment_url text;

-- 2. Allow anon uploads to leave_attachments folder in workforce-media bucket
DROP POLICY IF EXISTS p_workforce_media_anon_insert ON storage.objects;
CREATE POLICY p_workforce_media_anon_insert
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'workforce-media'
  AND (storage.foldername(name))[1] IN ('job_requests', 'incident_reports', 'job_cards', 'leave_attachments')
);

-- Ensure the bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('workforce-media', 'workforce-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. SECURITY DEFINER RPC so anon (code-login) employees can insert leave requests
CREATE OR REPLACE FUNCTION public.employee_submit_leave_request(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_leave_type    text,
  p_start_date    date,
  p_end_date      date,
  p_total_days    float,
  p_reason        text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_result json;
BEGIN
  -- Validate employee belongs to company
  IF NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE id = p_employee_id
      AND company_id = p_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'employee_not_found';
  END IF;

  -- Validate dates
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_dates';
  END IF;

  -- Insert leave request
  INSERT INTO public.leave_requests (
    id, company_id, employee_id, leave_type,
    start_date, end_date, total_days,
    reason, attachment_url, status, created_at
  )
  VALUES (
    gen_random_uuid(), p_company_id, p_employee_id, p_leave_type,
    p_start_date, p_end_date, p_total_days,
    p_reason, p_attachment_url, 'pending', now()
  )
  RETURNING id INTO v_id;

  SELECT row_to_json(r) INTO v_result
  FROM (
    SELECT id, company_id, employee_id, leave_type,
           start_date, end_date, total_days,
           reason, attachment_url, status,
           decision_note, approver_hr_user_id, decided_at,
           created_at
    FROM public.leave_requests
    WHERE id = v_id
  ) r;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_submit_leave_request(uuid, uuid, text, date, date, float, text, text) TO anon, authenticated;
;
