-- Wave 3 — Assets lifecycle: employee custody assignment
-- site_id / unit_id already exist on assets.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS assigned_employee_id uuid
    REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_assigned_employee
  ON public.assets (assigned_employee_id)
  WHERE assigned_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assets_company_status
  ON public.assets (company_id, status);

-- Optional status hardening (skip if legacy bad values exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assets_status_check'
  ) THEN
    -- Normalize known MAUI drift before adding check
    UPDATE public.assets
    SET status = 'out_of_service'
    WHERE lower(coalesce(status, '')) IN ('maintenance', 'oos');

    ALTER TABLE public.assets
      ADD CONSTRAINT assets_status_check
      CHECK (status IS NULL OR status IN ('active', 'out_of_service', 'retired'));
  END IF;
EXCEPTION
  WHEN others THEN
    -- Do not fail migration if historical statuses cannot be constrained
    RAISE NOTICE 'assets_status_check skipped: %', SQLERRM;
END $$;
