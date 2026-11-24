-- 20261027193838_company_portals_read
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.portal_link_json(p_link public.company_portal_links, p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public
AS $$
  SELECT jsonb_build_object(
    'link_id', (p_link).id,
    'kind', (p_link).kind,
    'status', (p_link).status,
    'host_company_id', (p_link).host_company_id,
    'other_company_id', (p_link).other_company_id,
    'company_id', CASE WHEN p_company_id = (p_link).host_company_id THEN other_co.id ELSE host.id END,
    'company_name', CASE WHEN p_company_id = (p_link).host_company_id THEN other_co.name ELSE host.name END,
    'company_code', CASE WHEN p_company_id = (p_link).host_company_id THEN other_co.code ELSE host.code END,
    'record_id', CASE WHEN (p_link).kind = 'customer' THEN (p_link).client_id ELSE (p_link).contractor_id END,
    'record_name', CASE WHEN (p_link).kind = 'customer' THEN cl.name ELSE ct.name END,
    'requested_by_company_id', (p_link).requested_by_company_id,
    'awaiting', CASE
      WHEN (p_link).status <> 'pending' THEN NULL
      WHEN (p_link).requested_by_company_id = p_company_id THEN 'them'
      ELSE 'us'
    END,
    'needs_record', (p_link).status = 'pending'
      AND p_company_id = (p_link).host_company_id
      AND (
        ((p_link).kind = 'customer' AND (p_link).client_id IS NULL)
        OR ((p_link).kind = 'hired' AND (p_link).contractor_id IS NULL)
      )
  )
  FROM public.companies host
  JOIN public.companies other_co ON other_co.id = (p_link).other_company_id
  LEFT JOIN public.clients cl ON cl.id = (p_link).client_id
  LEFT JOIN public.contractors ct ON ct.id = (p_link).contractor_id
  WHERE host.id = (p_link).host_company_id;
$$;
REVOKE ALL ON FUNCTION public.portal_link_json(public.company_portal_links, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.company_portal_list(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public
AS $$
DECLARE v_client jsonb; v_contractor jsonb; v_decide jsonb;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  SELECT coalesce(jsonb_agg(public.portal_link_json(l, p_company_id) ORDER BY host.name), '[]'::jsonb) INTO v_client
  FROM public.company_portal_links l
  JOIN public.companies host ON host.id = l.host_company_id
  WHERE l.kind = 'customer' AND l.other_company_id = p_company_id AND NOT host.is_platform_home
    AND (l.status = 'active' OR (l.status = 'pending' AND l.requested_by_company_id = p_company_id));
  SELECT coalesce(jsonb_agg(public.portal_link_json(l, p_company_id) ORDER BY host.name), '[]'::jsonb) INTO v_contractor
  FROM public.company_portal_links l
  JOIN public.companies host ON host.id = l.host_company_id
  WHERE l.kind = 'hired' AND l.other_company_id = p_company_id AND NOT host.is_platform_home
    AND (l.status = 'active' OR (l.status = 'pending' AND l.requested_by_company_id = p_company_id));
  SELECT coalesce(jsonb_agg(public.portal_link_json(l, p_company_id) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_decide
  FROM public.company_portal_links l
  JOIN public.companies host ON host.id = l.host_company_id
  JOIN public.companies other_co ON other_co.id = l.other_company_id
  WHERE l.status = 'pending' AND l.requested_by_company_id <> p_company_id
    AND p_company_id IN (l.host_company_id, l.other_company_id)
    AND NOT host.is_platform_home AND NOT other_co.is_platform_home;
  RETURN jsonb_build_object('as_client', v_client, 'as_contractor', v_contractor, 'to_decide', v_decide);
END;
$$;
REVOKE ALL ON FUNCTION public.company_portal_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_portal_list(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.company_portal_record_link(p_company_id uuid, p_kind text, p_record_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public
AS $$
DECLARE v_link public.company_portal_links%ROWTYPE;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  IF p_kind NOT IN ('customer', 'hired') OR p_record_id IS NULL THEN RETURN 'null'::jsonb; END IF;
  SELECT * INTO v_link FROM public.company_portal_links l
  WHERE l.kind = p_kind AND l.host_company_id = p_company_id AND l.status IN ('pending', 'active')
    AND ((p_kind = 'customer' AND l.client_id = p_record_id) OR (p_kind = 'hired' AND l.contractor_id = p_record_id))
  LIMIT 1;
  IF v_link.id IS NULL THEN RETURN 'null'::jsonb; END IF;
  RETURN public.portal_link_json(v_link, p_company_id);
END;
$$;
REVOKE ALL ON FUNCTION public.company_portal_record_link(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_portal_record_link(uuid, text, uuid) TO authenticated;
