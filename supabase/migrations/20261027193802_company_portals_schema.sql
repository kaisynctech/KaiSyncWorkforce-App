-- 20261027193802_company_portals_schema
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

-- Company portals.
CREATE TABLE IF NOT EXISTS public.company_portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  host_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  other_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by_company_id uuid NOT NULL REFERENCES public.companies(id),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_portal_links_kind_chk CHECK (kind IN ('customer', 'hired')),
  CONSTRAINT company_portal_links_status_chk CHECK (status IN ('pending', 'active', 'rejected', 'cancelled')),
  CONSTRAINT company_portal_links_distinct_chk CHECK (host_company_id <> other_company_id),
  CONSTRAINT company_portal_links_record_chk CHECK (
    (kind = 'customer' AND contractor_id IS NULL)
    OR (kind = 'hired' AND client_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_portal_links_open
  ON public.company_portal_links (kind, host_company_id, other_company_id)
  WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_company_portal_links_other
  ON public.company_portal_links (other_company_id, status);
CREATE INDEX IF NOT EXISTS idx_company_portal_links_host
  ON public.company_portal_links (host_company_id, status);
ALTER TABLE public.company_portal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_portal_links FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.company_portal_links IS
  'Accepted links let the other company read shared work. customer: host owns the client. hired: host owns the contractor assignment.';
CREATE OR REPLACE FUNCTION public.portal_office_employee(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'company_id required'; END IF;
  SELECT e.id INTO v_id FROM public.employees e
  WHERE e.company_id = p_company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true)
    AND lower(coalesce(e.access_level, '')) IN ('owner', 'hr', 'hr_admin', 'admin')
  LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_office_employee(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.portal_reject_platform_party(p_company_id uuid, p_other_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id IN (p_company_id, p_other_id) AND c.is_platform_home) THEN
    RAISE EXCEPTION 'The platform company is not connected here';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_reject_platform_party(uuid, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.portal_write_link_audit(p_actor_company_id uuid, p_other_company_id uuid, p_action text, p_link_id uuid, p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public
AS $$
BEGIN
  PERFORM public.write_audit_event(p_actor_company_id, p_action, 'company_portal_link', p_link_id::text, NULL, p_after, jsonb_build_object('other_company_id', p_other_company_id));
  INSERT INTO public.audit_events (company_id, actor_user_id, action, target_type, target_id, after_state, meta)
  VALUES (p_other_company_id, auth.uid(), p_action, 'company_portal_link', p_link_id::text, p_after, jsonb_build_object('other_company_id', p_actor_company_id));
END;
$$;
REVOKE ALL ON FUNCTION public.portal_write_link_audit(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
