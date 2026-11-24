-- CLIENT-COMPLIANCE-SPEC-001 step C2 (database part): HR functions. Additive only.
-- Files live under the existing folders (no storage policy change):
--   client_documents/{company}/{client}/compliance/{uuid}.{ext}
--   contractor_documents/{company}/{contractor}/compliance/{uuid}.{ext}

CREATE OR REPLACE FUNCTION public._compliance_party_ok(p_company_id uuid, p_kind text, p_party_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE p_kind
    WHEN 'client' THEN EXISTS (SELECT 1 FROM public.clients WHERE id = p_party_id AND company_id = p_company_id)
    WHEN 'contractor' THEN EXISTS (SELECT 1 FROM public.contractors WHERE id = p_party_id AND company_id = p_company_id)
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public._compliance_require(p_company_id uuid, p_kind text, p_level text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_kind NOT IN ('client', 'contractor') THEN RAISE EXCEPTION 'Unknown party kind'; END IF;
  PERFORM public.require_user_permission(p_company_id,
    CASE p_kind WHEN 'client' THEN 'clients.' ELSE 'contractors.' END || p_level);
END;
$$;

CREATE OR REPLACE FUNCTION public._compliance_path_prefix(p_company_id uuid, p_kind text, p_party_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind WHEN 'client' THEN 'client_documents/' ELSE 'contractor_documents/' END
         || p_company_id::text || '/' || p_party_id::text || '/compliance/';
$$;

CREATE OR REPLACE FUNCTION public._compliance_event(p_company_id uuid, p_kind text, p_party_id uuid, p_document_id uuid,
  p_event text, p_actor_kind text, p_actor_id uuid, p_details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.compliance_events (company_id, party_kind, party_id, document_id, event, actor_kind, actor_id, details)
  VALUES (p_company_id, p_kind, p_party_id, p_document_id, p_event, p_actor_kind, p_actor_id, coalesce(p_details, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public._my_employee_id(p_company_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM public.employees WHERE user_id = auth.uid() AND company_id = p_company_id AND is_active LIMIT 1;
$$;

-- Packs --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_upsert_compliance_pack(
  p_company_id uuid, p_pack_id uuid, p_party_kind text, p_name text, p_description text,
  p_is_default boolean, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := p_pack_id;
  it jsonb; i int := 0;
  v_dir text; v_req text;
BEGIN
  PERFORM public._compliance_require(p_company_id, p_party_kind, 'edit');
  IF trim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Pack name is required'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Items must be a list'; END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'Too many items'; END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.compliance_packs (company_id, party_kind, name, description, is_default)
    VALUES (p_company_id, p_party_kind, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_is_default, false))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.compliance_packs SET name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
      is_default = coalesce(p_is_default, false), updated_at = now()
    WHERE id = v_id AND company_id = p_company_id AND party_kind = p_party_kind;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pack not found'; END IF;
    UPDATE public.compliance_pack_items SET is_archived = true WHERE pack_id = v_id AND NOT is_archived;
  END IF;

  IF coalesce(p_is_default, false) THEN
    UPDATE public.compliance_packs SET is_default = false, updated_at = now()
    WHERE company_id = p_company_id AND party_kind = p_party_kind AND id <> v_id AND is_default;
  END IF;

  FOR it IN SELECT e FROM jsonb_array_elements(p_items) AS a(e) LOOP
    CONTINUE WHEN trim(coalesce(it->>'document_type_code', '')) = '';
    v_dir := coalesce(nullif(it->>'direction', ''), 'from_party');
    v_req := coalesce(nullif(it->>'requirement', ''), 'required');
    i := i + 1;
    INSERT INTO public.compliance_pack_items (company_id, pack_id, document_type_code, direction, requirement,
      validity_days, expiry_required, weight, notes, sort_order)
    VALUES (p_company_id, v_id, trim(it->>'document_type_code'), v_dir, v_req,
      nullif(it->>'validity_days', '')::int, coalesce((it->>'expiry_required')::boolean, false),
      greatest(coalesce(nullif(it->>'weight', '')::numeric, 1), 0.1), nullif(trim(coalesce(it->>'notes', '')), ''), i);
  END LOOP;

  -- Re-score everyone on this pack
  PERFORM public.evaluate_party_compliance(pc.company_id, pc.party_kind, pc.party_id)
  FROM public.party_compliance pc WHERE pc.pack_id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_archive_compliance_pack(p_pack_id uuid, p_archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.compliance_packs%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.compliance_packs WHERE id = p_pack_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pack not found'; END IF;
  PERFORM public._compliance_require(v.company_id, v.party_kind, 'edit');
  UPDATE public.compliance_packs SET is_archived = coalesce(p_archived, true),
    is_default = CASE WHEN coalesce(p_archived, true) THEN false ELSE is_default END, updated_at = now()
  WHERE id = p_pack_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_assign_compliance_pack(p_company_id uuid, p_kind text, p_party_id uuid, p_pack_id uuid)
RETURNS public.party_compliance LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
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

-- Documents ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._compliance_add_document(
  p_company_id uuid, p_kind text, p_party_id uuid, p_type_code text, p_direction text, p_name text,
  p_storage_path text, p_mime text, p_size bigint, p_issue date, p_expiry date, p_notes text,
  p_uploaded_by_kind text, p_uploaded_by_id uuid, p_status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_prev uuid; v_id uuid;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_prefix text := public._compliance_path_prefix(p_company_id, p_kind, p_party_id);
BEGIN
  IF v_path = '' OR v_path LIKE '%..%' OR left(v_path, length(v_prefix)) <> v_prefix THEN RAISE EXCEPTION 'FILE_PATH_NOT_ALLOWED'; END IF;
  IF p_direction NOT IN ('from_party', 'to_party') THEN RAISE EXCEPTION 'Unknown direction'; END IF;
  IF trim(coalesce(p_type_code, '')) = '' THEN RAISE EXCEPTION 'Document type is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.compliance_document_types t WHERE t.code = p_type_code
                 AND (t.company_id IS NULL OR t.company_id = p_company_id)) THEN
    RAISE EXCEPTION 'Unknown document type';
  END IF;
  IF p_expiry IS NOT NULL AND p_issue IS NOT NULL AND p_expiry < p_issue THEN RAISE EXCEPTION 'Expiry is before issue date'; END IF;

  SELECT id INTO v_prev FROM public.compliance_documents
  WHERE company_id = p_company_id AND party_kind = p_kind AND party_id = p_party_id
    AND document_type_code = p_type_code AND direction = p_direction AND is_current
  ORDER BY created_at DESC LIMIT 1;

  UPDATE public.compliance_documents SET is_current = false,
    status = CASE WHEN status IN ('pending') THEN 'superseded' ELSE status END, updated_at = now()
  WHERE company_id = p_company_id AND party_kind = p_kind AND party_id = p_party_id
    AND document_type_code = p_type_code AND direction = p_direction AND is_current;

  INSERT INTO public.compliance_documents (company_id, party_kind, party_id, document_type_code, direction, document_name,
    storage_path, mime_type, file_size_bytes, issue_date, expiry_date, status, uploaded_by_kind, uploaded_by_id, replaces_id, notes,
    reviewed_by, reviewed_at)
  VALUES (p_company_id, p_kind, p_party_id, p_type_code, p_direction, left(trim(coalesce(nullif(p_name, ''), p_type_code)), 300),
    v_path, p_mime, p_size, p_issue, p_expiry, p_status, p_uploaded_by_kind, p_uploaded_by_id, v_prev,
    nullif(trim(coalesce(p_notes, '')), ''),
    CASE WHEN p_status = 'approved' THEN p_uploaded_by_id END, CASE WHEN p_status = 'approved' THEN now() END)
  RETURNING id INTO v_id;

  PERFORM public._compliance_event(p_company_id, p_kind, p_party_id, v_id, 'uploaded', p_uploaded_by_kind, p_uploaded_by_id,
    jsonb_build_object('type', p_type_code, 'direction', p_direction, 'status', p_status, 'replaces', v_prev));
  PERFORM public.evaluate_party_compliance(p_company_id, p_kind, p_party_id);
  RETURN v_id;
END;
$$;

-- HR uploads (e.g. "documents from us", or on the party's behalf). Reviewers' uploads are
-- approved straight away; others go to pending.
CREATE OR REPLACE FUNCTION public.hr_upload_compliance_document(
  p_company_id uuid, p_kind text, p_party_id uuid, p_type_code text, p_direction text, p_name text,
  p_storage_path text, p_mime text, p_size bigint, p_issue date, p_expiry date, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._compliance_require(p_company_id, p_kind, 'edit');
  IF NOT public._compliance_party_ok(p_company_id, p_kind, p_party_id) THEN RAISE EXCEPTION 'Not found'; END IF;
  RETURN public._compliance_add_document(p_company_id, p_kind, p_party_id, p_type_code, p_direction, p_name,
    p_storage_path, p_mime, p_size, p_issue, p_expiry, p_notes, 'hr', public._my_employee_id(p_company_id),
    CASE WHEN public.can_review_compliance(p_company_id) THEN 'approved' ELSE 'pending' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_review_compliance_document(p_document_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS public.party_compliance LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.compliance_documents%ROWTYPE; v_me uuid;
BEGIN
  SELECT * INTO d FROM public.compliance_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF NOT public.can_review_compliance(d.company_id) THEN RAISE EXCEPTION 'INSUFFICIENT_PERMISSION: compliance.review required'; END IF;
  IF d.status <> 'pending' OR NOT d.is_current THEN RAISE EXCEPTION 'Only the current pending document can be reviewed'; END IF;
  IF NOT p_approve AND trim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason for rejecting'; END IF;
  v_me := public._my_employee_id(d.company_id);
  UPDATE public.compliance_documents SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by = v_me, reviewed_at = now(),
    rejected_reason = CASE WHEN p_approve THEN NULL ELSE trim(p_reason) END, updated_at = now()
  WHERE id = p_document_id;
  PERFORM public._compliance_event(d.company_id, d.party_kind, d.party_id, d.id,
    CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, 'hr', v_me, jsonb_build_object('reason', p_reason));
  RETURN public.evaluate_party_compliance(d.company_id, d.party_kind, d.party_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_set_party_grade(p_company_id uuid, p_kind text, p_party_id uuid, p_grade text, p_reason text)
RETURNS public.party_compliance LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me uuid; v_row public.party_compliance%ROWTYPE;
BEGIN
  PERFORM public._compliance_require(p_company_id, p_kind, 'edit');
  IF NOT public._compliance_party_ok(p_company_id, p_kind, p_party_id) THEN RAISE EXCEPTION 'Not found'; END IF;
  IF p_grade IS NOT NULL AND p_grade NOT IN ('A', 'B', 'C', 'D') THEN RAISE EXCEPTION 'Grade must be A, B, C or D'; END IF;
  IF trim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  v_me := public._my_employee_id(p_company_id);
  INSERT INTO public.party_compliance (company_id, party_kind, party_id) VALUES (p_company_id, p_kind, p_party_id)
  ON CONFLICT (company_id, party_kind, party_id) DO NOTHING;
  UPDATE public.party_compliance SET hr_grade = p_grade, hr_grade_reason = trim(p_reason),
    hr_grade_set_by = v_me, hr_grade_set_at = now(), updated_at = now()
  WHERE company_id = p_company_id AND party_kind = p_kind AND party_id = p_party_id
  RETURNING * INTO v_row;
  INSERT INTO public.party_grade_history (company_id, party_kind, party_id, grade, reason, set_by)
  VALUES (p_company_id, p_kind, p_party_id, p_grade, trim(p_reason), v_me);
  PERFORM public._compliance_event(p_company_id, p_kind, p_party_id, NULL, 'grade_changed', 'hr', v_me,
    jsonb_build_object('grade', p_grade, 'reason', p_reason));
  RETURN v_row;
END;
$$;

-- Reads --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_get_party_compliance(p_company_id uuid, p_kind text, p_party_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pc public.party_compliance%ROWTYPE;
BEGIN
  PERFORM public._compliance_require(p_company_id, p_kind, 'view');
  IF NOT public._compliance_party_ok(p_company_id, p_kind, p_party_id) THEN RAISE EXCEPTION 'Not found'; END IF;
  v_pc := public.evaluate_party_compliance(p_company_id, p_kind, p_party_id);
  RETURN json_build_object(
    'summary', row_to_json(v_pc),
    'can_review', public.can_review_compliance(p_company_id),
    'can_edit', public.user_has_permission(p_company_id, CASE p_kind WHEN 'client' THEN 'clients.edit' ELSE 'contractors.edit' END),
    'upload_prefix', public._compliance_path_prefix(p_company_id, p_kind, p_party_id),
    'pack', (SELECT json_build_object('id', p.id, 'name', p.name) FROM public.compliance_packs p WHERE p.id = v_pc.pack_id),
    'items', coalesce((SELECT json_agg(json_build_object(
        'id', i.id, 'document_type_code', i.document_type_code, 'direction', i.direction, 'requirement', i.requirement,
        'validity_days', i.validity_days, 'expiry_required', i.expiry_required, 'weight', i.weight, 'notes', i.notes,
        'label', coalesce((SELECT t.label FROM public.compliance_document_types t WHERE t.code = i.document_type_code
                           AND (t.company_id = p_company_id OR t.company_id IS NULL) ORDER BY t.company_id NULLS LAST LIMIT 1), i.document_type_code))
        ORDER BY i.direction, i.sort_order)
      FROM public.compliance_pack_items i WHERE i.pack_id = v_pc.pack_id AND NOT i.is_archived), '[]'::json),
    'documents', coalesce((SELECT json_agg(row_to_json(d) ORDER BY d.created_at DESC)
      FROM (SELECT id, document_type_code, direction, document_name, storage_path, mime_type, file_size_bytes, issue_date,
                   expiry_date, status, is_current, reviewed_at, rejected_reason, uploaded_by_kind, created_at,
                   (SELECT trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')) FROM public.employees e WHERE e.id = cd.reviewed_by) AS reviewed_by_name
            FROM public.compliance_documents cd
            WHERE cd.company_id = p_company_id AND cd.party_kind = p_kind AND cd.party_id = p_party_id
            ORDER BY cd.created_at DESC LIMIT 200) d), '[]'::json),
    'grade_history', coalesce((SELECT json_agg(json_build_object('grade', h.grade, 'reason', h.reason, 'set_at', h.set_at,
        'set_by_name', (SELECT trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')) FROM public.employees e WHERE e.id = h.set_by))
        ORDER BY h.set_at DESC)
      FROM public.party_grade_history h WHERE h.company_id = p_company_id AND h.party_kind = p_kind AND h.party_id = p_party_id), '[]'::json),
    'packs', coalesce((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'is_default', p.is_default) ORDER BY p.sort_order, p.name)
      FROM public.compliance_packs p WHERE p.company_id = p_company_id AND p.party_kind = p_kind AND NOT p.is_archived), '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_get_compliance_overview(p_company_id uuid, p_kind text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._compliance_require(p_company_id, p_kind, 'view');
  IF p_kind = 'client' THEN
    RETURN (SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.name), '[]'::json) FROM (
      SELECT c.id AS party_id, c.name, c.client_code AS code, pc.pack_id,
             (SELECT p.name FROM public.compliance_packs p WHERE p.id = pc.pack_id) AS pack_name,
             coalesce(pc.status, 'not_configured') AS status, coalesce(pc.score, 0) AS score, pc.hr_grade,
             coalesce(pc.pending_count, 0) AS pending_count, coalesce(pc.expiring_count, 0) AS expiring_count,
             coalesce(pc.expired_count, 0) AS expired_count, coalesce(pc.missing_count, 0) AS missing_count,
             coalesce(pc.obligations_open, 0) AS obligations_open, pc.last_evaluated_at
      FROM public.clients c
      LEFT JOIN public.party_compliance pc ON pc.company_id = c.company_id AND pc.party_kind = 'client' AND pc.party_id = c.id
      WHERE c.company_id = p_company_id) x);
  ELSE
    RETURN (SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.name), '[]'::json) FROM (
      SELECT c.id AS party_id, c.name, c.contractor_code AS code, pc.pack_id,
             (SELECT p.name FROM public.compliance_packs p WHERE p.id = pc.pack_id) AS pack_name,
             coalesce(pc.status, 'not_configured') AS status, coalesce(pc.score, 0) AS score, pc.hr_grade,
             coalesce(pc.pending_count, 0) AS pending_count, coalesce(pc.expiring_count, 0) AS expiring_count,
             coalesce(pc.expired_count, 0) AS expired_count, coalesce(pc.missing_count, 0) AS missing_count,
             coalesce(pc.obligations_open, 0) AS obligations_open, pc.last_evaluated_at
      FROM public.contractors c
      LEFT JOIN public.party_compliance pc ON pc.company_id = c.company_id AND pc.party_kind = 'contractor' AND pc.party_id = c.id
      WHERE c.company_id = p_company_id AND c.is_active) x);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_list_compliance_packs(p_company_id uuid, p_kind text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._compliance_require(p_company_id, p_kind, 'view');
  RETURN json_build_object(
    'packs', coalesce((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'description', p.description,
        'is_default', p.is_default, 'is_archived', p.is_archived,
        'assigned_count', (SELECT count(*) FROM public.party_compliance pc WHERE pc.pack_id = p.id),
        'items', coalesce((SELECT json_agg(json_build_object('document_type_code', i.document_type_code, 'direction', i.direction,
            'requirement', i.requirement, 'validity_days', i.validity_days, 'expiry_required', i.expiry_required,
            'weight', i.weight, 'notes', i.notes) ORDER BY i.sort_order)
          FROM public.compliance_pack_items i WHERE i.pack_id = p.id AND NOT i.is_archived), '[]'::json))
        ORDER BY p.is_archived, p.sort_order, p.name)
      FROM public.compliance_packs p WHERE p.company_id = p_company_id AND p.party_kind = p_kind), '[]'::json),
    'types', coalesce((SELECT json_agg(json_build_object('code', t.code, 'label', t.label, 'default_direction', t.default_direction,
        'default_validity_days', t.default_validity_days, 'party_kind', t.party_kind) ORDER BY t.sort_order, t.label)
      FROM public.compliance_document_types t
      WHERE (t.company_id IS NULL OR t.company_id = p_company_id) AND t.is_active AND t.party_kind IN ('any', p_kind)), '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_upsert_compliance_pack(uuid, uuid, text, text, text, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_archive_compliance_pack(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_assign_compliance_pack(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_upload_compliance_document(uuid, text, uuid, text, text, text, text, text, bigint, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_review_compliance_document(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_set_party_grade(uuid, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_party_compliance(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_compliance_overview(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_list_compliance_packs(uuid, text) TO authenticated;
