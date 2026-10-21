-- ONE compliance system, part 1 (schema). Applied 21 Oct 2026 via execute_sql in one transaction
-- (lock_timeout 5s). Recorded here so the repo matches the database. Additive; contractor rows unchanged.

ALTER TABLE public.contractor_compliance_packs
  ADD COLUMN IF NOT EXISTS party_kind text NOT NULL DEFAULT 'contractor';
ALTER TABLE public.contractor_compliance_packs
  ADD CONSTRAINT contractor_compliance_packs_party_kind_chk CHECK (party_kind IN ('contractor', 'client'));
ALTER TABLE public.contractor_compliance_packs DROP CONSTRAINT IF EXISTS uq_compliance_pack_company_name;
ALTER TABLE public.contractor_compliance_packs
  ADD CONSTRAINT uq_compliance_pack_company_kind_name UNIQUE (company_id, party_kind, name);

ALTER TABLE public.contractor_compliance_pack_items
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'from_party';
ALTER TABLE public.contractor_compliance_pack_items
  ADD CONSTRAINT contractor_compliance_pack_items_direction_chk CHECK (direction IN ('from_party', 'to_party'));

ALTER TABLE public.contractor_documents
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'from_party';
ALTER TABLE public.contractor_documents ALTER COLUMN contractor_id DROP NOT NULL;
ALTER TABLE public.contractor_documents
  ADD CONSTRAINT contractor_documents_direction_chk CHECK (direction IN ('from_party', 'to_party')),
  ADD CONSTRAINT contractor_documents_one_party_chk CHECK ((contractor_id IS NOT NULL) <> (client_id IS NOT NULL));
ALTER TABLE public.contractor_documents DROP CONSTRAINT IF EXISTS contractor_documents_uploaded_by_role_check;
ALTER TABLE public.contractor_documents
  ADD CONSTRAINT contractor_documents_uploaded_by_role_check CHECK (uploaded_by_role IN ('hr', 'contractor_portal', 'client_portal'));
ALTER TABLE public.contractor_documents DROP CONSTRAINT IF EXISTS contractor_documents_type_chk;
ALTER TABLE public.contractor_documents ADD CONSTRAINT contractor_documents_type_chk CHECK (document_type IN (
  'company_registration', 'tax_clearance', 'vat_certificate', 'bank_confirmation', 'public_liability_insurance',
  'professional_indemnity', 'coida', 'health_safety_file', 'contractor_agreement', 'nda', 'popia_agreement',
  'bbee_certificate', 'proof_of_address', 'id_document', 'site_certification', 'psira_registration',
  'fidelity_guarantee', 'liquor_license', 'food_safety_cert', 'other',
  'signed_msa', 'credit_application', 'procurement_rules', 'site_access_rules', 'our_safety_file',
  'our_coida_letter', 'our_public_liability', 'our_tax_clearance', 'our_bbee_certificate', 'induction_records'));
CREATE INDEX IF NOT EXISTS idx_contractor_documents_client ON public.contractor_documents (company_id, client_id) WHERE client_id IS NOT NULL;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS compliance_pack_id uuid REFERENCES public.contractor_compliance_packs(id);
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS compliance_grade text CHECK (compliance_grade IN ('A', 'B', 'C', 'D')),
  ADD COLUMN IF NOT EXISTS compliance_grade_reason text,
  ADD COLUMN IF NOT EXISTS compliance_grade_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_grade_set_by uuid;
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS compliance_grade text CHECK (compliance_grade IN ('A', 'B', 'C', 'D')),
  ADD COLUMN IF NOT EXISTS compliance_grade_reason text,
  ADD COLUMN IF NOT EXISTS compliance_grade_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_grade_set_by uuid;

-- The separate engine's mirror is retired: contractors stay on their own system.
ALTER TABLE public.contractors DISABLE TRIGGER zz_mirror_contractor_assignment;
ALTER TABLE public.contractor_documents DISABLE TRIGGER zz_mirror_contractor_document;
ALTER TABLE public.contractor_compliance_packs DISABLE TRIGGER zz_mirror_contractor_pack;
ALTER TABLE public.contractor_compliance_pack_items DISABLE TRIGGER zz_mirror_contractor_pack_item;
