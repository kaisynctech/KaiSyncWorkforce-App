-- Manual smoke test: run with `supabase db query --linked --file supabase/smoke/client_deals_live_smoke.sql`
DO $$
DECLARE
  v_company_id uuid;
  v_client_id  uuid;
  v_deal_id    uuid;
  v_job_id     uuid;
  v_created_client boolean := false;
BEGIN
  SELECT id INTO v_company_id FROM public.companies ORDER BY created_at LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No companies found';
  END IF;

  SELECT id INTO v_client_id
  FROM public.clients
  WHERE company_id = v_company_id
  ORDER BY created_at
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (company_id, name, type)
    VALUES (v_company_id, '__smoke_test_client__', 'individual')
    RETURNING id INTO v_client_id;
    v_created_client := true;
  END IF;

  INSERT INTO public.client_deals (
    company_id, client_id, title, status, offer_amount, notes
  ) VALUES (
    v_company_id, v_client_id, '__smoke_test_project__', 'draft', 1234.56, 'live smoke test'
  ) RETURNING id INTO v_deal_id;

  INSERT INTO public.jobs (
    company_id, client_id, title, description, status, deal_id
  ) VALUES (
    v_company_id, v_client_id, '__smoke_test_job__', 'linked from live smoke test', 'scheduled', v_deal_id
  ) RETURNING id INTO v_job_id;

  UPDATE public.client_deals SET job_id = v_job_id, updated_at = now() WHERE id = v_deal_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.client_deals d ON d.id = j.deal_id AND d.job_id = j.id
    WHERE j.id = v_job_id AND d.id = v_deal_id
  ) THEN
    RAISE EXCEPTION 'Bidirectional job link failed';
  END IF;

  DELETE FROM public.jobs WHERE id = v_job_id;
  DELETE FROM public.client_deals WHERE id = v_deal_id;
  IF v_created_client THEN
    DELETE FROM public.clients WHERE id = v_client_id;
  END IF;

  RAISE NOTICE 'client_deals live smoke test PASSED (company %)', v_company_id;
END $$;
