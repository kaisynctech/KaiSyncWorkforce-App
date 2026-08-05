-- Phase 2B.3a: Contractor Compliance Packs — schema foundation.

-- ── 1. Extend document_type CHECK constraint ──────────────────────────────────

ALTER TABLE public.contractor_documents
  DROP CONSTRAINT IF EXISTS contractor_documents_type_chk;

ALTER TABLE public.contractor_documents
  ADD CONSTRAINT contractor_documents_type_chk
    CHECK (document_type IN (
      'company_registration',
      'tax_clearance',
      'vat_certificate',
      'bank_confirmation',
      'public_liability_insurance',
      'professional_indemnity',
      'coida',
      'health_safety_file',
      'contractor_agreement',
      'nda',
      'popia_agreement',
      'bbee_certificate',
      'proof_of_address',
      'id_document',
      'site_certification',
      'psira_registration',
      'fidelity_guarantee',
      'liquor_license',
      'food_safety_cert',
      'other'
    ));

-- ── 2. contractor_compliance_packs ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contractor_compliance_packs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  pack_code   text        NOT NULL,
  description text,
  is_default  bool        NOT NULL DEFAULT false,
  is_archived bool        NOT NULL DEFAULT false,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_compliance_pack_company_name UNIQUE (company_id, name),
  CONSTRAINT uq_compliance_pack_company_code UNIQUE (company_id, pack_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_pack_default
  ON public.contractor_compliance_packs (company_id)
  WHERE is_default = true AND is_archived = false;

-- ── 3. contractor_compliance_pack_items ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contractor_compliance_pack_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id       uuid        NOT NULL
                            REFERENCES public.contractor_compliance_packs(id)
                            ON DELETE CASCADE,
  document_type text        NOT NULL,
  requirement   text        NOT NULL DEFAULT 'required'
    CHECK (requirement IN ('required', 'recommended')),
  notes         text,
  sort_order    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pack_item_type UNIQUE (pack_id, document_type)
);

-- ── 4. contractors: add compliance_pack_id ────────────────────────────────────

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS compliance_pack_id uuid
    REFERENCES public.contractor_compliance_packs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contractors_compliance_pack
  ON public.contractors(compliance_pack_id)
  WHERE compliance_pack_id IS NOT NULL;

-- ── 5. Auto-maintain updated_at on packs ──────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_compliance_packs_updated_at
  BEFORE UPDATE ON public.contractor_compliance_packs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 6. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_compliance_packs_company
  ON public.contractor_compliance_packs(company_id, sort_order)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_compliance_pack_items_pack
  ON public.contractor_compliance_pack_items(pack_id, sort_order);

-- ── 7. Row-Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.contractor_compliance_packs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_pack_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_compliance_packs_authenticated ON public.contractor_compliance_packs;
CREATE POLICY p_compliance_packs_authenticated
  ON public.contractor_compliance_packs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_compliance_pack_items_authenticated ON public.contractor_compliance_pack_items;
CREATE POLICY p_compliance_pack_items_authenticated
  ON public.contractor_compliance_pack_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 8. Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.contractor_compliance_packs IS
  'Company-configurable compliance pack templates. Phase 2B.3a.';

COMMENT ON TABLE public.contractor_compliance_pack_items IS
  'Document type requirements within a compliance pack.';

COMMENT ON COLUMN public.contractors.compliance_pack_id IS
  'Assigned compliance pack. NULL = legacy is_required-per-document mode.';;
