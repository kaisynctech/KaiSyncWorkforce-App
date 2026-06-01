-- My PA tier 1–3: calendar OAuth scaffold, external events, preferences, delegation notify

CREATE TABLE IF NOT EXISTS public.employee_calendar_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('google', 'outlook')),
  calendar_id     text,
  calendar_label  text,
  access_token    text,
  refresh_token   text,
  token_expires_at timestamptz,
  sync_enabled    boolean NOT NULL DEFAULT true,
  last_sync_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, provider)
);

CREATE TABLE IF NOT EXISTS public.external_calendar_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('google', 'outlook', 'manual')),
  external_id     text NOT NULL,
  title           text NOT NULL,
  description     text,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz,
  is_all_day      boolean NOT NULL DEFAULT false,
  location        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_cal_events_employee_range
  ON public.external_calendar_events(employee_id, start_time);

CREATE TABLE IF NOT EXISTS public.employee_pa_settings (
  employee_id           uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  briefing_enabled      boolean NOT NULL DEFAULT true,
  focus_mode_enabled    boolean NOT NULL DEFAULT false,
  manager_digest_enabled boolean NOT NULL DEFAULT true,
  google_sync_enabled   boolean NOT NULL DEFAULT false,
  outlook_sync_enabled    boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pa_tasks
  ADD COLUMN IF NOT EXISTS delegated_by_employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS quick_capture text;

CREATE OR REPLACE FUNCTION public.upsert_employee_pa_settings(
  p_employee_id uuid,
  p_company_id uuid,
  p_briefing_enabled boolean DEFAULT NULL,
  p_focus_mode_enabled boolean DEFAULT NULL,
  p_manager_digest_enabled boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.employee_pa_settings (employee_id, company_id, briefing_enabled, focus_mode_enabled, manager_digest_enabled)
  VALUES (
    p_employee_id,
    p_company_id,
    COALESCE(p_briefing_enabled, true),
    COALESCE(p_focus_mode_enabled, false),
    COALESCE(p_manager_digest_enabled, true)
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    briefing_enabled = COALESCE(p_briefing_enabled, employee_pa_settings.briefing_enabled),
    focus_mode_enabled = COALESCE(p_focus_mode_enabled, employee_pa_settings.focus_mode_enabled),
    manager_digest_enabled = COALESCE(p_manager_digest_enabled, employee_pa_settings.manager_digest_enabled),
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_employee_pa_settings(uuid, uuid, boolean, boolean, boolean) TO authenticated;

ALTER TABLE public.employee_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_pa_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_employee_calendar_connections_own') THEN
    CREATE POLICY p_employee_calendar_connections_own ON public.employee_calendar_connections
      FOR ALL USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_external_calendar_events_own') THEN
    CREATE POLICY p_external_calendar_events_own ON public.external_calendar_events
      FOR ALL USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_employee_pa_settings_own') THEN
    CREATE POLICY p_employee_pa_settings_own ON public.employee_pa_settings
      FOR ALL USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
  END IF;
END $$;
