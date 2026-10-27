-- Company portals.
-- A customer company reads the provider's jobs, quotes and invoices for one client.
-- A hired company reads jobs the other company assigned to one contractor.
-- Neither side copies the work. The other company accepts before anything is shared.
-- The platform home company is never a party to these links.

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id required';
  END IF;

  SELECT e.id INTO v_id
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.user_id = auth.uid()
    AND coalesce(e.is_active, true)
    AND lower(coalesce(e.access_level, '')) IN ('owner', 'hr', 'hr_admin', 'admin')
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_office_employee(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_reject_platform_party(p_company_id uuid, p_other_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id IN (p_company_id, p_other_id)
      AND c.is_platform_home
  ) THEN
    RAISE EXCEPTION 'The platform company is not connected here';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_reject_platform_party(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_write_link_audit(
  p_actor_company_id uuid,
  p_other_company_id uuid,
  p_action text,
  p_link_id uuid,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  PERFORM public.write_audit_event(
    p_actor_company_id,
    p_action,
    'company_portal_link',
    p_link_id::text,
    NULL,
    p_after,
    jsonb_build_object('other_company_id', p_other_company_id)
  );

  INSERT INTO public.audit_events (
    company_id, actor_user_id, action, target_type, target_id, after_state, meta
  ) VALUES (
    p_other_company_id,
    auth.uid(),
    p_action,
    'company_portal_link',
    p_link_id::text,
    p_after,
    jsonb_build_object('other_company_id', p_actor_company_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_write_link_audit(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

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
    IF NOT EXISTS (
      SELECT 1 FROM public.clients cl
      WHERE cl.id = p_record_id AND cl.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Client not found';
    END IF;
    v_host := p_company_id;
    v_viewer := v_other.id;
    v_client := p_record_id;
  ELSIF p_kind = 'customer' THEN
    v_host := v_other.id;
    v_viewer := p_company_id;
  ELSIF p_kind = 'hired' AND p_record_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.contractors ct
      WHERE ct.id = p_record_id AND ct.company_id = p_company_id
    ) THEN
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
  WHERE l.kind = p_kind
    AND l.host_company_id = v_host
    AND l.other_company_id = v_viewer
    AND l.status IN ('pending', 'active')
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'These companies are already connected';
    END IF;
    RETURN jsonb_build_object('link_id', v_existing.id, 'status', v_existing.status);
  END IF;

  INSERT INTO public.company_portal_links (
    kind, host_company_id, other_company_id, client_id, contractor_id,
    status, requested_by_company_id
  ) VALUES (
    p_kind, v_host, v_viewer, v_client, v_contractor,
    'pending', p_company_id
  )
  RETURNING id INTO v_id;

  v_after := jsonb_build_object(
    'kind', p_kind,
    'status', 'pending',
    'host_company_id', v_host,
    'other_company_id', v_viewer,
    'client_id', v_client,
    'contractor_id', v_contractor
  );
  PERFORM public.portal_write_link_audit(p_company_id, CASE WHEN p_company_id = v_host THEN v_viewer ELSE v_host END, 'portal_link_requested', v_id, v_after);

  RETURN jsonb_build_object('link_id', v_id, 'status', 'pending');
END;
$$;

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
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Connection not found';
  END IF;
  IF p_company_id NOT IN (v_link.host_company_id, v_link.other_company_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_link.status <> 'pending' THEN
    RAISE EXCEPTION 'This connection is no longer waiting';
  END IF;
  IF v_link.requested_by_company_id = p_company_id THEN
    RAISE EXCEPTION 'The other company accepts this connection';
  END IF;
  PERFORM public.portal_reject_platform_party(v_link.host_company_id, v_link.other_company_id);

  IF NOT coalesce(p_accept, false) THEN
    UPDATE public.company_portal_links
    SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
    WHERE id = v_link.id;
    v_after := jsonb_build_object('status', 'rejected', 'kind', v_link.kind);
    PERFORM public.portal_write_link_audit(
      p_company_id,
      CASE WHEN p_company_id = v_link.host_company_id THEN v_link.other_company_id ELSE v_link.host_company_id END,
      'portal_link_rejected', v_link.id, v_after
    );
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
    IF NOT EXISTS (
      SELECT 1 FROM public.clients cl
      WHERE cl.id = v_client AND cl.company_id = v_link.host_company_id
    ) THEN
      RAISE EXCEPTION 'Client not found';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.clients cl
      WHERE cl.id = v_client
        AND cl.linked_company_id IS NOT NULL
        AND cl.linked_company_id <> v_link.other_company_id
    ) THEN
      RAISE EXCEPTION 'This client is already connected to another company';
    END IF;
    BEGIN
      UPDATE public.clients
      SET linked_company_id = v_link.other_company_id
      WHERE id = v_client AND company_id = v_link.host_company_id;
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
    IF NOT EXISTS (
      SELECT 1 FROM public.contractors ct
      WHERE ct.id = v_contractor AND ct.company_id = v_link.host_company_id
    ) THEN
      RAISE EXCEPTION 'Contractor not found';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.contractors ct
      WHERE ct.id = v_contractor
        AND ct.linked_company_id IS NOT NULL
        AND ct.linked_company_id <> v_link.other_company_id
    ) THEN
      RAISE EXCEPTION 'This contractor is already connected to another company';
    END IF;
    BEGIN
      UPDATE public.contractors
      SET linked_company_id = v_link.other_company_id
      WHERE id = v_contractor AND company_id = v_link.host_company_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'That company is already connected to another contractor';
    END;
  END IF;

  UPDATE public.company_portal_links
  SET status = 'active',
      client_id = v_client,
      contractor_id = v_contractor,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now()
  WHERE id = v_link.id;

  v_after := jsonb_build_object(
    'status', 'active',
    'kind', v_link.kind,
    'client_id', v_client,
    'contractor_id', v_contractor
  );
  PERFORM public.portal_write_link_audit(
    p_company_id,
    CASE WHEN p_company_id = v_link.host_company_id THEN v_link.other_company_id ELSE v_link.host_company_id END,
    'portal_link_accepted', v_link.id, v_after
  );
  RETURN jsonb_build_object('link_id', v_link.id, 'status', 'active');
END;
$$;

CREATE OR REPLACE FUNCTION public.company_portal_cancel_link(
  p_company_id uuid,
  p_link_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_link public.company_portal_links%ROWTYPE;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  SELECT * INTO v_link FROM public.company_portal_links WHERE id = p_link_id;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Connection not found';
  END IF;
  IF p_company_id NOT IN (v_link.host_company_id, v_link.other_company_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_link.status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'This connection is already closed';
  END IF;

  IF v_link.status = 'active' AND v_link.kind = 'customer' AND v_link.client_id IS NOT NULL THEN
    UPDATE public.clients
    SET linked_company_id = NULL
    WHERE id = v_link.client_id
      AND company_id = v_link.host_company_id
      AND linked_company_id = v_link.other_company_id;
  END IF;

  IF v_link.status = 'active' AND v_link.kind = 'hired' AND v_link.contractor_id IS NOT NULL THEN
    UPDATE public.contractors
    SET linked_company_id = NULL
    WHERE id = v_link.contractor_id
      AND company_id = v_link.host_company_id
      AND linked_company_id = v_link.other_company_id;
  END IF;

  UPDATE public.company_portal_links
  SET status = 'cancelled', updated_at = now(), decided_by = auth.uid(), decided_at = now()
  WHERE id = v_link.id;

  PERFORM public.portal_write_link_audit(
    p_company_id,
    CASE WHEN p_company_id = v_link.host_company_id THEN v_link.other_company_id ELSE v_link.host_company_id END,
    'portal_link_cancelled',
    v_link.id,
    jsonb_build_object('status', 'cancelled', 'kind', v_link.kind)
  );
  RETURN jsonb_build_object('link_id', v_link.id, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_link_json(p_link public.company_portal_links, p_company_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
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
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_client jsonb;
  v_contractor jsonb;
  v_decide jsonb;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);

  SELECT coalesce(jsonb_agg(public.portal_link_json(l, p_company_id) ORDER BY host.name), '[]'::jsonb)
  INTO v_client
  FROM public.company_portal_links l
  JOIN public.companies host ON host.id = l.host_company_id
  WHERE l.kind = 'customer'
    AND l.other_company_id = p_company_id
    AND NOT host.is_platform_home
    AND (
      l.status = 'active'
      OR (l.status = 'pending' AND l.requested_by_company_id = p_company_id)
    );

  SELECT coalesce(jsonb_agg(public.portal_link_json(l, p_company_id) ORDER BY host.name), '[]'::jsonb)
  INTO v_contractor
  FROM public.company_portal_links l
  JOIN public.companies host ON host.id = l.host_company_id
  WHERE l.kind = 'hired'
    AND l.other_company_id = p_company_id
    AND NOT host.is_platform_home
    AND (
      l.status = 'active'
      OR (l.status = 'pending' AND l.requested_by_company_id = p_company_id)
    );

  SELECT coalesce(jsonb_agg(public.portal_link_json(l, p_company_id) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_decide
  FROM public.company_portal_links l
  JOIN public.companies host ON host.id = l.host_company_id
  JOIN public.companies other_co ON other_co.id = l.other_company_id
  WHERE l.status = 'pending'
    AND l.requested_by_company_id <> p_company_id
    AND p_company_id IN (l.host_company_id, l.other_company_id)
    AND NOT host.is_platform_home
    AND NOT other_co.is_platform_home;

  RETURN jsonb_build_object(
    'as_client', v_client,
    'as_contractor', v_contractor,
    'to_decide', v_decide
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.company_portal_record_link(
  p_company_id uuid,
  p_kind text,
  p_record_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_link public.company_portal_links%ROWTYPE;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  IF p_kind NOT IN ('customer', 'hired') OR p_record_id IS NULL THEN
    RETURN 'null'::jsonb;
  END IF;

  SELECT * INTO v_link
  FROM public.company_portal_links l
  WHERE l.kind = p_kind
    AND l.host_company_id = p_company_id
    AND l.status IN ('pending', 'active')
    AND (
      (p_kind = 'customer' AND l.client_id = p_record_id)
      OR (p_kind = 'hired' AND l.contractor_id = p_record_id)
    )
  LIMIT 1;

  IF v_link.id IS NULL THEN
    RETURN 'null'::jsonb;
  END IF;
  RETURN public.portal_link_json(v_link, p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_portal_open(p_company_id uuid, p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_link public.company_portal_links%ROWTYPE;
  v_jobs jsonb;
  v_quotes jsonb;
  v_invoices jsonb;
BEGIN
  PERFORM public.portal_office_employee(p_company_id);
  SELECT * INTO v_link FROM public.company_portal_links WHERE id = p_link_id;
  IF v_link.id IS NULL OR v_link.other_company_id <> p_company_id OR v_link.status <> 'active' THEN
    RAISE EXCEPTION 'Connection not found';
  END IF;
  PERFORM public.portal_reject_platform_party(v_link.host_company_id, v_link.other_company_id);

  IF v_link.kind = 'customer' THEN
    IF v_link.client_id IS NULL THEN
      RAISE EXCEPTION 'Connection not found';
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC), '[]'::jsonb)
    INTO v_jobs
    FROM (
      SELECT j.id, j.job_code, j.title, j.status, j.scheduled_start, j.scheduled_end, j.created_at
      FROM public.jobs j
      WHERE j.company_id = v_link.host_company_id
        AND j.client_id = v_link.client_id
        AND j.visibility IS DISTINCT FROM 'private'
        AND NOT (
          j.visibility = 'inherit'
          AND EXISTS (
            SELECT 1 FROM public.client_deals hidden
            WHERE hidden.id = j.deal_id
              AND hidden.company_id = j.company_id
              AND hidden.visibility = 'private'
          )
        )
      ORDER BY j.scheduled_start DESC NULLS LAST, j.created_at DESC
      LIMIT 200
    ) t;

    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.sent_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_quotes
    FROM (
      SELECT q.id, q.quote_number, q.title, q.status, q.total_amount, q.currency, q.valid_until, q.sent_at
      FROM public.commercial_quotes q
      WHERE q.company_id = v_link.host_company_id
        AND q.client_id = v_link.client_id
        AND q.status IN ('sent', 'viewed', 'accepted', 'declined', 'expired')
      ORDER BY q.sent_at DESC NULLS LAST
      LIMIT 200
    ) t;

    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.issue_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_invoices
    FROM (
      SELECT i.id, i.invoice_number, i.status, i.total_amount, i.balance_due, i.currency, i.issue_date, i.due_date
      FROM public.finance_invoices i
      WHERE i.company_id = v_link.host_company_id
        AND i.client_id = v_link.client_id
        AND i.status NOT IN ('draft', 'cancelled', 'voided')
      ORDER BY i.issue_date DESC NULLS LAST
      LIMIT 200
    ) t;
  ELSE
    IF v_link.contractor_id IS NULL THEN
      RAISE EXCEPTION 'Connection not found';
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC), '[]'::jsonb)
    INTO v_jobs
    FROM (
      SELECT j.id, j.job_code, j.title, j.status, j.scheduled_start, j.scheduled_end, j.created_at
      FROM public.job_contractors jc
      JOIN public.jobs j ON j.id = jc.job_id AND j.company_id = jc.company_id
      WHERE jc.company_id = v_link.host_company_id
        AND jc.contractor_id = v_link.contractor_id
        AND jc.status <> 'cancelled'
      ORDER BY j.scheduled_start DESC NULLS LAST, j.created_at DESC
      LIMIT 200
    ) t;

    v_quotes := '[]'::jsonb;
    v_invoices := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'link', public.portal_link_json(v_link, p_company_id),
    'jobs', v_jobs,
    'quotes', v_quotes,
    'invoices', v_invoices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.company_portal_request_link(uuid, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_portal_decide_link(uuid, uuid, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_portal_cancel_link(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_portal_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_portal_record_link(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_portal_open(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.company_portal_request_link(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_portal_decide_link(uuid, uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_portal_cancel_link(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_portal_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_portal_record_link(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_portal_open(uuid, uuid) TO authenticated;

DO $$
BEGIN
  BEGIN
    PERFORM public.company_portal_list('00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'portal list allowed an anonymous call';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Not authenticated%' AND SQLERRM NOT ILIKE '%Access denied%' THEN
        RAISE;
      END IF;
  END;
END $$;
