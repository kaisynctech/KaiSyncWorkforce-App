-- ============================================================
-- App notifications (employee + HR)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  audience text NOT NULL DEFAULT 'employee',
  recipient_employee_id bigint NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  recipient_auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  ref_type text,
  ref_id text,
  dedupe_key text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_notifications_audience_chk'
      AND conrelid = 'public.app_notifications'::regclass
  ) THEN
    ALTER TABLE public.app_notifications
      ADD CONSTRAINT app_notifications_audience_chk
      CHECK (audience IN ('employee','hr','all'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_notifications_recipient_emp
  ON public.app_notifications(company_id, recipient_employee_id, is_read, created_at DESC)
  WHERE recipient_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_notifications_recipient_hr
  ON public.app_notifications(company_id, recipient_auth_user_id, is_read, created_at DESC)
  WHERE recipient_auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_notifications_dedupe_key
  ON public.app_notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_app_notifications_hr') THEN
    CREATE POLICY p_app_notifications_hr ON public.app_notifications
      FOR ALL USING (
        audience IN ('hr','all')
        AND company_id = current_hr_company_id()
        AND (
          recipient_auth_user_id IS NULL
          OR recipient_auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_app_notifications_employee') THEN
    CREATE POLICY p_app_notifications_employee ON public.app_notifications
      FOR ALL USING (
        audience IN ('employee','all')
        AND EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.id = recipient_employee_id
            AND e.profile_id = auth.uid()
            AND e.company_id = app_notifications.company_id
        )
      );
  END IF;
END $$;
