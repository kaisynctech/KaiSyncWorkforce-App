-- 20261027193812_company_portals_request
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.company_portal_request_link(
  p_company_id uuid,
  p_other_company_code text,
  p_kind text,
  p_record_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_other public.companies%ROWTYPE;
  v_host uuid;
  v_viewer uuid;
  v_client uuid;
  v_contractor uuid;
  v_existing public.company_portal_links%ROWTYPE;
  v_id uuid;
  v_after jsonb;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  IF p_kind NOT IN ('customer', 'hired') THEN
    RAISE EXCEPTION 'Unknown portal kind';
  END IF;
  SELECT * INTO v_other
  FROM public.companies c
  WHERE upper(trim(c.code)) = upper(trim(coalesce(p_other_company_code, '')))
  LIMIT 1;
  IF v_other.id IS NULL THEN
    RAISE EXCEPTION 'No company has that code';
  END IF;
  IF v_other.id = p_company_id THEN
    RAISE EXCEPTION 'A company cannot connect to itself';
  END IF;
  PERFORM public.portal_reject_platform_party(p_company_id, v_other.id);
  v_client := NULL;
  v_contractor := NULL;
  IF p_kind = 'customer' AND p_record_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.clients cl WHERE cl.id = p_record_id AND cl.company_id = p_company_id) THEN
      RAISE EXCEPTION 'Client not found';
    END IF;
    v_host := p_company_id;
    v_viewer := v_other.id;
    v_client := p_record_id;
  ELSIF p_kind = 'customer' THEN
    v_host := v_other.id;
    v_viewer := p_company_id;
  ELSIF p_kind = 'hired' AND p_record_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.contractors ct WHERE ct.id = p_record_id AND ct.company_id = p_company_id) THEN
      RAISE EXCEPTION 'Contractor not found';
    END IF;
    v_host := p_company_id;
    v_viewer := v_other.id;
    v_contractor := p_record_id;
  ELSE
    v_host := v_other.id;
    v_viewer := p_company_id;
  END IF;
  SELECT * INTO v_existing
  FROM public.company_portal_links l
  WHERE l.kind = p_kind AND l.host_company_id = v_host AND l.other_company_id = v_viewer AND l.status IN ('pending', 'active')
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'These companies are already connected';
    END IF;
    RETURN jsonb_build_object('link_id', v_existing.id, 'status', v_existing.status);
  END IF;
  INSERT INTO public.company_portal_links (kind, host_company_id, other_company_id, client_id, contractor_id, status, requested_by_company_id)
  VALUES (p_kind, v_host, v_viewer, v_client, v_contractor, 'pending', p_company_id)
  RETURNING id INTO v_id;
  v_after := jsonb_build_object('kind', p_kind, 'status', 'pending', 'host_company_id', v_host, 'other_company_id', v_viewer, 'client_id', v_client, 'contractor_id', v_contractor);
  PERFORM public.portal_write_link_audit(p_company_id, CASE WHEN p_company_id = v_host THEN v_viewer ELSE v_host END, 'portal_link_requested', v_id, v_after);
  RETURN jsonb_build_object('link_id', v_id, 'status', 'pending');
END;
$$;
REVOKE ALL ON FUNCTION public.company_portal_request_link(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_portal_request_link(uuid, text, text, uuid) TO authenticated;
