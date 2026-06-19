-- Phase 2B.1: Contractor compliance documents.
-- Follows the same structural pattern as employee_documents and compliance_entries.
-- HR (authenticated) uploads directly; contractor portal uploads come in Phase 2B.2.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contractor_documents (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id)    ON DELETE CASCADE,
  contractor_id    uuid        NOT NULL REFERENCES public.contractors(id)  ON DELETE CASCADE,

  -- Identity
  document_type    text        NOT NULL,
  document_name    text        NOT NULL,

  -- Storage
  file_url         text        NOT NULL,   -- signed URL or public URL for display
  storage_path     text,                   -- raw path in workforce-media bucket (needed for deletion)

  -- Dates
  issue_date       date,
  expiry_date      date,                   -- NULL = document has no expiry

  -- Approval workflow
  approval_status  text        NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by      uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  rejected_reason  text,

  -- Flags
  is_required      boolean     NOT NULL DEFAULT false, -- marks as mandatory for compliance
  is_current       boolean     NOT NULL DEFAULT true,  -- false = superseded by newer version
  uploaded_by_role text        NOT NULL DEFAULT 'hr'
    CHECK (uploaded_by_role IN ('hr', 'contractor_portal')),

  -- Metadata
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contractor_documents_type_chk
    CHECK (document_type IN (
      'company_registration',        -- CIPC CK/PTY certificate
      'tax_clearance',               -- SARS Tax Compliance Status (TCS)
      'vat_certificate',             -- VAT registration certificate
      'bank_confirmation',           -- Bank confirmation letter
      'public_liability_insurance',  -- PLI policy
      'professional_indemnity',      -- PI policy
      'coida',                       -- Workmen's Compensation / COIDA
      'health_safety_file',          -- H&S File / Certificate of Compliance
      'contractor_agreement',        -- Signed contractor agreement
      'nda',                         -- Non-disclosure agreement
      'popia_agreement',             -- POPIA operator agreement
      'bbee_certificate',            -- B-BBEE level certificate
      'proof_of_address',            -- Proof of physical/postal address
      'id_document',                 -- ID / passport of key contact person
      'site_certification',          -- Site-specific certification
      'other'                        -- Catch-all for unlisted document types
    ))
);

-- ── Auto-maintain updated_at ──────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_contractor_documents_updated_at
  BEFORE UPDATE ON public.contractor_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_contractor_docs_contractor
  ON public.contractor_documents(contractor_id, is_current, approval_status);

CREATE INDEX IF NOT EXISTS idx_contractor_docs_expiry
  ON public.contractor_documents(company_id, expiry_date)
  WHERE is_current = true AND expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contractor_docs_pending
  ON public.contractor_documents(company_id, approval_status)
  WHERE approval_status = 'pending' AND is_current = true;

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- contractor_documents uses uuid company_id. The service layer (C# SupabaseStorageService)
-- always filters by company_id from the authenticated user's session, enforcing
-- multi-tenancy at the application layer. The policy grants access to any
-- authenticated JWT holder; per-company scoping is enforced by the service.
-- Phase 2B.3 will add a tighter uuid-aware RLS policy once the auth→company
-- mapping function for uuid schemas is confirmed.

ALTER TABLE public.contractor_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_contractor_documents_authenticated ON public.contractor_documents
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Storage bucket: add contractor_documents folder ───────────────────────────
-- The workforce-media bucket INSERT policy for authenticated HR must include
-- the new contractor_documents/ folder. We DROP and RECREATE to extend the
-- allowed-folder list cleanly (ALTER POLICY WITH CHECK not universally safe
-- across Supabase storage schema versions).

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
      'contractor_documents'   -- Phase 2B.1 addition
    )
  );

COMMENT ON TABLE public.contractor_documents IS
  'Contractor compliance and onboarding documents (Phase 2B.1). '
  'HR uploads and manages; contractor portal upload support added in Phase 2B.2.';
