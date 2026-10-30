-- Linked companies, stage 1 (approved 30 Oct 2026).
-- A provider company's client record and a customer company's contractor record are joined by
-- ONE link. The work stays stored with the provider; later stages let the customer see and add to
-- it from its own app. Linking is done by name search (other office accepts) or a one-time invite.
-- The sign-in company code is never used to connect. The platform home company is never a party.
-- Access only through the SECURITY DEFINER functions below; the tables have no direct grants.

CREATE TABLE IF NOT EXISTS public.company_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  customer_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by_company_id uuid NOT NULL REFERENCES public.companies(id),
  requested_by_user uuid,
  decided_by_user uuid,
  decided_at timestamptz,
  ended_by_user uuid,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_links_status_chk CHECK (status IN ('pending', 'active', 'declined', 'disconnected')),
  CONSTRAINT company_links_two_companies_chk CHECK (provider_company_id <> customer_company_id)
);

-- One open link per direction between two companies, and per record.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_links_pair_open
  ON public.company_links (provider_company_id, customer_company_id) WHERE status IN ('pending', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_links_client_open
  ON public.company_links (provider_client_id) WHERE status IN ('pending', 'active') AND provider_client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_links_contractor_open
  ON public.company_links (customer_contractor_id) WHERE status IN ('pending', 'active') AND customer_contractor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_links_provider ON public.company_links (provider_company_id, status);
CREATE INDEX IF NOT EXISTS idx_company_links_customer ON public.company_links (customer_company_id, status);

ALTER TABLE public.company_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.company_link_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  inviter_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inviter_role text NOT NULL,
  inviter_record_id uuid NOT NULL,
  created_by_user uuid,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  link_id uuid REFERENCES public.company_links(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_link_invites_role_chk CHECK (inviter_role IN ('provider', 'customer'))
);
CREATE INDEX IF NOT EXISTS idx_company_link_invites_inviter ON public.company_link_invites (inviter_company_id, inviter_record_id);

ALTER TABLE public.company_link_invites ENABLE ROW LEVEL SECURITY;

-- ── Helpers ────────────────────────────────────────────────────────────────

-- Owner, HR and admin of the company (making and removing links).
CREATE OR REPLACE FUNCTION public._company_link_admin(p_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'ONLY_OWNER_HR_ADMIN';
  END IF;
END $$;

-- Anyone on the company's office dashboard (owner, admin, HR, managers): seeing links.
CREATE OR REPLACE FUNCTION public._company_link_office(p_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT (public.role_is_hr_or_above(public.get_my_role(p_company_id))
             OR public.get_my_role(p_company_id) = 'manager') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._company_link_no_platform(p_a uuid, p_b uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id IN (p_a, p_b) AND coalesce(c.is_platform_home, false)) THEN
    RAISE EXCEPTION 'PLATFORM_COMPANY';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._company_link_audit(p_link public.company_links, p_actor_company uuid, p_action text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_state jsonb := jsonb_build_object(
  'status', p_link.status, 'provider_company_id', p_link.provider_company_id, 'provider_client_id', p_link.provider_client_id,
  'customer_company_id', p_link.customer_company_id, 'customer_contractor_id', p_link.customer_contractor_id);
BEGIN
  INSERT INTO public.audit_events (company_id, actor_user_id, action, target_type, target_id, after_state, meta)
  VALUES
    (p_link.provider_company_id, auth.uid(), p_action, 'company_link', p_link.id::text, v_state, jsonb_build_object('actor_company_id', p_actor_company)),
    (p_link.customer_company_id, auth.uid(), p_action, 'company_link', p_link.id::text, v_state, jsonb_build_object('actor_company_id', p_actor_company));
END $$;

-- Fill in the record ids and stamp linked_company_id on both records when a link becomes active;
-- clear the stamps when it ends.
CREATE OR REPLACE FUNCTION public._company_link_stamp(p_link public.company_links, p_on boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_on THEN
    UPDATE public.clients SET linked_company_id = p_link.customer_company_id
      WHERE id = p_link.provider_client_id AND company_id = p_link.provider_company_id;
    UPDATE public.contractors SET linked_company_id = p_link.provider_company_id
      WHERE id = p_link.customer_contractor_id AND company_id = p_link.customer_company_id;
  ELSE
    UPDATE public.clients SET linked_company_id = NULL
      WHERE id = p_link.provider_client_id AND company_id = p_link.provider_company_id AND linked_company_id = p_link.customer_company_id;
    UPDATE public.contractors SET linked_company_id = NULL
      WHERE id = p_link.customer_contractor_id AND company_id = p_link.customer_company_id AND linked_company_id = p_link.provider_company_id;
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'RECORD_ALREADY_LINKED';
END $$;

-- The record a company brings to a link: an existing one of its own, or a new one named after the other company.
-- p_role = this company's role: 'provider' brings a client, 'customer' brings a contractor.
CREATE OR REPLACE FUNCTION public._company_link_record(p_company_id uuid, p_role text, p_record_id uuid, p_other_company_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_id uuid; v_name text;
BEGIN
  SELECT name INTO v_name FROM public.companies WHERE id = p_other_company_id;
  IF p_role = 'provider' THEN
    IF p_record_id IS NOT NULL THEN
      SELECT id INTO v_id FROM public.clients WHERE id = p_record_id AND company_id = p_company_id;
      IF v_id IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
      RETURN v_id;
    END IF;
    INSERT INTO public.clients (company_id, name, type) VALUES (p_company_id, coalesce(v_name, 'Linked company'), 'company') RETURNING id INTO v_id;
    RETURN v_id;
  ELSIF p_role = 'customer' THEN
    IF p_record_id IS NOT NULL THEN
      SELECT id INTO v_id FROM public.contractors WHERE id = p_record_id AND company_id = p_company_id;
      IF v_id IS NULL THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
      RETURN v_id;
    END IF;
    INSERT INTO public.contractors (company_id, name) VALUES (p_company_id, coalesce(v_name, 'Linked company')) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  RAISE EXCEPTION 'BAD_ROLE';
END $$;

-- ── Search ─────────────────────────────────────────────────────────────────

-- Find another KaiSync company by trading name. Never returns codes, VAT, bank, phone or email.
CREATE OR REPLACE FUNCTION public.company_link_search(p_company_id uuid, p_query text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q text := btrim(coalesce(p_query, ''));
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  IF char_length(q) < 3 THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'legal_name', c.legal_name,
                                      'registration_number', c.registration_number, 'logo_path', c.brand_logo_path)
                    ORDER BY c.name)
    FROM (
      SELECT * FROM public.companies c
      WHERE c.id <> p_company_id AND NOT coalesce(c.is_platform_home, false)
        AND (c.name ILIKE '%' || replace(replace(q, '%', ''), '_', '') || '%'
             OR c.legal_name ILIKE '%' || replace(replace(q, '%', ''), '_', '') || '%')
      ORDER BY c.name LIMIT 10
    ) c), '[]'::json);
END $$;

-- ── Request by name (the other office accepts) ─────────────────────────────

-- p_my_role: 'provider' (they are my client; p_record_id = my client) or 'customer' (they are my contractor; p_record_id = my contractor).
CREATE OR REPLACE FUNCTION public.company_link_request(p_company_id uuid, p_other_company_id uuid, p_my_role text, p_record_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_links; v_rec uuid;
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  IF p_other_company_id IS NULL OR p_other_company_id = p_company_id THEN RAISE EXCEPTION 'CHOOSE_ANOTHER_COMPANY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_other_company_id) THEN RAISE EXCEPTION 'COMPANY_NOT_FOUND'; END IF;
  PERFORM public._company_link_no_platform(p_company_id, p_other_company_id);
  IF p_record_id IS NULL THEN RAISE EXCEPTION 'RECORD_REQUIRED'; END IF;
  v_rec := public._company_link_record(p_company_id, p_my_role, p_record_id, p_other_company_id);

  BEGIN
    IF p_my_role = 'provider' THEN
      INSERT INTO public.company_links (provider_company_id, provider_client_id, customer_company_id, status, requested_by_company_id, requested_by_user)
      VALUES (p_company_id, v_rec, p_other_company_id, 'pending', p_company_id, auth.uid()) RETURNING * INTO v_link;
    ELSE
      INSERT INTO public.company_links (provider_company_id, customer_company_id, customer_contractor_id, status, requested_by_company_id, requested_by_user)
      VALUES (p_other_company_id, p_company_id, v_rec, 'pending', p_company_id, auth.uid()) RETURNING * INTO v_link;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_LINKED_OR_WAITING';
  END;
  PERFORM public._company_link_audit(v_link, p_company_id, 'company_link_requested');
  RETURN json_build_object('link_id', v_link.id, 'status', v_link.status);
END $$;

-- The other office accepts (bringing its own record, or a new one) or declines.
CREATE OR REPLACE FUNCTION public.company_link_decide(p_company_id uuid, p_link_id uuid, p_accept boolean, p_record_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_links; v_rec uuid; v_role text;
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  SELECT * INTO v_link FROM public.company_links WHERE id = p_link_id FOR UPDATE;
  IF v_link.id IS NULL OR p_company_id NOT IN (v_link.provider_company_id, v_link.customer_company_id) THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  IF v_link.status <> 'pending' THEN RAISE EXCEPTION 'NOT_WAITING'; END IF;
  IF v_link.requested_by_company_id = p_company_id THEN RAISE EXCEPTION 'OTHER_COMPANY_DECIDES'; END IF;
  PERFORM public._company_link_no_platform(v_link.provider_company_id, v_link.customer_company_id);

  IF NOT coalesce(p_accept, false) THEN
    UPDATE public.company_links SET status = 'declined', decided_by_user = auth.uid(), decided_at = now(), updated_at = now()
      WHERE id = v_link.id RETURNING * INTO v_link;
    PERFORM public._company_link_audit(v_link, p_company_id, 'company_link_declined');
    RETURN json_build_object('link_id', v_link.id, 'status', v_link.status);
  END IF;

  v_role := CASE WHEN p_company_id = v_link.provider_company_id THEN 'provider' ELSE 'customer' END;
  v_rec := public._company_link_record(p_company_id, v_role, p_record_id,
             CASE WHEN v_role = 'provider' THEN v_link.customer_company_id ELSE v_link.provider_company_id END);
  BEGIN
    UPDATE public.company_links SET
      provider_client_id = CASE WHEN v_role = 'provider' THEN v_rec ELSE provider_client_id END,
      customer_contractor_id = CASE WHEN v_role = 'customer' THEN v_rec ELSE customer_contractor_id END,
      status = 'active', decided_by_user = auth.uid(), decided_at = now(), updated_at = now()
    WHERE id = v_link.id RETURNING * INTO v_link;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'RECORD_ALREADY_LINKED';
  END;
  PERFORM public._company_link_stamp(v_link, true);
  PERFORM public._company_link_audit(v_link, p_company_id, 'company_link_accepted');
  RETURN json_build_object('link_id', v_link.id, 'status', v_link.status);
END $$;

-- Cancel a request you sent, or disconnect an active link. Nothing is deleted.
CREATE OR REPLACE FUNCTION public.company_link_disconnect(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_links; v_was text;
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  SELECT * INTO v_link FROM public.company_links WHERE id = p_link_id FOR UPDATE;
  IF v_link.id IS NULL OR p_company_id NOT IN (v_link.provider_company_id, v_link.customer_company_id) THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  IF v_link.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'ALREADY_ENDED'; END IF;
  v_was := v_link.status;
  UPDATE public.company_links SET status = 'disconnected', ended_by_user = auth.uid(), ended_at = now(), updated_at = now()
    WHERE id = v_link.id RETURNING * INTO v_link;
  IF v_was = 'active' THEN PERFORM public._company_link_stamp(v_link, false); END IF;
  PERFORM public._company_link_audit(v_link, p_company_id, 'company_link_disconnected');
  RETURN json_build_object('link_id', v_link.id, 'status', v_link.status);
END $$;

-- ── Invites ────────────────────────────────────────────────────────────────

-- One-time invite from a record. Returns the token once; only its hash is stored.
CREATE OR REPLACE FUNCTION public.company_link_create_invite(p_company_id uuid, p_my_role text, p_record_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token text; v_rec uuid; v_exp timestamptz := now() + interval '14 days';
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  IF p_record_id IS NULL THEN RAISE EXCEPTION 'RECORD_REQUIRED'; END IF;
  v_rec := public._company_link_record(p_company_id, p_my_role, p_record_id, NULL);
  IF EXISTS (SELECT 1 FROM public.company_links l WHERE l.status IN ('pending', 'active')
             AND ((p_my_role = 'provider' AND l.provider_client_id = v_rec) OR (p_my_role = 'customer' AND l.customer_contractor_id = v_rec))) THEN
    RAISE EXCEPTION 'RECORD_ALREADY_LINKED';
  END IF;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  INSERT INTO public.company_link_invites (token_hash, inviter_company_id, inviter_role, inviter_record_id, created_by_user, expires_at)
  VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_company_id, p_my_role, v_rec, auth.uid(), v_exp);
  RETURN json_build_object('token', v_token, 'expires_at', v_exp);
END $$;

CREATE OR REPLACE FUNCTION public._company_link_invite_row(p_token text)
RETURNS public.company_link_invites LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT * FROM public.company_link_invites
  WHERE token_hash = encode(extensions.digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex') LIMIT 1;
$$;

-- What the invite says, for a signed-in office user of another company.
CREATE OR REPLACE FUNCTION public.company_link_preview_invite(p_company_id uuid, p_token text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv public.company_link_invites; v_state text;
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  v_inv := public._company_link_invite_row(p_token);
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  v_state := CASE
    WHEN v_inv.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN v_inv.used_at IS NOT NULL THEN 'used'
    WHEN v_inv.expires_at < now() THEN 'expired'
    WHEN v_inv.inviter_company_id = p_company_id THEN 'own'
    ELSE 'open' END;
  RETURN json_build_object(
    'state', v_state,
    'inviter_role', v_inv.inviter_role,
    'expires_at', v_inv.expires_at,
    'inviter', (SELECT json_build_object('id', c.id, 'name', c.name, 'legal_name', c.legal_name, 'logo_path', c.brand_logo_path)
                FROM public.companies c WHERE c.id = v_inv.inviter_company_id));
END $$;

-- Accept an invite: the inviter already agreed, so the link is active at once.
CREATE OR REPLACE FUNCTION public.company_link_accept_invite(p_company_id uuid, p_token text, p_record_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv public.company_link_invites; v_link public.company_links; v_role text; v_rec uuid;
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  v_inv := public._company_link_invite_row(p_token);
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.company_link_invites WHERE id = v_inv.id FOR UPDATE;
  SELECT * INTO v_inv FROM public.company_link_invites WHERE id = v_inv.id;
  IF v_inv.cancelled_at IS NOT NULL OR v_inv.used_at IS NOT NULL THEN RAISE EXCEPTION 'INVITE_USED'; END IF;
  IF v_inv.expires_at < now() THEN RAISE EXCEPTION 'INVITE_EXPIRED'; END IF;
  IF v_inv.inviter_company_id = p_company_id THEN RAISE EXCEPTION 'OWN_INVITE'; END IF;
  PERFORM public._company_link_no_platform(v_inv.inviter_company_id, p_company_id);

  v_role := CASE WHEN v_inv.inviter_role = 'provider' THEN 'customer' ELSE 'provider' END;
  v_rec := public._company_link_record(p_company_id, v_role, p_record_id, v_inv.inviter_company_id);
  BEGIN
    IF v_inv.inviter_role = 'provider' THEN
      INSERT INTO public.company_links (provider_company_id, provider_client_id, customer_company_id, customer_contractor_id,
        status, requested_by_company_id, requested_by_user, decided_by_user, decided_at)
      VALUES (v_inv.inviter_company_id, v_inv.inviter_record_id, p_company_id, v_rec, 'active', v_inv.inviter_company_id, v_inv.created_by_user, auth.uid(), now())
      RETURNING * INTO v_link;
    ELSE
      INSERT INTO public.company_links (provider_company_id, provider_client_id, customer_company_id, customer_contractor_id,
        status, requested_by_company_id, requested_by_user, decided_by_user, decided_at)
      VALUES (p_company_id, v_rec, v_inv.inviter_company_id, v_inv.inviter_record_id, 'active', v_inv.inviter_company_id, v_inv.created_by_user, auth.uid(), now())
      RETURNING * INTO v_link;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_LINKED_OR_WAITING';
  END;
  UPDATE public.company_link_invites SET used_at = now(), used_by_company_id = p_company_id, link_id = v_link.id WHERE id = v_inv.id;
  PERFORM public._company_link_stamp(v_link, true);
  PERFORM public._company_link_audit(v_link, p_company_id, 'company_link_accepted');
  RETURN json_build_object('link_id', v_link.id, 'status', v_link.status);
END $$;

-- ── Lists ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.company_link_list(p_company_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._company_link_office(p_company_id);
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', l.id, 'status', l.status,
      'my_role', CASE WHEN l.provider_company_id = p_company_id THEN 'provider' ELSE 'customer' END,
      'waiting_on_me', l.status = 'pending' AND l.requested_by_company_id <> p_company_id,
      'other', json_build_object('id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'logo_path', o.brand_logo_path),
      'my_record_id', CASE WHEN l.provider_company_id = p_company_id THEN l.provider_client_id ELSE l.customer_contractor_id END,
      'my_record_name', CASE WHEN l.provider_company_id = p_company_id
                              THEN (SELECT name FROM public.clients WHERE id = l.provider_client_id)
                              ELSE (SELECT name FROM public.contractors WHERE id = l.customer_contractor_id) END,
      'created_at', l.created_at, 'decided_at', l.decided_at, 'ended_at', l.ended_at
    ) ORDER BY (l.status = 'pending') DESC, l.created_at DESC)
    FROM public.company_links l
    JOIN public.companies o ON o.id = CASE WHEN l.provider_company_id = p_company_id THEN l.customer_company_id ELSE l.provider_company_id END
    WHERE p_company_id IN (l.provider_company_id, l.customer_company_id)
  ), '[]'::json);
END $$;

-- The open link (and open invite) for one client or contractor record, for its link panel.
CREATE OR REPLACE FUNCTION public.company_link_for_record(p_company_id uuid, p_my_role text, p_record_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.company_links;
BEGIN
  PERFORM public._company_link_office(p_company_id);
  SELECT * INTO v_link FROM public.company_links l
  WHERE l.status IN ('pending', 'active')
    AND ((p_my_role = 'provider' AND l.provider_company_id = p_company_id AND l.provider_client_id = p_record_id)
      OR (p_my_role = 'customer' AND l.customer_company_id = p_company_id AND l.customer_contractor_id = p_record_id))
  LIMIT 1;
  IF v_link.id IS NULL THEN RETURN json_build_object('link', NULL); END IF;
  RETURN json_build_object('link', json_build_object(
    'id', v_link.id, 'status', v_link.status,
    'waiting_on_me', v_link.status = 'pending' AND v_link.requested_by_company_id <> p_company_id,
    'other', (SELECT json_build_object('id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'logo_path', o.brand_logo_path)
              FROM public.companies o WHERE o.id = CASE WHEN p_my_role = 'provider' THEN v_link.customer_company_id ELSE v_link.provider_company_id END),
    'decided_at', v_link.decided_at));
END $$;

-- My own records the other side can be matched to when accepting (clients if I am the provider, contractors if the customer).
CREATE OR REPLACE FUNCTION public.company_link_my_records(p_company_id uuid, p_my_role text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._company_link_admin(p_company_id);
  IF p_my_role = 'provider' THEN
    RETURN coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name)
      FROM public.clients WHERE company_id = p_company_id AND linked_company_id IS NULL), '[]'::json);
  END IF;
  RETURN coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name)
    FROM public.contractors WHERE company_id = p_company_id AND linked_company_id IS NULL AND coalesce(is_active, true)), '[]'::json);
END $$;

-- Helpers (names starting with _company_link_) run with the caller's rights, not SECURITY DEFINER:
-- called directly they can do no more than the caller's own RLS allows; called from the public
-- functions above they run as those functions' owner.
