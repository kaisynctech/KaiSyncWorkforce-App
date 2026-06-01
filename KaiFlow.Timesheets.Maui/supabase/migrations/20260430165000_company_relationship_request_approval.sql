-- Add explicit request/approval flow for cross-company contractor linking.

CREATE OR REPLACE FUNCTION public.company_request_contractor_company_link(
  p_requester_company_id bigint,
  p_contractor_id bigint,
  p_recipient_company_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_company_id bigint;
BEGIN
  SELECT c.id INTO v_recipient_company_id
  FROM public.companies c
  WHERE lower(c.company_code) = lower(trim(coalesce(p_recipient_company_code, '')))
  LIMIT 1;

  IF v_recipient_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_company_not_found');
  END IF;
  IF v_recipient_company_id = p_requester_company_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'same_company_not_allowed');
  END IF;

  INSERT INTO public.company_relationships (
    requester_company_id,
    recipient_company_id,
    relationship_type,
    status,
    source_contractor_id,
    updated_at
  )
  VALUES (
    p_requester_company_id,
    v_recipient_company_id,
    'client_contractor',
    'pending',
    p_contractor_id,
    now()
  )
  ON CONFLICT (requester_company_id, recipient_company_id, relationship_type)
  DO UPDATE SET
    status = 'pending',
    source_contractor_id = excluded.source_contractor_id,
    updated_at = now();

  UPDATE public.contractors
  SET linked_company_id = v_recipient_company_id,
      linked_company_status = 'pending',
      updated_at = now()
  WHERE id = p_contractor_id
    AND company_id = p_requester_company_id;

  RETURN jsonb_build_object('ok', true, 'status', 'pending');
END;
$$;
CREATE OR REPLACE FUNCTION public.company_decide_relationship_request(
  p_recipient_company_id bigint,
  p_relationship_id bigint,
  p_approve boolean,
  p_auto_create_client boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rel public.company_relationships%ROWTYPE;
  v_requester_company_name text;
  v_requester_company_code text;
BEGIN
  SELECT * INTO v_rel
  FROM public.company_relationships r
  WHERE r.id = p_relationship_id
    AND r.recipient_company_id = p_recipient_company_id
    AND r.relationship_type = 'client_contractor'
  LIMIT 1;

  IF v_rel.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'relationship_not_found');
  END IF;

  UPDATE public.company_relationships
  SET status = CASE WHEN p_approve THEN 'active' ELSE 'rejected' END,
      updated_at = now()
  WHERE id = v_rel.id;

  UPDATE public.contractors
  SET linked_company_status = CASE WHEN p_approve THEN 'linked' ELSE 'rejected' END,
      updated_at = now()
  WHERE id = v_rel.source_contractor_id
    AND company_id = v_rel.requester_company_id;

  IF p_approve AND p_auto_create_client THEN
    SELECT name, company_code
      INTO v_requester_company_name, v_requester_company_code
    FROM public.companies
    WHERE id = v_rel.requester_company_id;

    INSERT INTO public.clients (
      company_id,
      name,
      notes,
      client_type,
      linked_company_id,
      source_contractor_id
    )
    VALUES (
      p_recipient_company_id,
      coalesce(v_requester_company_name, 'Linked company'),
      'Auto-created from approved contractor link. Company code: ' || coalesce(v_requester_company_code, ''),
      'company',
      v_rel.requester_company_id,
      v_rel.source_contractor_id
    )
    ON CONFLICT (company_id, linked_company_id)
    WHERE linked_company_id IS NOT NULL
    DO UPDATE SET
      name = excluded.name,
      source_contractor_id = excluded.source_contractor_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE WHEN p_approve THEN 'active' ELSE 'rejected' END
  );
END;
$$;
