-- Manual smoke: client portal RPCs (run after db push).
--   supabase db query --linked --file supabase/smoke/client_portal_rpc_smoke.sql
--
-- Migration 20260525280500_client_portal_rpc_smoke_test.sql runs the same checks automatically on push.

DO $$
DECLARE
  v_company_code text;
  v_client_code  text;
  v_company_id   uuid;
  v_client_id    uuid;
  v_saved_code   text;
  v_assigned     boolean := false;
  v_deal_id      uuid;
  v_list         json;
  v_one          json;
BEGIN
  SELECT c.id, trim(c.code), cl.id, cl.client_code
    INTO v_company_id, v_company_code, v_client_id, v_saved_code
  FROM public.companies c
  JOIN public.clients cl ON cl.company_id = c.id
  ORDER BY c.created_at, cl.created_at
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'client_portal manual smoke: no company/client in database';
  END IF;

  v_client_code := v_saved_code;
  IF v_client_code IS NULL OR trim(v_client_code) = '' THEN
    v_client_code := '__SMOKE_PORTAL_CLIENT__';
    UPDATE public.clients SET client_code = v_client_code WHERE id = v_client_id;
    v_assigned := true;
  END IF;

  INSERT INTO public.client_deals (
    company_id, client_id, title, status, offer_amount, amount_paid,
    progress_percent, agreement_notes, visibility
  ) VALUES (
    v_company_id, v_client_id, '__smoke_portal_project__', 'sent',
    500, 100, 10, 'Manual smoke agreement', 'all'
  ) RETURNING id INTO v_deal_id;

  v_list := public.client_portal_list_projects(v_company_code, v_client_code);
  IF jsonb_array_length(v_list::jsonb) < 1 THEN
    RAISE EXCEPTION 'client_portal manual smoke: list empty';
  END IF;

  v_one := public.client_portal_get_project(v_company_code, v_client_code, v_deal_id);
  IF v_one IS NULL THEN
    RAISE EXCEPTION 'client_portal manual smoke: get returned null';
  END IF;

  DELETE FROM public.client_deals WHERE id = v_deal_id;
  IF v_assigned THEN
    UPDATE public.clients SET client_code = NULL WHERE id = v_client_id;
  END IF;

  RAISE NOTICE 'client_portal manual smoke PASSED (% / %)', v_company_code, v_client_code;
END $$;
