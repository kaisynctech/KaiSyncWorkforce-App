-- Delivery channels for app_notifications

CREATE TABLE IF NOT EXISTS public.app_notification_deliveries (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  notification_id bigint NOT NULL REFERENCES public.app_notifications(id) ON DELETE CASCADE,
  channel text NOT NULL, -- email, push
  recipient_email text,
  recipient_employee_id bigint REFERENCES public.employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', -- pending, sent, failed, skipped
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_notification_deliveries_channel_chk'
      AND conrelid = 'public.app_notification_deliveries'::regclass
  ) THEN
    ALTER TABLE public.app_notification_deliveries
      ADD CONSTRAINT app_notification_deliveries_channel_chk
      CHECK (channel IN ('email','push'));
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_notification_deliveries_status_chk'
      AND conrelid = 'public.app_notification_deliveries'::regclass
  ) THEN
    ALTER TABLE public.app_notification_deliveries
      ADD CONSTRAINT app_notification_deliveries_status_chk
      CHECK (status IN ('pending','sent','failed','skipped'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending
  ON public.app_notification_deliveries(status, created_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_delivery_unique
  ON public.app_notification_deliveries(notification_id, channel, coalesce(recipient_email, ''), coalesce(recipient_employee_id, 0));
ALTER TABLE public.app_notification_deliveries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_app_notification_deliveries_hr') THEN
    CREATE POLICY p_app_notification_deliveries_hr ON public.app_notification_deliveries
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.employee_push_tokens (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_push_token
  ON public.employee_push_tokens(company_id, employee_id, token);
ALTER TABLE public.employee_push_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_employee_push_tokens_hr') THEN
    CREATE POLICY p_employee_push_tokens_hr ON public.employee_push_tokens
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
