-- CLIENT-COMPLIANCE-SPEC-001 step C1: shared compliance engine (clients now, contractors in C5).
-- Additive only: new tables (RLS on; reads for company members with view permission;
-- all writes through checked functions), starter document types, scoring function,
-- and the new "compliance.review" permission (owner/admin/hr by default).

-- 1. Document types (company_id NULL = system default list)
CREATE TABLE IF NOT EXISTS public.compliance_document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  party_kind text NOT NULL DEFAULT 'any' CHECK (party_kind IN ('client', 'contractor', 'any')),
  code text NOT NULL,
  label text NOT NULL,
  default_direction text NOT NULL DEFAULT 'from_party' CHECK (default_direction IN ('from_party', 'to_party')),
  default_validity_days integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_doc_types_system ON public.compliance_document_types (code) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_doc_types_company ON public.compliance_document_types (company_id, code) WHERE company_id IS NOT NULL;

-- 2. Packs and items
CREATE TABLE IF NOT EXISTS public.compliance_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('client', 'contractor')),
  name text NOT NULL,
  pack_code text,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  legacy_contractor_pack_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_packs_company ON public.compliance_packs (company_id, party_kind);

CREATE TABLE IF NOT EXISTS public.compliance_pack_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  pack_id uuid NOT NULL REFERENCES public.compliance_packs(id),
  document_type_code text NOT NULL,
  direction text NOT NULL DEFAULT 'from_party' CHECK (direction IN ('from_party', 'to_party')),
  requirement text NOT NULL DEFAULT 'required' CHECK (requirement IN ('required', 'recommended')),
  validity_days integer,
  expiry_required boolean NOT NULL DEFAULT false,
  weight numeric NOT NULL DEFAULT 1 CHECK (weight > 0),
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_pack_items_pack ON public.compliance_pack_items (pack_id) WHERE NOT is_archived;

-- 3. Per client/contractor status, score and HR grade
CREATE TABLE IF NOT EXISTS public.party_compliance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('client', 'contractor')),
  party_id uuid NOT NULL,
  pack_id uuid REFERENCES public.compliance_packs(id),
  status text NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'compliant', 'near', 'partial', 'non_compliant')),
  score integer NOT NULL DEFAULT 0,
  required_count integer NOT NULL DEFAULT 0,
  complete_count integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  expiring_count integer NOT NULL DEFAULT 0,
  expired_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  obligations_open integer NOT NULL DEFAULT 0,
  hr_grade text CHECK (hr_grade IN ('A', 'B', 'C', 'D')),
  hr_grade_reason text,
  hr_grade_set_by uuid,
  hr_grade_set_at timestamptz,
  last_evaluated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, party_kind, party_id)
);

CREATE TABLE IF NOT EXISTS public.party_grade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  party_kind text NOT NULL,
  party_id uuid NOT NULL,
  grade text,
  reason text,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_party_grade_history ON public.party_grade_history (company_id, party_kind, party_id, set_at DESC);

-- 4. Documents (both directions) and events
CREATE TABLE IF NOT EXISTS public.compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('client', 'contractor')),
  party_id uuid NOT NULL,
  document_type_code text NOT NULL,
  direction text NOT NULL DEFAULT 'from_party' CHECK (direction IN ('from_party', 'to_party')),
  document_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  issue_date date,
  expiry_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'superseded')),
  is_current boolean NOT NULL DEFAULT true,
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejected_reason text,
  uploaded_by_kind text NOT NULL CHECK (uploaded_by_kind IN ('hr', 'client_portal', 'contractor_portal', 'migration')),
  uploaded_by_id uuid,
  replaces_id uuid,
  notes text,
  legacy_source text,
  legacy_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_party ON public.compliance_documents (company_id, party_kind, party_id, document_type_code) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_compliance_documents_expiry ON public.compliance_documents (expiry_date) WHERE is_current AND status = 'approved';
CREATE INDEX IF NOT EXISTS idx_compliance_documents_pending ON public.compliance_documents (company_id, status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.compliance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  party_kind text NOT NULL,
  party_id uuid NOT NULL,
  document_id uuid,
  event text NOT NULL,
  actor_kind text NOT NULL,
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_events_party ON public.compliance_events (company_id, party_kind, party_id, created_at DESC);

-- 5. RLS: members with view permission may read their company's rows; no direct writes.
ALTER TABLE public.compliance_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_grade_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._can_view_party_kind(p_company_id uuid, p_kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_company_id = ANY (public.user_company_ids())
     AND CASE p_kind WHEN 'client' THEN public.user_has_permission(p_company_id, 'clients.view')
                     WHEN 'contractor' THEN public.user_has_permission(p_company_id, 'contractors.view')
                     ELSE public.user_has_permission(p_company_id, 'clients.view')
                          OR public.user_has_permission(p_company_id, 'contractors.view') END;
$$;

CREATE POLICY compliance_document_types_select ON public.compliance_document_types FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = ANY (public.user_company_ids()));
CREATE POLICY compliance_packs_select ON public.compliance_packs FOR SELECT TO authenticated
  USING (public._can_view_party_kind(company_id, party_kind));
CREATE POLICY compliance_pack_items_select ON public.compliance_pack_items FOR SELECT TO authenticated
  USING (public._can_view_party_kind(company_id, 'any'));
CREATE POLICY party_compliance_select ON public.party_compliance FOR SELECT TO authenticated
  USING (public._can_view_party_kind(company_id, party_kind));
CREATE POLICY party_grade_history_select ON public.party_grade_history FOR SELECT TO authenticated
  USING (public._can_view_party_kind(company_id, party_kind));
CREATE POLICY compliance_documents_select ON public.compliance_documents FOR SELECT TO authenticated
  USING (public._can_view_party_kind(company_id, party_kind));
CREATE POLICY compliance_events_select ON public.compliance_events FOR SELECT TO authenticated
  USING (public._can_view_party_kind(company_id, party_kind));

-- 6. Starter document types (system list)
INSERT INTO public.compliance_document_types (company_id, party_kind, code, label, default_direction, default_validity_days, sort_order)
SELECT NULL, v.kind, v.code, v.label, v.dir, v.days, v.ord FROM (VALUES
  ('any', 'company_registration', 'Company registration (CIPC)', 'from_party', NULL::int, 10),
  ('any', 'tax_clearance', 'Tax clearance / good standing (SARS)', 'from_party', 365, 20),
  ('any', 'vat_certificate', 'VAT registration certificate', 'from_party', NULL, 30),
  ('any', 'bbee_certificate', 'B-BBEE certificate / affidavit', 'from_party', 365, 40),
  ('any', 'bank_confirmation', 'Bank confirmation letter', 'from_party', NULL, 50),
  ('any', 'public_liability_insurance', 'Public liability insurance', 'from_party', 365, 60),
  ('any', 'coida', 'COIDA letter of good standing', 'from_party', 365, 70),
  ('any', 'health_safety_file', 'Health & safety file', 'from_party', 365, 80),
  ('any', 'nda', 'Non-disclosure agreement', 'from_party', NULL, 90),
  ('any', 'popia_agreement', 'POPIA agreement', 'from_party', NULL, 100),
  ('any', 'proof_of_address', 'Proof of address', 'from_party', 90, 110),
  ('any', 'id_document', 'ID / passport', 'from_party', NULL, 120),
  ('contractor', 'contractor_agreement', 'Contractor agreement', 'from_party', NULL, 130),
  ('contractor', 'professional_indemnity', 'Professional indemnity insurance', 'from_party', 365, 140),
  ('contractor', 'site_certification', 'Site certification', 'from_party', 365, 150),
  ('contractor', 'psira_registration', 'PSIRA registration', 'from_party', 365, 160),
  ('contractor', 'fidelity_guarantee', 'Fidelity guarantee', 'from_party', 365, 170),
  ('client', 'signed_msa', 'Signed master service agreement / SLA', 'from_party', NULL, 180),
  ('client', 'credit_application', 'Credit application', 'from_party', NULL, 190),
  ('client', 'procurement_rules', 'Purchase order / procurement rules', 'from_party', NULL, 200),
  ('client', 'site_access_rules', 'Site access rules & induction requirements', 'from_party', NULL, 210),
  ('client', 'our_safety_file', 'Our safety file', 'to_party', 365, 220),
  ('client', 'our_coida_letter', 'Our COIDA letter of good standing', 'to_party', 365, 230),
  ('client', 'our_public_liability', 'Our public liability insurance', 'to_party', 365, 240),
  ('client', 'our_tax_clearance', 'Our tax clearance', 'to_party', 365, 250),
  ('client', 'our_bbee_certificate', 'Our B-BBEE certificate', 'to_party', 365, 260),
  ('client', 'induction_records', 'Induction records', 'to_party', NULL, 270),
  ('any', 'other', 'Other', 'from_party', NULL, 999)
) AS v(kind, code, label, dir, days, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.compliance_document_types t WHERE t.company_id IS NULL AND t.code = v.code);

-- 7. Permission: compliance.review (owner/admin/hr yes, manager/employee no; changeable per company)
INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
SELECT c.id, r.role, 'compliance.review', r.allowed
FROM public.companies c
CROSS JOIN (VALUES ('owner', true), ('admin', true), ('hr', true), ('manager', false), ('employee', false)) AS r(role, allowed)
WHERE NOT EXISTS (SELECT 1 FROM public.company_role_permissions p
                  WHERE p.company_id = c.id AND p.role = r.role AND p.permission_key = 'compliance.review');

-- Reviewer check. Companies created later have no compliance.review row yet: then HR-level
-- roles that can edit clients/contractors may review (same as the default above).
CREATE OR REPLACE FUNCTION public.can_review_compliance(p_company_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role text;
BEGIN
  IF public.user_has_permission(p_company_id, 'compliance.review') THEN RETURN true; END IF;
  v_role := public.get_my_role(p_company_id);
  IF v_role IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.company_role_permissions
             WHERE company_id = p_company_id AND role = v_role AND permission_key = 'compliance.review') THEN
    RETURN false;
  END IF;
  RETURN v_role IN ('owner', 'admin', 'hr', 'hr_admin');
END;
$$;

-- 8. Scoring. Score = weighted share of REQUIRED from-party items that are approved and not
-- expired (expiring within 30 days still counts). Bands: 100 compliant, >=80 near,
-- >=50 partial, else non_compliant. To-party items are "our obligations" (not scored).
CREATE OR REPLACE FUNCTION public.evaluate_party_compliance(p_company_id uuid, p_party_kind text, p_party_id uuid)
RETURNS public.party_compliance
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_pack uuid;
  v_row public.party_compliance%ROWTYPE;
  v_total numeric := 0; v_done numeric := 0;
  v_req int := 0; v_complete int := 0; v_missing int := 0; v_pending int := 0;
  v_expiring int := 0; v_expired int := 0; v_rejected int := 0; v_oblig int := 0;
  v_score int; v_status text;
  it record; d record;
BEGIN
  INSERT INTO public.party_compliance (company_id, party_kind, party_id)
  VALUES (p_company_id, p_party_kind, p_party_id)
  ON CONFLICT (company_id, party_kind, party_id) DO NOTHING;
  SELECT pack_id INTO v_pack FROM public.party_compliance
  WHERE company_id = p_company_id AND party_kind = p_party_kind AND party_id = p_party_id;

  IF v_pack IS NOT NULL THEN
    FOR it IN
      SELECT * FROM public.compliance_pack_items
      WHERE pack_id = v_pack AND company_id = p_company_id AND NOT is_archived
    LOOP
      SELECT * INTO d FROM public.compliance_documents
      WHERE company_id = p_company_id AND party_kind = p_party_kind AND party_id = p_party_id
        AND document_type_code = it.document_type_code AND direction = it.direction
        AND is_current AND status <> 'superseded'
      ORDER BY created_at DESC LIMIT 1;

      IF it.direction = 'to_party' THEN
        IF d.id IS NULL OR d.status <> 'approved' OR (d.expiry_date IS NOT NULL AND d.expiry_date < current_date) THEN
          v_oblig := v_oblig + 1;
        END IF;
        CONTINUE;
      END IF;
      IF it.requirement <> 'required' THEN CONTINUE; END IF;

      v_req := v_req + 1;
      v_total := v_total + it.weight;
      IF d.id IS NULL THEN
        v_missing := v_missing + 1;
      ELSIF d.status = 'approved' AND (d.expiry_date IS NULL OR d.expiry_date >= current_date) THEN
        v_done := v_done + it.weight;
        v_complete := v_complete + 1;
        IF d.expiry_date IS NOT NULL AND d.expiry_date <= current_date + 30 THEN v_expiring := v_expiring + 1; END IF;
      ELSIF d.status = 'expired' OR (d.status = 'approved' AND d.expiry_date < current_date) THEN
        v_expired := v_expired + 1;
      ELSIF d.status = 'pending' THEN
        v_pending := v_pending + 1;
      ELSIF d.status = 'rejected' THEN
        v_rejected := v_rejected + 1;
      ELSE
        v_missing := v_missing + 1;
      END IF;
    END LOOP;
  END IF;

  IF v_pack IS NULL THEN
    v_status := 'not_configured'; v_score := 0;
  ELSE
    v_score := CASE WHEN v_total = 0 THEN 100 ELSE floor(100 * v_done / v_total)::int END;
    v_status := CASE WHEN v_score >= 100 THEN 'compliant' WHEN v_score >= 80 THEN 'near'
                     WHEN v_score >= 50 THEN 'partial' ELSE 'non_compliant' END;
  END IF;

  UPDATE public.party_compliance SET
    status = v_status, score = v_score, required_count = v_req, complete_count = v_complete,
    missing_count = v_missing, pending_count = v_pending, expiring_count = v_expiring,
    expired_count = v_expired, rejected_count = v_rejected, obligations_open = v_oblig,
    last_evaluated_at = now(), updated_at = now()
  WHERE company_id = p_company_id AND party_kind = p_party_kind AND party_id = p_party_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.can_review_compliance(uuid) TO authenticated;
