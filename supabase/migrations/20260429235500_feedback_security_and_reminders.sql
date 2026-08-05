-- ============================================================
-- Feedback security + delivery tracking + reminder foundation
-- ============================================================

-- 1) Harden feedback request tokens
ALTER TABLE public.job_feedback
  ADD COLUMN IF NOT EXISTS request_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS request_token_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS request_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS request_open_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_send_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_sent_via text,
  ADD COLUMN IF NOT EXISTS request_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_source text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_feedback_request_sent_via_chk'
      AND conrelid = 'public.job_feedback'::regclass
  ) THEN
    ALTER TABLE public.job_feedback
      ADD CONSTRAINT job_feedback_request_sent_via_chk
      CHECK (
        request_sent_via IS NULL
        OR request_sent_via IN ('email','sms','whatsapp','on_device','link_copy')
      );
  END IF;
END $$;
-- 2) Delivery/event tracking per token
CREATE TABLE IF NOT EXISTS public.job_feedback_events (
  id bigserial PRIMARY KEY,
  company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  job_feedback_id bigint REFERENCES public.job_feedback(id) ON DELETE CASCADE,
  request_token text,
  event_type text NOT NULL,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_feedback_events_event_type_chk'
      AND conrelid = 'public.job_feedback_events'::regclass
  ) THEN
    ALTER TABLE public.job_feedback_events
      ADD CONSTRAINT job_feedback_events_event_type_chk
      CHECK (event_type IN ('requested','opened','submitted','rate_limited','rejected'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_job_feedback_events_token_time
  ON public.job_feedback_events(request_token, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_feedback_events_feedback_time
  ON public.job_feedback_events(job_feedback_id, created_at DESC);
ALTER TABLE public.job_feedback_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_job_feedback_events_all_hr_company') THEN
    CREATE POLICY p_job_feedback_events_all_hr_company ON public.job_feedback_events
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
-- 3) Payment approval workflow metadata
ALTER TABLE public.payment_approvals
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS decision_note text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_approvals_status_chk'
      AND conrelid = 'public.payment_approvals'::regclass
  ) THEN
    ALTER TABLE public.payment_approvals
      ADD CONSTRAINT payment_approvals_status_chk
      CHECK (status IN ('pending','approved','declined','partial'));
  END IF;
END $$;
-- 4) Daily reminder queue foundation (consumed by app/worker)
CREATE TABLE IF NOT EXISTS public.app_reminders (
  id bigserial PRIMARY KEY,
  company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  reminder_type text NOT NULL,
  target_ref text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_reminders_status_chk'
      AND conrelid = 'public.app_reminders'::regclass
  ) THEN
    ALTER TABLE public.app_reminders
      ADD CONSTRAINT app_reminders_status_chk
      CHECK (status IN ('pending','sent','failed','dismissed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_app_reminders_schedule
  ON public.app_reminders(status, scheduled_for);
ALTER TABLE public.app_reminders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_app_reminders_all_hr_company') THEN
    CREATE POLICY p_app_reminders_all_hr_company ON public.app_reminders
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enqueue_daily_operational_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count int := 0;
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

  RETURN inserted_count;
END;
$$;
