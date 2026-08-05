CREATE OR REPLACE FUNCTION public.enqueue_daily_operational_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count int := 0;
  total_count int := 0;
BEGIN
  -- Completed jobs missing feedback for >24h
  INSERT INTO public.app_reminders (company_id, reminder_type, target_ref, payload, scheduled_for)
  SELECT
    j.company_id,
    'missing_feedback',
    j.id::text,
    jsonb_build_object('job_id', j.id, 'title', j.title),
    now()
  FROM public.jobs j
  LEFT JOIN public.job_feedback jf ON jf.job_id = j.id
  WHERE j.status = 'completed'
    AND j.closed_at IS NOT NULL
    AND j.closed_at <= now() - interval '24 hours'
    AND jf.id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.app_reminders r
      WHERE r.reminder_type = 'missing_feedback'
        AND r.target_ref = j.id::text
        AND r.status = 'pending'
    );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  total_count := total_count + inserted_count;

  -- Pending contractor approvals in current month
  INSERT INTO public.app_reminders (company_id, reminder_type, target_ref, payload, scheduled_for)
  SELECT
    pa.company_id,
    'pending_contractor_approvals',
    pa.id::text,
    jsonb_build_object('employee_id', pa.employee_id, 'period_start', pa.period_start),
    now()
  FROM public.payment_approvals pa
  JOIN public.employees e ON e.id = pa.employee_id
  WHERE e.worker_type IN ('contractor','subcontractor')
    AND pa.period_start = date_trunc('month', now())::date
    AND coalesce(pa.status, 'pending') = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.app_reminders r
      WHERE r.reminder_type = 'pending_contractor_approvals'
        AND r.target_ref = pa.id::text
        AND r.status = 'pending'
    );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  total_count := total_count + inserted_count;

  -- Overdue client payments
  INSERT INTO public.app_reminders (company_id, reminder_type, target_ref, payload, scheduled_for)
  SELECT
    cp.company_id,
    'overdue_client_payment',
    cp.id::text,
    jsonb_build_object('deal_id', cp.deal_id, 'amount_due', cp.amount_due, 'due_date', cp.due_date),
    now()
  FROM public.client_payments cp
  WHERE cp.due_date IS NOT NULL
    AND cp.due_date < now()::date
    AND coalesce(cp.status, '') <> 'paid'
    AND NOT EXISTS (
      SELECT 1 FROM public.app_reminders r
      WHERE r.reminder_type = 'overdue_client_payment'
        AND r.target_ref = cp.id::text
        AND r.status = 'pending'
    );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  total_count := total_count + inserted_count;

  RETURN total_count;
END;
$$;
