-- CLIENT-COMPLIANCE-SPEC-001 step C5 (as re-decided by Nyarie, 21 Oct): contractors stay on their
-- existing compliance system (screens, tables and functions unchanged). A one-way copy keeps the
-- shared engine in step so contractors also get score, A–D grade + history and expiry reminders.
-- Every sync is wrapped so it can never block or fail a contractor/HR action.

CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_documents_legacy
  ON public.compliance_documents (legacy_source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_packs_legacy
  ON public.compliance_packs (legacy_contractor_pack_id) WHERE legacy_contractor_pack_id IS NOT NULL;

-- Copy one contractor pack (and its items) into the shared packs. Returns the shared pack id.
CREATE OR REPLACE FUNCTION public._sync_contractor_pack(p_legacy_pack_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  o public.contractor_compliance_packs%ROWTYPE;
  v_id uuid;
  v_old_sig text; v_new_sig text;
BEGIN
  SELECT * INTO o FROM public.contractor_compliance_packs WHERE id = p_legacy_pack_id;
  IF NOT FOUND THEN
    UPDATE public.compliance_packs SET is_archived = true, is_default = false, updated_at = now()
    WHERE legacy_contractor_pack_id = p_legacy_pack_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.compliance_packs (company_id, party_kind, name, pack_code, description, is_default, is_archived,
    sort_order, legacy_contractor_pack_id)
  VALUES (o.company_id, 'contractor', o.name, o.pack_code, o.description, coalesce(o.is_default, false),
    coalesce(o.is_archived, false), coalesce(o.sort_order, 0), o.id)
  ON CONFLICT (legacy_contractor_pack_id) WHERE legacy_contractor_pack_id IS NOT NULL DO UPDATE SET
    name = EXCLUDED.name, pack_code = EXCLUDED.pack_code, description = EXCLUDED.description,
    is_default = EXCLUDED.is_default, is_archived = EXCLUDED.is_archived, sort_order = EXCLUDED.sort_order, updated_at = now()
  RETURNING id INTO v_id;

  SELECT coalesce(string_agg(document_type_code || ':' || requirement, ',' ORDER BY document_type_code), '') INTO v_old_sig
  FROM public.compliance_pack_items WHERE pack_id = v_id AND NOT is_archived;
  SELECT coalesce(string_agg(document_type || ':' || requirement, ',' ORDER BY document_type), '') INTO v_new_sig
  FROM public.contractor_compliance_pack_items WHERE pack_id = o.id AND requirement IN ('required', 'recommended');

  IF v_old_sig IS DISTINCT FROM v_new_sig THEN
    UPDATE public.compliance_pack_items SET is_archived = true WHERE pack_id = v_id AND NOT is_archived;
    INSERT INTO public.compliance_pack_items (company_id, pack_id, document_type_code, direction, requirement, sort_order)
    SELECT o.company_id, v_id,
           CASE WHEN EXISTS (SELECT 1 FROM public.compliance_document_types t WHERE t.code = i.document_type) THEN i.document_type ELSE 'other' END,
           'from_party', i.requirement, coalesce(i.sort_order, 0)
    FROM public.contractor_compliance_pack_items i
    WHERE i.pack_id = o.id AND i.requirement IN ('required', 'recommended');
  END IF;
  RETURN v_id;
END;
$$;

-- Copy one contractor's pack assignment and documents into the shared engine, then re-score.
CREATE OR REPLACE FUNCTION public._sync_contractor_party(p_contractor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c record;
  v_pack uuid;
BEGIN
  SELECT id, company_id, compliance_pack_id INTO c FROM public.contractors WHERE id = p_contractor_id;
  IF c.id IS NULL THEN RETURN; END IF;
  IF c.compliance_pack_id IS NOT NULL THEN v_pack := public._sync_contractor_pack(c.compliance_pack_id); END IF;

  INSERT INTO public.party_compliance (company_id, party_kind, party_id, pack_id)
  VALUES (c.company_id, 'contractor', c.id, v_pack)
  ON CONFLICT (company_id, party_kind, party_id) DO UPDATE SET pack_id = EXCLUDED.pack_id, updated_at = now();

  INSERT INTO public.compliance_documents (company_id, party_kind, party_id, document_type_code, direction, document_name,
    storage_path, issue_date, expiry_date, status, is_current, reviewed_by, reviewed_at, rejected_reason,
    uploaded_by_kind, notes, legacy_source, legacy_id, created_at, updated_at)
  SELECT d.company_id, 'contractor', d.contractor_id,
         CASE WHEN EXISTS (SELECT 1 FROM public.compliance_document_types t WHERE t.code = d.document_type) THEN d.document_type ELSE 'other' END,
         'from_party', coalesce(nullif(trim(d.document_name), ''), d.document_type),
         coalesce(nullif(trim(d.storage_path), ''),
                  substring(d.file_url from '/object/(?:public|sign|authenticated)/workforce-media/([^?]+)'),
                  'legacy/' || d.id::text),
         d.issue_date, d.expiry_date,
         CASE WHEN d.approval_status IN ('pending', 'approved', 'rejected') THEN d.approval_status ELSE 'pending' END,
         coalesce(d.is_current, true), d.approved_by, d.approved_at, d.rejected_reason,
         CASE WHEN d.uploaded_by_role = 'contractor_portal' THEN 'contractor_portal' ELSE 'hr' END,
         d.notes, 'contractor_documents', d.id, d.created_at, now()
  FROM public.contractor_documents d
  WHERE d.contractor_id = c.id AND d.company_id = c.company_id
  ON CONFLICT (legacy_source, legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
    document_type_code = EXCLUDED.document_type_code, document_name = EXCLUDED.document_name,
    storage_path = EXCLUDED.storage_path, issue_date = EXCLUDED.issue_date, expiry_date = EXCLUDED.expiry_date,
    status = EXCLUDED.status, is_current = EXCLUDED.is_current, reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at, rejected_reason = EXCLUDED.rejected_reason, notes = EXCLUDED.notes,
    updated_at = now();

  -- Documents removed in the contractor system no longer count.
  UPDATE public.compliance_documents cd SET is_current = false, status = 'superseded', updated_at = now()
  WHERE cd.party_kind = 'contractor' AND cd.party_id = c.id AND cd.legacy_source = 'contractor_documents'
    AND cd.status <> 'superseded'
    AND NOT EXISTS (SELECT 1 FROM public.contractor_documents d WHERE d.id = cd.legacy_id);

  PERFORM public.evaluate_party_compliance(c.company_id, 'contractor', c.id);
END;
$$;

-- Trigger functions: never raise (a sync problem must not stop the contractor or HR action).
CREATE OR REPLACE FUNCTION public.trg_mirror_contractor_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    PERFORM public._sync_contractor_party(NEW.contractor_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'compliance mirror (document) skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_mirror_contractor_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    IF NEW.compliance_pack_id IS DISTINCT FROM OLD.compliance_pack_id THEN
      PERFORM public._sync_contractor_party(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'compliance mirror (assignment) skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_mirror_contractor_pack()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pack uuid; c record;
BEGIN
  BEGIN
    v_pack := CASE TG_TABLE_NAME WHEN 'contractor_compliance_packs' THEN NEW.id ELSE NEW.pack_id END;
    PERFORM public._sync_contractor_pack(v_pack);
    FOR c IN SELECT id, company_id FROM public.contractors WHERE compliance_pack_id = v_pack LOOP
      PERFORM public.evaluate_party_compliance(c.company_id, 'contractor', c.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'compliance mirror (pack) skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- Deferred: run once the contractor/HR action has finished (sees the final state).
CREATE CONSTRAINT TRIGGER zz_mirror_contractor_document
  AFTER INSERT OR UPDATE ON public.contractor_documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_contractor_document();
CREATE CONSTRAINT TRIGGER zz_mirror_contractor_assignment
  AFTER UPDATE OF compliance_pack_id ON public.contractors
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_contractor_assignment();
CREATE CONSTRAINT TRIGGER zz_mirror_contractor_pack
  AFTER INSERT OR UPDATE ON public.contractor_compliance_packs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_contractor_pack();
CREATE CONSTRAINT TRIGGER zz_mirror_contractor_pack_item
  AFTER INSERT OR UPDATE ON public.contractor_compliance_pack_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_contractor_pack();

-- Contractor compliance is managed in the existing contractor screens: the shared engine's
-- pack assignment and document upload refuse contractors (grade setting is allowed).
CREATE OR REPLACE FUNCTION public._compliance_contractor_guard(p_kind text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_kind = 'contractor' THEN
    RAISE EXCEPTION 'Contractor packs and documents are managed on the contractor record.';
  END IF;
END;
$$;

-- Initial copy of all existing contractor packs, assignments and documents.
SELECT public._sync_contractor_pack(p.id) FROM public.contractor_compliance_packs p;
SELECT public._sync_contractor_party(c.id) FROM public.contractors c
WHERE c.compliance_pack_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.contractor_documents d WHERE d.contractor_id = c.id);

CREATE OR REPLACE FUNCTION public.hr_assign_compliance_pack(p_company_id uuid, p_kind text, p_party_id uuid, p_pack_id uuid)
RETURNS public.party_compliance LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._compliance_contractor_guard(p_kind);
  PERFORM public._compliance_require(p_company_id, p_kind, 'edit');
  IF NOT public._compliance_party_ok(p_company_id, p_kind, p_party_id) THEN RAISE EXCEPTION 'Not found'; END IF;
  IF p_pack_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compliance_packs WHERE id = p_pack_id AND company_id = p_company_id AND party_kind = p_kind AND NOT is_archived) THEN
    RAISE EXCEPTION 'Pack not found';
  END IF;
  INSERT INTO public.party_compliance (company_id, party_kind, party_id, pack_id)
  VALUES (p_company_id, p_kind, p_party_id, p_pack_id)
  ON CONFLICT (company_id, party_kind, party_id) DO UPDATE SET pack_id = EXCLUDED.pack_id, updated_at = now();
  PERFORM public._compliance_event(p_company_id, p_kind, p_party_id, NULL, 'pack_assigned', 'hr',
    public._my_employee_id(p_company_id), jsonb_build_object('pack_id', p_pack_id));
  RETURN public.evaluate_party_compliance(p_company_id, p_kind, p_party_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_upload_compliance_document(
  p_company_id uuid, p_kind text, p_party_id uuid, p_type_code text, p_direction text, p_name text,
  p_storage_path text, p_mime text, p_size bigint, p_issue date, p_expiry date, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._compliance_contractor_guard(p_kind);
  PERFORM public._compliance_require(p_company_id, p_kind, 'edit');
  IF NOT public._compliance_party_ok(p_company_id, p_kind, p_party_id) THEN RAISE EXCEPTION 'Not found'; END IF;
  RETURN public._compliance_add_document(p_company_id, p_kind, p_party_id, p_type_code, p_direction, p_name,
    p_storage_path, p_mime, p_size, p_issue, p_expiry, p_notes, 'hr', public._my_employee_id(p_company_id),
    CASE WHEN public.can_review_compliance(p_company_id) THEN 'approved' ELSE 'pending' END);
END;
$$;
