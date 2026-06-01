-- Smoke test: client portal sign-in + list/get RPCs with a temporary project.
-- Runs on db push; rolls back the transaction on RAISE EXCEPTION.
DO $$
DECLARE
  v_company_id     uuid;
  v_company_code   text;
  v_client_id      uuid;
  v_client_code    text;
  v_saved_code     text;
  v_assigned_code  boolean := false;
  v_deal_id        uuid;
  v_list           json;
  v_one            json;
  v_list_len       int;
BEGIN
  SELECT c.id, trim(c.code), cl.id, cl.client_code
    INTO v_company_id, v_company_code, v_client_id, v_saved_code
  FROM public.companies c
  JOIN public.clients cl ON cl.company_id = c.id
  ORDER BY c.created_at, cl.created_at
  LIMIT 1;

  IF v_company_id IS NULL OR v_client_id IS NULL THEN
    RAISE NOTICE 'client_portal RPC smoke skipped: no company/client';
    RETURN;
  END IF;

  IF v_company_code IS NULL OR v_company_code = '' THEN
    RAISE NOTICE 'client_portal RPC smoke skipped: company has no code';
    RETURN;
  END IF;

  v_client_code := v_saved_code;
  IF v_client_code IS NULL OR trim(v_client_code) = '' THEN
    v_client_code := '__SMOKE_PORTAL_CLIENT__';
    UPDATE public.clients
       SET client_code = v_client_code
     WHERE id = v_client_id;
    v_assigned_code := true;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.client_resolve_by_code(v_company_code, v_client_code) r
    WHERE r.client_id = v_client_id
  ) THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: client_resolve_by_code';
  END IF;

  INSERT INTO public.client_deals (
    company_id,
    client_id,
    project_code,
    title,
    status,
    offer_amount,
    amount_paid,
    progress_percent,
    agreement_notes,
    last_update_note,
    visibility
  ) VALUES (
    v_company_id,
    v_client_id,
    '__SMOKE_P__',
    '__smoke_portal_project__',
    'sent',
    1000.00,
    250.00,
    25,
    'Smoke agreement notes',
    'Smoke project update',
    'all'
  )
  RETURNING id INTO v_deal_id;

  v_list := public.client_portal_list_projects(v_company_code, v_client_code);
  IF v_list IS NULL THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: list_projects returned null';
  END IF;

  SELECT jsonb_array_length(v_list::jsonb) INTO v_list_len;
  IF v_list_len < 1 THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: list_projects empty after insert';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_list::jsonb) elem
    WHERE (elem->>'id')::uuid = v_deal_id
  ) THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: list_projects missing inserted deal %', v_deal_id;
  END IF;

  v_one := public.client_portal_get_project(v_company_code, v_client_code, v_deal_id);
  IF v_one IS NULL THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: get_project returned null';
  END IF;

  IF (v_one::jsonb ->> 'title') IS DISTINCT FROM '__smoke_portal_project__' THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: get_project title mismatch';
  END IF;

  IF (v_one::jsonb ->> 'agreement_notes') IS DISTINCT FROM 'Smoke agreement notes' THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: agreement_notes not exposed';
  END IF;

  IF (v_one::jsonb ->> 'notes') IS NOT NULL THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: internal notes must not be exposed';
  END IF;

  -- Private projects must not appear in portal list.
  UPDATE public.client_deals
     SET visibility = 'private'
   WHERE id = v_deal_id;

  v_list := public.client_portal_list_projects(v_company_code, v_client_code);
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(v_list::jsonb, '[]'::jsonb)) elem
    WHERE (elem->>'id')::uuid = v_deal_id
  ) THEN
    RAISE EXCEPTION 'client_portal RPC smoke failed: private project visible in portal list';
  END IF;

  DELETE FROM public.client_deals WHERE id = v_deal_id;

  IF v_assigned_code THEN
    UPDATE public.clients SET client_code = NULL WHERE id = v_client_id;
  END IF;

  RAISE NOTICE 'client_portal RPC smoke test passed (company %, client %)', v_company_code, v_client_code;
END $$;
