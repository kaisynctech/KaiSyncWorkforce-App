-- CLIENT-PORTAL-SPEC-002 P4: client banking for refunds (same flow as contractor banking).
-- The client submits details in the portal -> pending request -> HR approves (writes
-- client_bank_details, audited by trigger) or rejects with a reason. HR is notified.
-- The portal only ever sees the account number masked. Additive only.

CREATE TABLE IF NOT EXISTS public.client_banking_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid NOT NULL,
  account_holder text,
  bank_name text,
  account_number text,
  branch_code text,
  account_type text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_banking_updates_client ON public.client_banking_updates (company_id, client_id, submitted_at DESC);
ALTER TABLE public.client_banking_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_banking_updates FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._mask_account(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p IS NULL OR length(regexp_replace(p, '\s', '', 'g')) = 0 THEN NULL
              ELSE repeat('•', greatest(0, length(regexp_replace(p, '\s', '', 'g')) - 4))
                   || right(regexp_replace(p, '\s', '', 'g'), 4) END;
$$;

CREATE OR REPLACE FUNCTION public.notify_hr_client_banking_update(p_company_id uuid, p_client_id uuid, p_account_last4 text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
  v_name text;
  v_hour text := to_char(now(), 'YYYYMMDDHH24');
BEGIN
  SELECT coalesce(nullif(trim(name), ''), 'Client') INTO v_name FROM public.clients WHERE id = p_client_id;
  FOR r IN
    SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
    FROM public.employees e
    WHERE e.company_id = p_company_id AND e.is_active = true AND e.user_id IS NOT NULL
      AND e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
  LOOP
    INSERT INTO public.app_notifications (
      company_id, audience, recipient_auth_user_id, recipient_employee_id,
      type, title, body, ref_type, ref_id, dedupe_key, data)
    VALUES (
      p_company_id, 'hr', r.auth_user_id, r.employee_id,
      'client_banking_pending', 'Client Banking Update Requires Review',
      coalesce(v_name, 'Client') || ' submitted bank details for refunds'
        || CASE WHEN coalesce(p_account_last4, '') <> '' THEN ' (account ending ' || p_account_last4 || ')' ELSE '' END
        || ' — review on the client record.',
      'client', p_client_id::text,
      'client_banking_pending:' || p_client_id::text || ':' || r.employee_id::text || ':' || v_hour,
      jsonb_build_object('client_id', p_client_id, 'account_last4', p_account_last4))
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_get_banking(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT json_build_object(
    'current', (
      SELECT json_build_object('account_holder', b.account_holder, 'bank_name', b.bank_name,
                               'masked_account', public._mask_account(b.account_number), 'branch_code', b.branch_code,
                               'updated_at', b.updated_at)
      FROM public.client_bank_details b WHERE b.client_id = x.client_id AND b.company_id = x.company_id),
    'latest', (
      SELECT json_build_object('status', u.status, 'account_holder', u.account_holder, 'bank_name', u.bank_name,
                               'masked_account', public._mask_account(u.account_number), 'branch_code', u.branch_code,
                               'account_type', u.account_type, 'submitted_at', u.submitted_at,
                               'reviewed_at', u.reviewed_at, 'rejection_reason', u.rejection_reason)
      FROM public.client_banking_updates u
      WHERE u.client_id = x.client_id AND u.company_id = x.company_id AND u.status <> 'superseded'
      ORDER BY u.submitted_at DESC LIMIT 1)
  )
  FROM public._client_portal_client(p_company_code, p_client_code) x;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_submit_banking(
  p_company_code text, p_client_code text,
  p_account_holder text, p_bank_name text, p_account_number text, p_branch_code text, p_account_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_client_id uuid;
  v_company_id uuid;
  v_id uuid;
  v_acc text := regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g');
BEGIN
  SELECT x.client_id, x.company_id INTO v_client_id, v_company_id
  FROM public._client_portal_client(p_company_code, p_client_code) x;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF trim(coalesce(p_account_holder, '')) = '' THEN RAISE EXCEPTION 'Account holder name is required'; END IF;
  IF trim(coalesce(p_bank_name, '')) = '' THEN RAISE EXCEPTION 'Bank name is required'; END IF;
  IF v_acc = '' THEN RAISE EXCEPTION 'Account number is required'; END IF;
  IF v_acc !~ '^[0-9]{5,20}$' THEN RAISE EXCEPTION 'Account number must be 5 to 20 digits'; END IF;
  IF length(p_account_holder) > 200 OR length(p_bank_name) > 200 OR length(coalesce(p_branch_code, '')) > 20
     OR length(coalesce(p_account_type, '')) > 50 THEN
    RAISE EXCEPTION 'A banking field is too long';
  END IF;

  -- A new submission replaces any request still waiting for review.
  UPDATE public.client_banking_updates SET status = 'superseded'
  WHERE client_id = v_client_id AND company_id = v_company_id AND status = 'pending';

  INSERT INTO public.client_banking_updates (company_id, client_id, account_holder, bank_name, account_number, branch_code, account_type)
  VALUES (v_company_id, v_client_id, trim(p_account_holder), trim(p_bank_name), v_acc,
          nullif(trim(coalesce(p_branch_code, '')), ''), nullif(trim(coalesce(p_account_type, '')), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company_id, NULL, 'ClientPortal', 'client_banking_update_submitted', 'info',
          jsonb_build_object('client_id', v_client_id::text, 'update_id', v_id, 'account_last4', right(v_acc, 4)), now());

  PERFORM public.notify_hr_client_banking_update(v_company_id, v_client_id, right(v_acc, 4));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_get_client_banking_updates(p_company_id uuid, p_client_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'clients.edit');
  RETURN (
    SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.submitted_at DESC), '[]'::json) FROM (
      SELECT u.id, u.status, u.account_holder, u.bank_name, u.account_number, u.branch_code, u.account_type,
             u.submitted_at, u.reviewed_at, u.rejection_reason,
             (SELECT trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, '')) FROM public.employees e WHERE e.id = u.reviewed_by) AS reviewed_by_name
      FROM public.client_banking_updates u
      WHERE u.company_id = p_company_id AND u.client_id = p_client_id AND u.status <> 'superseded'
      ORDER BY u.submitted_at DESC LIMIT 10
    ) t);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_review_client_banking(p_update_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_u public.client_banking_updates%ROWTYPE;
  v_reviewer public.employees%ROWTYPE;
BEGIN
  SELECT * INTO v_u FROM public.client_banking_updates WHERE id = p_update_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Banking update not found'; END IF;
  PERFORM public.require_user_permission(v_u.company_id, 'clients.edit');
  IF v_u.status <> 'pending' THEN RAISE EXCEPTION 'This update was already %', v_u.status; END IF;
  IF NOT p_approve AND trim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason for rejecting'; END IF;

  SELECT * INTO v_reviewer FROM public.employees
  WHERE user_id = auth.uid() AND company_id = v_u.company_id AND is_active = true LIMIT 1;

  IF p_approve THEN
    INSERT INTO public.client_bank_details (company_id, client_id, account_holder, bank_name, account_number, branch_code, updated_at)
    VALUES (v_u.company_id, v_u.client_id, v_u.account_holder, v_u.bank_name, v_u.account_number, v_u.branch_code, now())
    ON CONFLICT (client_id) DO UPDATE SET
      account_holder = EXCLUDED.account_holder, bank_name = EXCLUDED.bank_name,
      account_number = EXCLUDED.account_number, branch_code = EXCLUDED.branch_code, updated_at = now()
    WHERE public.client_bank_details.company_id = v_u.company_id;
  END IF;

  UPDATE public.client_banking_updates
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now(), reviewed_by = v_reviewer.id,
      rejection_reason = CASE WHEN p_approve THEN NULL ELSE trim(p_reason) END
  WHERE id = p_update_id;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_u.company_id, auth.uid(), 'HrClientDetails',
          CASE WHEN p_approve THEN 'client_banking_update_approved' ELSE 'client_banking_update_rejected' END, 'info',
          jsonb_build_object('client_id', v_u.client_id::text, 'update_id', p_update_id,
                             'account_last4', right(v_u.account_number, 4), 'reason', p_reason), now());
END;
$$;

REVOKE ALL ON FUNCTION public.notify_hr_client_banking_update(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_get_client_banking_updates(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_review_client_banking(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_get_client_banking_updates(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_review_client_banking(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_banking(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_submit_banking(text, text, text, text, text, text, text) TO anon, authenticated;
