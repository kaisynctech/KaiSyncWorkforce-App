-- UUID client documents + notes (replace orphan bigint satellites).
-- Keep clients.notes as free-text summary on Information tab.

-- ── Drop unusable bigint orphans (0 files; 1 unmigratable test note) ───────
DROP TABLE IF EXISTS public.client_files CASCADE;
DROP TABLE IF EXISTS public.client_notes CASCADE;

-- ── client_documents ──────────────────────────────────────────────────────
CREATE TABLE public.client_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_name   text NOT NULL,
  document_type   text NOT NULL DEFAULT 'other'
    CHECK (document_type IN (
      'contract', 'msa', 'nda', 'insurance', 'purchase_order',
      'invoice', 'correspondence', 'other'
    )),
  file_url        text NOT NULL,
  storage_path    text,
  file_size_bytes bigint,
  mime_type       text,
  uploaded_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_documents_client_created
  ON public.client_documents (client_id, created_at DESC);
CREATE INDEX idx_client_documents_company_client
  ON public.client_documents (company_id, client_id);

COMMENT ON TABLE public.client_documents IS
  'Client-level CRM documents (contracts, MSAs, correspondence). Project docs remain in project_documents.';

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_documents_select ON public.client_documents
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.view')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_documents.client_id
        AND c.company_id = client_documents.company_id
    )
  );

CREATE POLICY client_documents_insert ON public.client_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_documents.client_id
        AND c.company_id = client_documents.company_id
    )
  );

CREATE POLICY client_documents_update ON public.client_documents
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

CREATE POLICY client_documents_delete ON public.client_documents
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_documents TO authenticated;
REVOKE ALL ON public.client_documents FROM anon;

-- ── client_notes (timeline) ───────────────────────────────────────────────
CREATE TABLE public.client_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_by  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_notes_client_created
  ON public.client_notes (client_id, created_at DESC);
CREATE INDEX idx_client_notes_company_client
  ON public.client_notes (company_id, client_id);

COMMENT ON TABLE public.client_notes IS
  'Client timeline notes (dated). Free-text clients.notes remains the Information summary.';

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_notes_select ON public.client_notes
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.view')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_notes.client_id
        AND c.company_id = client_notes.company_id
    )
  );

CREATE POLICY client_notes_insert ON public.client_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_notes.client_id
        AND c.company_id = client_notes.company_id
    )
  );

CREATE POLICY client_notes_update ON public.client_notes
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

CREATE POLICY client_notes_delete ON public.client_notes
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_notes TO authenticated;
REVOKE ALL ON public.client_notes FROM anon;

-- ── Storage: allow HR uploads under client_documents/ ─────────────────────
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
      'client_documents'
    )
  );
