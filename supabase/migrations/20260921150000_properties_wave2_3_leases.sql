-- ============================================================
-- Properties Wave 2–3: owner/manager fields, leases, documents
-- client_id on sites remains the owner/principal client link.
-- ============================================================

-- ── Wave 2: site columns ─────────────────────────────────────
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS property_kind text NOT NULL DEFAULT 'residential'
    CHECK (property_kind IN ('residential', 'commercial', 'mixed', 'other'));

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS managed_by_employee_id uuid
    REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sites_managed_by
  ON public.sites (managed_by_employee_id)
  WHERE managed_by_employee_id IS NOT NULL;

COMMENT ON COLUMN public.sites.client_id IS
  'Owner / principal client for this property (optional).';
COMMENT ON COLUMN public.sites.managed_by_employee_id IS
  'Staff member managing this property on behalf of the owner.';
COMMENT ON COLUMN public.sites.property_kind IS
  'High-level property classification for portfolio filtering.';

-- ── Wave 3: property_leases ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_leases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id             uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  unit_id             uuid REFERENCES public.units(id) ON DELETE SET NULL,
  resident_id         uuid REFERENCES public.residents(id) ON DELETE SET NULL,
  tenant_client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  tenant_name         text,
  start_date          date NOT NULL,
  end_date            date,
  rent_amount         numeric(14, 2),
  deposit_amount      numeric(14, 2),
  currency            text NOT NULL DEFAULT 'ZAR',
  payment_frequency   text NOT NULL DEFAULT 'monthly'
    CHECK (payment_frequency IN ('monthly', 'weekly', 'other')),
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'ended', 'cancelled')),
  notes               text,
  created_by          uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_leases_has_tenant CHECK (
    resident_id IS NOT NULL
    OR tenant_client_id IS NOT NULL
    OR (tenant_name IS NOT NULL AND length(trim(tenant_name)) > 0)
  ),
  CONSTRAINT property_leases_dates_ok CHECK (
    end_date IS NULL OR end_date >= start_date
  )
);

CREATE INDEX IF NOT EXISTS idx_property_leases_site
  ON public.property_leases (site_id, status);

CREATE INDEX IF NOT EXISTS idx_property_leases_company
  ON public.property_leases (company_id, status);

CREATE INDEX IF NOT EXISTS idx_property_leases_unit
  ON public.property_leases (unit_id)
  WHERE unit_id IS NOT NULL;

COMMENT ON TABLE public.property_leases IS
  'Lease / occupancy agreements for property units — not commercial invoices.';

ALTER TABLE public.property_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_leases_select ON public.property_leases;
DROP POLICY IF EXISTS property_leases_insert ON public.property_leases;
DROP POLICY IF EXISTS property_leases_update ON public.property_leases;
DROP POLICY IF EXISTS property_leases_delete ON public.property_leases;

CREATE POLICY property_leases_select ON public.property_leases
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.view')
  );

CREATE POLICY property_leases_insert ON public.property_leases
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
    AND EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = property_leases.site_id
        AND s.company_id = property_leases.company_id
    )
  );

CREATE POLICY property_leases_update ON public.property_leases
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

CREATE POLICY property_leases_delete ON public.property_leases
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_leases TO authenticated;
REVOKE ALL ON public.property_leases FROM anon;

-- ── property_lease_documents ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_lease_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lease_id          uuid NOT NULL REFERENCES public.property_leases(id) ON DELETE CASCADE,
  document_name     text NOT NULL,
  document_type     text NOT NULL DEFAULT 'lease'
    CHECK (document_type IN ('lease', 'id', 'addendum', 'other')),
  storage_path      text NOT NULL,
  file_url          text,
  file_size_bytes   bigint,
  mime_type         text,
  uploaded_by       uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_lease_documents_name_not_blank CHECK (length(trim(document_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_property_lease_documents_lease
  ON public.property_lease_documents (lease_id, created_at DESC);

ALTER TABLE public.property_lease_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_lease_documents_select ON public.property_lease_documents;
DROP POLICY IF EXISTS property_lease_documents_insert ON public.property_lease_documents;
DROP POLICY IF EXISTS property_lease_documents_update ON public.property_lease_documents;
DROP POLICY IF EXISTS property_lease_documents_delete ON public.property_lease_documents;

CREATE POLICY property_lease_documents_select ON public.property_lease_documents
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.view')
  );

CREATE POLICY property_lease_documents_insert ON public.property_lease_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

CREATE POLICY property_lease_documents_update ON public.property_lease_documents
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

CREATE POLICY property_lease_documents_delete ON public.property_lease_documents
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_lease_documents TO authenticated;
REVOKE ALL ON public.property_lease_documents FROM anon;

-- Storage folder for lease PDFs / IDs
DROP POLICY IF EXISTS p_workforce_media_hr_insert ON storage.objects;
CREATE POLICY p_workforce_media_hr_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] IN (
      'job_requests',
      'incident_reports',
      'job_cards',
      'leave_attachments',
      'employee_documents',
      'project_documents',
      'job_documents',
      'job_photos',
      'contractor_documents',
      'client_documents',
      'property_leases'
    )
  );

NOTIFY pgrst, 'reload schema';
