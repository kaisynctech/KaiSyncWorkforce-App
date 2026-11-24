-- 20261027193826_company_portals_decide
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.company_portal_decide_link(
  p_company_id uuid,
  p_link_id uuid,
  p_accept boolean,
  p_record_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_link public.company_portal_links%ROWTYPE;
  v_client uuid;
  v_contractor uuid;
  v_after jsonb;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  SELECT * INTO v_link FROM public.company_portal_links WHERE id = p_link_id;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'Connection not found'; END IF;
  IF p_company_id NOT IN (v_link.host_company_id, v_link.other_company_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_link.status <> 'pending' THEN RAISE EXCEPTION 'This connection is no longer waiting'; END IF;
  IF v_link.requested_by_company_id = p_company_id THEN RAISE EXCEPTION 'The other company accepts this connection'; END IF;
  PERFORM public.portal_reject_platform_party(v_link.host_company_id, v_link.other_company_id);
  IF NOT coalesce(p_accept, false) THEN
    UPDATE public.company_portal_links
    SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
    WHERE id = v_link.id;
    v_after := jsonb_build_object('status', 'rejected', 'kind', v_link.kind);
    PERFORM public.portal_write_link_audit(p_company_id, CASE WHEN p_company_id = v_link.host_company_id THEN v_link.other_company_id ELSE v_link.host_company_id END, 'portal_link_rejected', v_link.id, v_after);
    RETURN jsonb_build_object('link_id', v_link.id, 'status', 'rejected');
  END IF;
  v_client := v_link.client_id;
  v_contractor := v_link.contractor_id;
  IF v_link.kind = 'customer' THEN
    IF v_client IS NULL THEN
      IF p_company_id <> v_link.host_company_id OR p_record_id IS NULL THEN
        RAISE EXCEPTION 'Choose the client this company is';
      END IF;
      v_client := p_record_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.clients cl WHERE cl.id = v_client AND cl.company_id = v_link.host_company_id) THEN
      RAISE EXCEPTION 'Client not found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.clients cl WHERE cl.id = v_client AND cl.linked_company_id IS NOT NULL AND cl.linked_company_id <> v_link.other_company_id) THEN
      RAISE EXCEPTION 'This client is already connected to another company';
    END IF;
    BEGIN
      UPDATE public.clients SET linked_company_id = v_link.other_company_id WHERE id = v_client AND company_id = v_link.host_company_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'That company is already connected to another client';
    END;
  ELSE
    IF v_contractor IS NULL THEN
      IF p_company_id <> v_link.host_company_id OR p_record_id IS NULL THEN
        RAISE EXCEPTION 'Choose the contractor this company is';
      END IF;
      v_contractor := p_record_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.contractors ct WHERE ct.id = v_contractor AND ct.company_id = v_link.host_company_id) THEN
      RAISE EXCEPTION 'Contractor not found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.contractors ct WHERE ct.id = v_contractor AND ct.linked_company_id IS NOT NULL AND ct.linked_company_id <> v_link.other_company_id) THEN
      RAISE EXCEPTION 'This contractor is already connected to another company';
    END IF;
    BEGIN
      UPDATE public.contractors SET linked_company_id = v_link.other_company_id WHERE id = v_contractor AND company_id = v_link.host_company_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'That company is already connected to another contractor';
    END;
  END IF;
  UPDATE public.company_portal_links
  SET status = 'active', client_id = v_client, contractor_id = v_contractor, decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE id = v_link.id;
  v_after := jsonb_build_object('status', 'active', 'kind', v_link.kind, 'client_id', v_client, 'contractor_id', v_contractor);
  PERFORM public.portal_write_link_audit(p_company_id, CASE WHEN p_company_id = v_link.host_company_id THEN v_link.other_company_id ELSE v_link.host_company_id END, 'portal_link_accepted', v_link.id, v_after);
  RETURN jsonb_build_object('link_id', v_link.id, 'status', 'active');
END;
$$;
REVOKE ALL ON FUNCTION public.company_portal_decide_link(uuid, uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_portal_decide_link(uuid, uuid, boolean, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.company_portal_cancel_link(p_company_id uuid, p_link_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public
AS $$
DECLARE v_link public.company_portal_links%ROWTYPE;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  SELECT * INTO v_link FROM public.company_portal_links WHERE id = p_link_id;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'Connection not found'; END IF;
  IF p_company_id NOT IN (v_link.host_company_id, v_link.other_company_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_link.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'This connection is already closed'; END IF;
  IF v_link.status = 'active' AND v_link.kind = 'customer' AND v_link.client_id IS NOT NULL THEN
    UPDATE public.clients SET linked_company_id = NULL
    WHERE id = v_link.client_id AND company_id = v_link.host_company_id AND linked_company_id = v_link.other_company_id;
  END IF;
  IF v_link.status = 'active' AND v_link.kind = 'hired' AND v_link.contractor_id IS NOT NULL THEN
    UPDATE public.contractors SET linked_company_id = NULL
    WHERE id = v_link.contractor_id AND company_id = v_link.host_company_id AND linked_company_id = v_link.other_company_id;
  END IF;
  UPDATE public.company_portal_links SET status = 'cancelled', updated_at = now(), decided_by = auth.uid(), decided_at = now() WHERE id = v_link.id;
  PERFORM public.portal_write_link_audit(p_company_id, CASE WHEN p_company_id = v_link.host_company_id THEN v_link.other_company_id ELSE v_link.host_company_id END, 'portal_link_cancelled', v_link.id, jsonb_build_object('status', 'cancelled', 'kind', v_link.kind));
  RETURN jsonb_build_object('link_id', v_link.id, 'status', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.company_portal_cancel_link(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_portal_cancel_link(uuid, uuid) TO authenticated;
