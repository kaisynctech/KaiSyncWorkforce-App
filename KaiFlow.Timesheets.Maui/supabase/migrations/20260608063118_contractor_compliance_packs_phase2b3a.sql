-- Phase 2B.3a: Contractor Compliance Packs — schema foundation.
--
-- What this migration does:
--   1. Extends contractor_documents.document_type CHECK constraint
--      with 4 SA-specific types (psira_registration, fidelity_guarantee,
--      liquor_license, food_safety_cert).
--   2. Creates contractor_compliance_packs (named templates per company).
--   3. Creates contractor_compliance_pack_items (required/recommended doc types per pack).
--   4. Adds compliance_pack_id FK (nullable) to contractors.
--
-- What this migration does NOT do:
--   - No data seeding (default packs are seeded by C# service on first use).
--   - No scoring changes (compliance_pack_id IS NULL → legacy is_required mode).
--   - No portal changes.
--
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS guards.

-- ── 1. Extend document_type CHECK constraint ──────────────────────────────────
--
-- DROP + ADD is the safest approach for Supabase (ALTER CONSTRAINT not supported
-- universally). This acquires ACCESS EXCLUSIVE for a short window; run during
-- low-traffic or use NOT VALID + VALIDATE pattern for large tables.

ALTER TABLE public.contractor_documents
  DROP CONSTRAINT IF EXISTS contractor_documents_type_chk;

ALTER TABLE public.contractor_documents
  ADD CONSTRAINT contractor_documents_type_chk
    CHECK (document_type IN (
      -- Original 15 types (Phase 2B.1)
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
      -- Phase 2B.3a additions (SA-specific sectors)
      'psira_registration',     -- PSIRA certificate for security contractors
      'fidelity_guarantee',     -- Fidelity/integrity guarantee (security/CIT)
      'liquor_license',         -- Liquor licence (retail/hospitality)
      'food_safety_cert',       -- Food handling / hygiene certificate
      'other'
    ));


-- ── 2. contractor_compliance_packs ────────────────────────────────────────────
--
-- Company-configurable named templates defining which document types are required
-- (or recommended) for a category of contractor.
--
-- is_default = true  → this pack is auto-assigned to new contractors (one per company).
-- is_archived = true → soft-deleted; hidden from UI but preserved for FK integrity.
-- pack_code          → slug used internally (e.g. 'security', 'general').

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

-- Only one active default pack per company (enforced at DB level).
-- Partial index: only counts is_default=true AND is_archived=false rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_pack_default
  ON public.contractor_compliance_packs (company_id)
  WHERE is_default = true AND is_archived = false;


-- ── 3. contractor_compliance_pack_items ───────────────────────────────────────
--
-- One row per document type per pack.
-- requirement: 'required'    → missing/invalid = score penalty + red indicator
--              'recommended' → advisory only, never blocks score
-- sort_order controls checklist display order in UI and portal.

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
--
-- NULL = no pack assigned → legacy is_required-per-document scoring (Phase 2B.1).
-- Non-NULL = pack-based scoring (Phase 2B.3c).
-- ON DELETE SET NULL: deleting a pack releases contractors from it gracefully.

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
-- Same permissive pattern as contractor_documents: application layer enforces
-- company scoping via the company_id filter in every service call.
-- Tighter RLS (company-scoped uuid check) is Phase 2B.3 hardening.

ALTER TABLE public.contractor_compliance_packs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_compliance_pack_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_compliance_packs_authenticated
  ON public.contractor_compliance_packs;
CREATE POLICY p_compliance_packs_authenticated
  ON public.contractor_compliance_packs
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_compliance_pack_items_authenticated
  ON public.contractor_compliance_pack_items;
CREATE POLICY p_compliance_pack_items_authenticated
  ON public.contractor_compliance_pack_items
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ── 8. Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.contractor_compliance_packs IS
  'Company-configurable compliance pack templates. Each pack defines which '
  'document types are required or recommended for a category of contractor. '
  'Phase 2B.3a — assignment to contractors in Phase 2B.3c.';

COMMENT ON TABLE public.contractor_compliance_pack_items IS
  'Document type requirements within a compliance pack. '
  'requirement: required (counts toward score) | recommended (advisory, not scored).';

COMMENT ON COLUMN public.contractors.compliance_pack_id IS
  'Assigned compliance pack. NULL = legacy is_required-per-document mode. '
  'Non-NULL = pack-based scoring (Phase 2B.3c).';
