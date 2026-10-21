-- ONE compliance system (Nyarie, 21 Oct): the existing contractor compliance system is extended
-- to clients. Same tables (contractor_compliance_packs / _pack_items / contractor_documents),
-- extra columns added (party_kind, direction, client_id, grade). Contractor functions unchanged
-- except pack default/archive now respect the pack's kind. Additive.
-- (Schema columns were added in the same session via execute_sql; see the header block below.)

-- Schema (applied first, in one transaction with lock_timeout 5s):
--   contractor_compliance_packs.party_kind ('contractor'|'client', default contractor), unique (company, kind, name)
--   contractor_compliance_pack_items.direction ('from_party'|'to_party', default from_party), .is_archived
--   contractor_documents.client_id (FK clients), .direction; contractor_id nullable; exactly one party;
--     uploaded_by_role + 'client_portal'; document_type list + client types
--   clients.compliance_pack_id, clients/contractors.compliance_grade(+reason, set_at, set_by)
--   mirror triggers zz_mirror_* disabled (separate engine retired)

ALTER TABLE public.contractor_compliance_pack_items ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._pack_kind_permission(p_pack_id uuid, p_level text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_kind text;
BEGIN
  SELECT company_id, party_kind INTO v_company, v_kind FROM public.contractor_compliance_packs WHERE id = p_pack_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'PACK_NOT_FOUND'; END IF;
  PERFORM public.require_user_permission(v_company, CASE v_kind WHEN 'client' THEN 'clients.' ELSE 'contractors.' END || p_level);
END;
$$;

-- Existing contractor pack functions: same signatures; now scoped to the pack's kind.
CREATE OR REPLACE FUNCTION public.hr_set_default_compliance_pack(p_company_id uuid, p_pack_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET row_security TO 'off' AS $$
DECLARE v_kind text;
BEGIN
  SELECT party_kind INTO v_kind FROM public.contractor_compliance_packs
  WHERE id = p_pack_id AND company_id = p_company_id AND coalesce(is_archived, false) = false;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'PACK_NOT_FOUND'; END IF;
  PERFORM public.require_user_permission(p_company_id, CASE v_kind WHEN 'client' THEN 'clients.edit' ELSE 'contractors.edit' END);
  UPDATE public.contractor_compliance_packs SET is_default = false, updated_at = now()
  WHERE company_id = p_company_id AND party_kind = v_kind AND is_default = true;
  UPDATE public.contractor_compliance_packs SET is_default = true, updated_at = now()
  WHERE id = p_pack_id AND company_id = p_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_archive_compliance_pack(p_company_id uuid, p_pack_id uuid, p_archived boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET row_security TO 'off' AS $$
DECLARE v_kind text;
BEGIN
  SELECT party_kind INTO v_kind FROM public.contractor_compliance_packs WHERE id = p_pack_id AND company_id = p_company_id;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'PACK_NOT_FOUND'; END IF;
  PERFORM public.require_user_permission(p_company_id, CASE v_kind WHEN 'client' THEN 'clients.edit' ELSE 'contractors.edit' END);
  UPDATE public.contractor_compliance_packs
  SET is_archived = p_archived, is_default = CASE WHEN p_archived THEN false ELSE is_default END, updated_at = now()
  WHERE id = p_pack_id AND company_id = p_company_id;
END;
$$;

-- Client packs (same table, party_kind = 'client'; items can be "from client" or "from us").
CREATE OR REPLACE FUNCTION public.hr_upsert_client_compliance_pack(
  p_company_id uuid, p_pack_id uuid, p_name text, p_description text, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET row_security TO 'off' AS $$
DECLARE
  v_id uuid := p_pack_id; v_item jsonb; v_base text; v_try text; v_n int := 0; i int := 0;
  v_types text[] := '{}';
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'clients.edit');
  IF trim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF v_id IS NULL THEN
    v_base := public._slug_pack_code(p_name); v_try := v_base;
    LOOP
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.contractor_compliance_packs WHERE company_id = p_company_id AND pack_code = v_try);
      v_n := v_n + 1; v_try := v_base || '_' || v_n::text;
    END LOOP;
    INSERT INTO public.contractor_compliance_packs (company_id, party_kind, name, pack_code, description, is_default, is_archived)
    VALUES (p_company_id, 'client', trim(p_name), v_try, nullif(trim(coalesce(p_description, '')), ''), false, false)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.contractor_compliance_packs SET name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''), updated_at = now()
    WHERE id = v_id AND company_id = p_company_id AND party_kind = 'client';
    IF NOT FOUND THEN RAISE EXCEPTION 'PACK_NOT_FOUND'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(v_item->>'document_type', '') = '' OR coalesce(v_item->>'requirement', '') NOT IN ('required', 'recommended');
    i := i + 1;
    v_types := v_types || (v_item->>'document_type');
    INSERT INTO public.contractor_compliance_pack_items (pack_id, document_type, requirement, direction, sort_order, is_archived)
    VALUES (v_id, v_item->>'document_type', v_item->>'requirement',
            CASE WHEN v_item->>'direction' = 'to_party' THEN 'to_party' ELSE 'from_party' END, i, false)
    ON CONFLICT (pack_id, document_type) DO UPDATE SET requirement = EXCLUDED.requirement,
      direction = EXCLUDED.direction, sort_order = EXCLUDED.sort_order, is_archived = false;
  END LOOP;
  UPDATE public.contractor_compliance_pack_items SET is_archived = true
  WHERE pack_id = v_id AND NOT (document_type = ANY (v_types));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_assign_client_compliance_pack(p_company_id uuid, p_client_id uuid, p_pack_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'clients.edit');
  IF p_pack_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contractor_compliance_packs
     WHERE id = p_pack_id AND company_id = p_company_id AND party_kind = 'client' AND NOT coalesce(is_archived, false)) THEN
    RAISE EXCEPTION 'PACK_NOT_FOUND';
  END IF;
  UPDATE public.clients SET compliance_pack_id = p_pack_id WHERE id = p_client_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (p_company_id, auth.uid(), 'HrClientDetails', 'client_compliance_pack_assigned', 'info',
          jsonb_build_object('client_id', p_client_id::text, 'pack_id', p_pack_id), now());
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_get_client_compliance(p_company_id uuid, p_client_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pack uuid;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'clients.view');
  SELECT compliance_pack_id INTO v_pack FROM public.clients WHERE id = p_client_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  RETURN json_build_object(
    'pack_id', v_pack,
    'can_edit', public.user_has_permission(p_company_id, 'clients.edit'),
    'can_review', public.can_review_compliance(p_company_id),
    'upload_prefix', 'client_documents/' || p_company_id::text || '/' || p_client_id::text || '/compliance/',
    'packs', coalesce((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'is_default', p.is_default) ORDER BY p.sort_order, p.name)
      FROM public.contractor_compliance_packs p WHERE p.company_id = p_company_id AND p.party_kind = 'client' AND NOT coalesce(p.is_archived, false)), '[]'::json),
    'items', coalesce((SELECT json_agg(json_build_object('document_type', i.document_type, 'requirement', i.requirement,
        'sort_order', i.sort_order, 'direction', i.direction) ORDER BY i.sort_order)
      FROM public.contractor_compliance_pack_items i WHERE i.pack_id = v_pack AND NOT i.is_archived), '[]'::json),
    'documents', coalesce((SELECT json_agg(row_to_json(d) ORDER BY d.created_at DESC) FROM (
      SELECT id, document_type, document_name, file_url, storage_path, approval_status, rejected_reason, is_required,
             is_current, uploaded_by_role, issue_date, expiry_date, direction, created_at, updated_at
      FROM public.contractor_documents
      WHERE company_id = p_company_id AND client_id = p_client_id AND is_current) d), '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_upload_client_document(
  p_company_id uuid, p_client_id uuid, p_document_type text, p_direction text, p_document_name text,
  p_storage_path text, p_expiry_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_path text := trim(both '/' from coalesce(p_storage_path, ''));
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'clients.edit');
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id AND company_id = p_company_id) THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF left(v_path, length('client_documents/' || p_company_id::text || '/' || p_client_id::text || '/')) <>
     'client_documents/' || p_company_id::text || '/' || p_client_id::text || '/' OR v_path LIKE '%..%' THEN
    RAISE EXCEPTION 'FILE_PATH_NOT_ALLOWED';
  END IF;
  UPDATE public.contractor_documents SET is_current = false, updated_at = now()
  WHERE company_id = p_company_id AND client_id = p_client_id AND document_type = p_document_type
    AND direction = coalesce(p_direction, 'from_party') AND is_current AND p_document_type <> 'other';
  INSERT INTO public.contractor_documents (company_id, client_id, document_type, document_name, file_url, storage_path,
    expiry_date, approval_status, approved_at, approved_by, is_required, is_current, uploaded_by_role, direction)
  VALUES (p_company_id, p_client_id, p_document_type, coalesce(nullif(trim(p_document_name), ''), p_document_type), v_path, v_path,
    p_expiry_date, 'approved', now(), public._my_employee_id(p_company_id), false, true, 'hr',
    CASE WHEN p_direction = 'to_party' THEN 'to_party' ELSE 'from_party' END)
  RETURNING id INTO v_id;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (p_company_id, auth.uid(), 'HrClientDetails', 'client_compliance_document_uploaded', 'info',
          jsonb_build_object('client_id', p_client_id::text, 'document_id', v_id, 'document_type', p_document_type, 'direction', p_direction), now());
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_review_client_document(p_document_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.contractor_documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.contractor_documents WHERE id = p_document_id AND client_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_NOT_FOUND'; END IF;
  IF p_action IN ('approve', 'reject') THEN
    IF NOT public.can_review_compliance(d.company_id) THEN RAISE EXCEPTION 'INSUFFICIENT_PERMISSION: compliance.review required'; END IF;
  ELSE
    PERFORM public.require_user_permission(d.company_id, 'clients.edit');
  END IF;
  IF p_action = 'approve' THEN
    UPDATE public.contractor_documents SET approval_status = 'approved', approved_at = now(),
      approved_by = public._my_employee_id(d.company_id), rejected_reason = NULL, updated_at = now() WHERE id = d.id;
  ELSIF p_action = 'reject' THEN
    IF trim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    UPDATE public.contractor_documents SET approval_status = 'rejected', rejected_reason = trim(p_reason), updated_at = now() WHERE id = d.id;
  ELSIF p_action = 'remove' THEN
    UPDATE public.contractor_documents SET is_current = false, updated_at = now() WHERE id = d.id;
  ELSE
    RAISE EXCEPTION 'UNKNOWN_ACTION';
  END IF;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (d.company_id, auth.uid(), 'HrClientDetails', 'client_compliance_document_' || p_action, 'info',
          jsonb_build_object('client_id', d.client_id::text, 'document_id', d.id, 'document_type', d.document_type, 'reason', p_reason), now());
END;
$$;

-- Internal A–D grade for clients and contractors (+ history in party_grade_history).
CREATE OR REPLACE FUNCTION public.hr_set_compliance_grade(p_company_id uuid, p_kind text, p_party_id uuid, p_grade text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me uuid;
BEGIN
  IF p_kind NOT IN ('client', 'contractor') THEN RAISE EXCEPTION 'Unknown party kind'; END IF;
  PERFORM public.require_user_permission(p_company_id, CASE p_kind WHEN 'client' THEN 'clients.edit' ELSE 'contractors.edit' END);
  IF p_grade IS NOT NULL AND p_grade NOT IN ('A', 'B', 'C', 'D') THEN RAISE EXCEPTION 'Grade must be A, B, C or D'; END IF;
  IF trim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  v_me := public._my_employee_id(p_company_id);
  IF p_kind = 'client' THEN
    UPDATE public.clients SET compliance_grade = p_grade, compliance_grade_reason = trim(p_reason),
      compliance_grade_set_at = now(), compliance_grade_set_by = v_me WHERE id = p_party_id AND company_id = p_company_id;
  ELSE
    UPDATE public.contractors SET compliance_grade = p_grade, compliance_grade_reason = trim(p_reason),
      compliance_grade_set_at = now(), compliance_grade_set_by = v_me WHERE id = p_party_id AND company_id = p_company_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  INSERT INTO public.party_grade_history (company_id, party_kind, party_id, grade, reason, set_by)
  VALUES (p_company_id, p_kind, p_party_id, p_grade, trim(p_reason), v_me);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_get_compliance_grade(p_company_id uuid, p_kind text, p_party_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  IF p_kind NOT IN ('client', 'contractor') THEN RAISE EXCEPTION 'Unknown party kind'; END IF;
  PERFORM public.require_user_permission(p_company_id, CASE p_kind WHEN 'client' THEN 'clients.view' ELSE 'contractors.view' END);
  IF p_kind = 'client' THEN
    SELECT compliance_grade g, compliance_grade_reason rsn, compliance_grade_set_at at INTO r FROM public.clients WHERE id = p_party_id AND company_id = p_company_id;
  ELSE
    SELECT compliance_grade g, compliance_grade_reason rsn, compliance_grade_set_at at INTO r FROM public.contractors WHERE id = p_party_id AND company_id = p_company_id;
  END IF;
  RETURN json_build_object(
    'grade', r.g, 'reason', r.rsn, 'set_at', r.at,
    'can_edit', public.user_has_permission(p_company_id, CASE p_kind WHEN 'client' THEN 'clients.edit' ELSE 'contractors.edit' END),
    'history', coalesce((SELECT json_agg(json_build_object('grade', h.grade, 'reason', h.reason, 'set_at', h.set_at,
        'set_by_name', (SELECT trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')) FROM public.employees e WHERE e.id = h.set_by))
        ORDER BY h.set_at DESC)
      FROM public.party_grade_history h WHERE h.company_id = p_company_id AND h.party_kind = p_kind AND h.party_id = p_party_id), '[]'::json));
END;
$$;

-- Client portal: same shape as the contractor portal functions.
CREATE OR REPLACE FUNCTION public.client_portal_get_compliance_pack(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(json_agg(json_build_object('document_type', i.document_type, 'requirement', i.requirement,
           'sort_order', i.sort_order, 'direction', i.direction)
         ORDER BY CASE WHEN i.requirement = 'required' THEN 0 ELSE 1 END, i.sort_order), '[]'::json)
  FROM public._client_portal_client(p_company_code, p_client_code) x
  JOIN public.clients c ON c.id = x.client_id
  JOIN public.contractor_compliance_packs p ON p.id = c.compliance_pack_id AND NOT coalesce(p.is_archived, false)
  JOIN public.contractor_compliance_pack_items i ON i.pack_id = p.id AND NOT i.is_archived;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_get_compliance_documents(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(json_agg(row_to_json(d) ORDER BY d.created_at DESC), '[]'::json) FROM (
    SELECT cd.id, cd.company_id, cd.client_id, cd.document_type, cd.document_name, cd.file_url, cd.storage_path,
           cd.approval_status, cd.rejected_reason, cd.is_required, cd.is_current, cd.uploaded_by_role,
           cd.expiry_date, cd.direction, cd.created_at, cd.updated_at
    FROM public._client_portal_client(p_company_code, p_client_code) x
    JOIN public.contractor_documents cd ON cd.client_id = x.client_id AND cd.company_id = x.company_id
    WHERE cd.is_current AND (cd.direction = 'from_party' OR cd.approval_status = 'approved')) d;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_insert_document(
  p_company_code text, p_client_code text, p_document_type text, p_document_name text,
  p_storage_path text, p_expiry_date date DEFAULT NULL, p_old_document_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_client uuid; v_company uuid; v_id uuid; v_path text := trim(both '/' from coalesce(p_storage_path, ''));
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company FROM public._client_portal_client(p_company_code, p_client_code) r;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF left(v_path, length('client_documents/' || v_company::text || '/' || v_client::text || '/')) <>
     'client_documents/' || v_company::text || '/' || v_client::text || '/' OR v_path LIKE '%..%' THEN
    RAISE EXCEPTION 'FILE_PATH_NOT_ALLOWED';
  END IF;
  IF p_old_document_id IS NOT NULL THEN
    UPDATE public.contractor_documents SET is_current = false, updated_at = now()
    WHERE id = p_old_document_id AND client_id = v_client AND company_id = v_company AND direction = 'from_party';
  END IF;
  INSERT INTO public.contractor_documents (company_id, client_id, document_type, document_name, file_url, storage_path,
    expiry_date, approval_status, is_required, is_current, uploaded_by_role, direction)
  VALUES (v_company, v_client, p_document_type, coalesce(nullif(trim(p_document_name), ''), p_document_type), v_path, v_path,
    p_expiry_date, 'pending', false, true, 'client_portal', 'from_party')
  RETURNING id INTO v_id;
  UPDATE public.media_upload_grants SET consumed_at = now() WHERE storage_path = v_path AND consumed_at IS NULL;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company, NULL, 'ClientPortal', 'client_compliance_uploaded', 'info',
          jsonb_build_object('client_id', v_client::text, 'document_id', v_id, 'document_type', p_document_type,
                             'replaced', p_old_document_id IS NOT NULL), now());
  PERFORM public.notify_hr_client_compliance_upload(v_company, v_client, coalesce(nullif(trim(p_document_name), ''), p_document_type));
  RETURN v_id;
END;
$$;

-- One overview for both (same rules as the contractor screens: required from-party pack types
-- with an approved, non-expired current document).
CREATE OR REPLACE FUNCTION public.hr_compliance_overview(p_company_id uuid, p_kind text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_kind NOT IN ('client', 'contractor') THEN RAISE EXCEPTION 'Unknown party kind'; END IF;
  PERFORM public.require_user_permission(p_company_id, CASE p_kind WHEN 'client' THEN 'clients.view' ELSE 'contractors.view' END);
  RETURN (SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.name), '[]'::json) FROM (
    WITH parties AS (
      SELECT c.id, c.name, c.client_code AS code, c.compliance_pack_id AS pack_id, c.compliance_grade AS grade
      FROM public.clients c WHERE p_kind = 'client' AND c.company_id = p_company_id
      UNION ALL
      SELECT c.id, c.name, c.contractor_code, c.compliance_pack_id, c.compliance_grade
      FROM public.contractors c WHERE p_kind = 'contractor' AND c.company_id = p_company_id AND c.is_active
    ),
    req AS (
      SELECT pa.id AS party_id, i.document_type, i.direction, i.requirement
      FROM parties pa JOIN public.contractor_compliance_pack_items i ON i.pack_id = pa.pack_id AND NOT i.is_archived
    ),
    docs AS (
      SELECT DISTINCT ON (coalesce(d.client_id, d.contractor_id), d.document_type, d.direction)
             coalesce(d.client_id, d.contractor_id) AS party_id, d.document_type, d.direction, d.approval_status, d.expiry_date
      FROM public.contractor_documents d
      WHERE d.company_id = p_company_id AND d.is_current
        AND ((p_kind = 'client' AND d.client_id IS NOT NULL) OR (p_kind = 'contractor' AND d.contractor_id IS NOT NULL))
      ORDER BY coalesce(d.client_id, d.contractor_id), d.document_type, d.direction, d.created_at DESC
    ),
    st AS (
      SELECT r.party_id, r.direction, r.requirement,
        CASE WHEN dc.party_id IS NULL THEN 'missing'
             WHEN dc.approval_status = 'approved' AND dc.expiry_date IS NOT NULL AND dc.expiry_date < current_date THEN 'expired'
             WHEN dc.approval_status = 'approved' AND dc.expiry_date IS NOT NULL AND dc.expiry_date <= current_date + 30 THEN 'expiring'
             WHEN dc.approval_status = 'approved' THEN 'complete'
             ELSE dc.approval_status END AS s
      FROM req r LEFT JOIN docs dc ON dc.party_id = r.party_id AND dc.document_type = r.document_type AND dc.direction = r.direction
    )
    SELECT pa.id AS party_id, pa.name, pa.code, pa.pack_id,
      (SELECT p.name FROM public.contractor_compliance_packs p WHERE p.id = pa.pack_id) AS pack_name,
      pa.grade AS hr_grade,
      count(*) FILTER (WHERE st.direction = 'from_party' AND st.requirement = 'required') AS required_count,
      count(*) FILTER (WHERE st.direction = 'from_party' AND st.requirement = 'required' AND st.s IN ('complete', 'expiring')) AS complete_count,
      count(*) FILTER (WHERE st.direction = 'from_party' AND st.s = 'pending') AS pending_count,
      count(*) FILTER (WHERE st.direction = 'from_party' AND st.requirement = 'required' AND st.s = 'missing') AS missing_count,
      count(*) FILTER (WHERE st.direction = 'from_party' AND st.s = 'expiring') AS expiring_count,
      count(*) FILTER (WHERE st.direction = 'from_party' AND st.s = 'expired') AS expired_count,
      count(*) FILTER (WHERE st.direction = 'from_party' AND st.s = 'rejected') AS rejected_count,
      count(*) FILTER (WHERE st.direction = 'to_party' AND st.s NOT IN ('complete', 'expiring')) AS obligations_open
    FROM parties pa LEFT JOIN st ON st.party_id = pa.id
    GROUP BY pa.id, pa.name, pa.code, pa.pack_id, pa.grade
  ) x);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_upsert_client_compliance_pack(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_assign_client_compliance_pack(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_client_compliance(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_upload_client_document(uuid, uuid, text, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_review_client_document(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_set_compliance_grade(uuid, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_compliance_grade(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_compliance_overview(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_compliance_pack(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_compliance_documents(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_insert_document(text, text, text, text, text, date, uuid) TO anon, authenticated;
