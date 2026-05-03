-- ============================================================
-- Asset register: physical things to maintain.
-- Geysers, lifts, electrical boards, fire equipment, HVAC, etc.
-- Linked to a site (always) and optionally a unit.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assets (
  id              bigserial PRIMARY KEY,
  company_id      bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id         bigint REFERENCES public.sites(id)     ON DELETE CASCADE,
  unit_id         bigint REFERENCES public.units(id)     ON DELETE SET NULL,
  asset_type      text   NOT NULL,
  label           text   NOT NULL,
  manufacturer    text,
  model_number    text,
  serial_number   text,
  install_date    date,
  warranty_expires date,
  status          text DEFAULT 'active'
                  CHECK (status IN ('active','retired','out_of_service')),
  notes           text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_company_id ON public.assets(company_id);
CREATE INDEX IF NOT EXISTS idx_assets_site_id    ON public.assets(site_id);
CREATE INDEX IF NOT EXISTS idx_assets_unit_id    ON public.assets(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_type       ON public.assets(asset_type);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_assets_all_hr_company') THEN
    CREATE POLICY p_assets_all_hr_company ON public.assets
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.inspection_schedules (
  id                  bigserial PRIMARY KEY,
  company_id          bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  asset_id            bigint REFERENCES public.assets(id)    ON DELETE CASCADE,
  inspection_type     text NOT NULL,
  frequency_months    int  NOT NULL CHECK (frequency_months > 0),
  last_completed_at   timestamptz,
  next_due_date       date NOT NULL,
  is_active           boolean DEFAULT true,
  notes               text,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insp_sched_company  ON public.inspection_schedules(company_id);
CREATE INDEX IF NOT EXISTS idx_insp_sched_asset    ON public.inspection_schedules(asset_id);
CREATE INDEX IF NOT EXISTS idx_insp_sched_next_due ON public.inspection_schedules(next_due_date) WHERE is_active = true;
ALTER TABLE public.inspection_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_insp_sched_all_hr_company') THEN
    CREATE POLICY p_insp_sched_all_hr_company ON public.inspection_schedules
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.asset_inspections (
  id                  bigserial PRIMARY KEY,
  company_id          bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  asset_id            bigint REFERENCES public.assets(id)    ON DELETE CASCADE,
  schedule_id         bigint REFERENCES public.inspection_schedules(id) ON DELETE SET NULL,
  job_id              bigint REFERENCES public.jobs(id)      ON DELETE SET NULL,
  inspection_type     text NOT NULL,
  performed_at        timestamptz NOT NULL DEFAULT now(),
  performed_by        bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  result              text NOT NULL CHECK (result IN ('pass','fail','conditional')),
  findings            text,
  photo_urls          text[] DEFAULT '{}',
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_insp_company  ON public.asset_inspections(company_id);
CREATE INDEX IF NOT EXISTS idx_asset_insp_asset    ON public.asset_inspections(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_insp_when     ON public.asset_inspections(performed_at DESC);
ALTER TABLE public.asset_inspections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_asset_insp_all_hr_company') THEN
    CREATE POLICY p_asset_insp_all_hr_company ON public.asset_inspections
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.asset_certificates (
  id                  bigserial PRIMARY KEY,
  company_id          bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  asset_id            bigint REFERENCES public.assets(id)    ON DELETE CASCADE,
  certificate_type    text NOT NULL,
  issued_at           date NOT NULL,
  expires_at          date NOT NULL,
  issuer              text,
  document_url        text,
  notes               text,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_cert_company ON public.asset_certificates(company_id);
CREATE INDEX IF NOT EXISTS idx_asset_cert_asset   ON public.asset_certificates(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_cert_expires ON public.asset_certificates(expires_at);
ALTER TABLE public.asset_certificates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_asset_cert_all_hr_company') THEN
    CREATE POLICY p_asset_cert_all_hr_company ON public.asset_certificates
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

CREATE OR REPLACE VIEW public.v_compliance_calendar AS
SELECT
  a.company_id,
  a.id                            AS asset_id,
  a.label                         AS asset_label,
  a.asset_type,
  a.site_id,
  s.name                          AS site_name,
  a.unit_id,
  u.unit_number                   AS unit_number,
  insp.inspection_type,
  insp.frequency_months,
  insp.last_completed_at,
  insp.next_due_date,
  CASE
    WHEN insp.next_due_date IS NULL THEN 'no_schedule'
    WHEN insp.next_due_date < CURRENT_DATE THEN 'overdue'
    WHEN insp.next_due_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
    ELSE 'on_track'
  END                             AS inspection_status,
  CASE
    WHEN insp.next_due_date IS NULL THEN NULL
    ELSE (insp.next_due_date - CURRENT_DATE)
  END                             AS days_until_due,
  cert.certificate_type,
  cert.issued_at                  AS cert_issued_at,
  cert.expires_at                 AS cert_expires_at,
  CASE
    WHEN cert.expires_at IS NULL THEN 'no_certificate'
    WHEN cert.expires_at < CURRENT_DATE THEN 'expired'
    WHEN cert.expires_at <= CURRENT_DATE + INTERVAL '60 days' THEN 'expiring_soon'
    ELSE 'valid'
  END                             AS certificate_status
FROM public.assets a
LEFT JOIN public.sites s             ON s.id = a.site_id
LEFT JOIN public.units u             ON u.id = a.unit_id
LEFT JOIN LATERAL (
  SELECT inspection_type, frequency_months, last_completed_at, next_due_date
  FROM public.inspection_schedules
  WHERE asset_id = a.id AND is_active = true
  ORDER BY next_due_date ASC
  LIMIT 1
) insp ON true
LEFT JOIN LATERAL (
  SELECT certificate_type, issued_at, expires_at
  FROM public.asset_certificates
  WHERE asset_id = a.id
  ORDER BY expires_at DESC
  LIMIT 1
) cert ON true
WHERE a.status = 'active';
