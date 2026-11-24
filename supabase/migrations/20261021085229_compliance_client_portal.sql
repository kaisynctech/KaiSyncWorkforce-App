-- CLIENT-COMPLIANCE-SPEC-001 step C3 (database part): client portal compliance. Additive only.
-- Applied 21 Oct 2026 as migration compliance_client_portal (+ REVOKE on the notify function).
-- The client never sees the HR grade. Uploads use the existing client_portal_prepare_upload
-- (client_documents/{company}/{client}/ prefix) and land as "pending" for HR review.

CREATE OR REPLACE FUNCTION public.notify_hr_client_compliance_upload(p_company_id uuid, p_client_id uuid, p_doc_label text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_name text; v_hour text := to_char(now(), 'YYYYMMDDHH24');
BEGIN
  SELECT coalesce(nullif(trim(name), ''), 'Client') INTO v_name FROM public.clients WHERE id = p_client_id;
  FOR r IN
    SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
    FROM public.employees e
    WHERE e.company_id = p_company_id AND e.is_active = true AND e.user_id IS NOT NULL
      AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  LOOP
    INSERT INTO public.app_notifications (company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data)
    VALUES (p_company_id, 'hr', r.auth_user_id, r.employee_id,
      'client_compliance_uploaded', 'Client Compliance Document to Review',
      v_name || ' uploaded "' || coalesce(p_doc_label, 'a document') || '" — review it on the client''s Compliance tab.',
      'client', p_client_id::text,
      'client_compliance_uploaded:' || p_client_id::text || ':' || r.employee_id::text || ':' || v_hour,
      jsonb_build_object('client_id', p_client_id, 'document', p_doc_label))
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_hr_client_compliance_upload(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_get_compliance(p_company_code text, p_client_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_client uuid; v_company uuid; v_pc public.party_compliance%ROWTYPE;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company FROM public._client_portal_client(p_company_code, p_client_code) r;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  v_pc := public.evaluate_party_compliance(v_company, 'client', v_client);
  RETURN json_build_object(
    'summary', json_build_object('status', v_pc.status, 'score', v_pc.score, 'required_count', v_pc.required_count,
      'complete_count', v_pc.complete_count, 'missing_count', v_pc.missing_count, 'pending_count', v_pc.pending_count,
      'expiring_count', v_pc.expiring_count, 'expired_count', v_pc.expired_count, 'rejected_count', v_pc.rejected_count,
      'has_pack', v_pc.pack_id IS NOT NULL),
    'upload_prefix', public._compliance_path_prefix(v_company, 'client', v_client),
    'items', coalesce((SELECT json_agg(json_build_object(
        'document_type_code', i.document_type_code, 'direction', i.direction, 'requirement', i.requirement,
        'validity_days', i.validity_days, 'expiry_required', i.expiry_required, 'notes', i.notes,
        'label', coalesce((SELECT t.label FROM public.compliance_document_types t WHERE t.code = i.document_type_code
                           AND (t.company_id = v_company OR t.company_id IS NULL) ORDER BY t.company_id NULLS LAST LIMIT 1), i.document_type_code))
        ORDER BY i.sort_order)
      FROM public.compliance_pack_items i WHERE i.pack_id = v_pc.pack_id AND NOT i.is_archived), '[]'::json),
    'documents', coalesce((SELECT json_agg(row_to_json(d) ORDER BY d.created_at DESC) FROM (
        SELECT cd.id, cd.document_type_code, cd.direction, cd.document_name, cd.storage_path, cd.issue_date, cd.expiry_date,
               cd.status, cd.is_current, cd.rejected_reason, cd.uploaded_by_kind, cd.created_at, cd.reviewed_at
        FROM public.compliance_documents cd
        WHERE cd.company_id = v_company AND cd.party_kind = 'client' AND cd.party_id = v_client
          AND (cd.direction = 'from_party' OR (cd.direction = 'to_party' AND cd.status = 'approved' AND cd.is_current))
        ORDER BY cd.created_at DESC LIMIT 200) d), '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_submit_compliance_document(
  p_company_code text, p_client_code text, p_type_code text, p_name text, p_storage_path text,
  p_mime text, p_size bigint, p_issue date, p_expiry date, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_client uuid; v_company uuid; v_pack uuid; v_item public.compliance_pack_items%ROWTYPE; v_id uuid; v_label text;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company FROM public._client_portal_client(p_company_code, p_client_code) r;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  SELECT pack_id INTO v_pack FROM public.party_compliance WHERE company_id = v_company AND party_kind = 'client' AND party_id = v_client;
  SELECT * INTO v_item FROM public.compliance_pack_items
  WHERE pack_id = v_pack AND company_id = v_company AND NOT is_archived
    AND document_type_code = p_type_code AND direction = 'from_party' LIMIT 1;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'This document is not on your checklist'; END IF;
  IF v_item.expiry_required AND p_expiry IS NULL THEN RAISE EXCEPTION 'Please enter the expiry date'; END IF;
  IF coalesce(p_size, 0) > 25 * 1024 * 1024 THEN RAISE EXCEPTION 'The file is larger than 25 MB'; END IF;

  v_id := public._compliance_add_document(v_company, 'client', v_client, p_type_code, 'from_party', p_name,
    p_storage_path, p_mime, p_size, p_issue, p_expiry, p_notes, 'client_portal', v_client, 'pending');

  UPDATE public.media_upload_grants SET consumed_at = now()
  WHERE storage_path = trim(both '/' from p_storage_path) AND consumed_at IS NULL;

  SELECT coalesce((SELECT t.label FROM public.compliance_document_types t WHERE t.code = p_type_code
                   AND (t.company_id = v_company OR t.company_id IS NULL) ORDER BY t.company_id NULLS LAST LIMIT 1), p_type_code)
    INTO v_label;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company, NULL, 'ClientPortal', 'client_compliance_uploaded', 'info',
          jsonb_build_object('client_id', v_client::text, 'document_id', v_id, 'type', p_type_code, 'label', v_label), now());
  PERFORM public.notify_hr_client_compliance_upload(v_company, v_client, v_label);
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_get_compliance(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_submit_compliance_document(text, text, text, text, text, text, bigint, date, date, text) TO anon, authenticated;
