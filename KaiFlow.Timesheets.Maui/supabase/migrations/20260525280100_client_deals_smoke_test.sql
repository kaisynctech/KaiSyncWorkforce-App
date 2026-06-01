-- Smoke test: client_deals CRUD + job link (runs as migration; rolls back on failure).
DO $$
DECLARE
  v_company_id uuid;
  v_client_id  uuid;
  v_deal_id    uuid;
  v_job_id     uuid;
  v_count      int;
BEGIN
  SELECT id INTO v_company_id FROM public.companies ORDER BY created_at LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE NOTICE 'client_deals smoke test skipped: no companies';
    RETURN;
  END IF;

  SELECT id INTO v_client_id
  FROM public.clients
  WHERE company_id = v_company_id
  ORDER BY created_at
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE NOTICE 'client_deals smoke test skipped: no clients for company %', v_company_id;
    RETURN;
  END IF;

  INSERT INTO public.client_deals (
    company_id, client_id, title, status, offer_amount, notes
  ) VALUES (
    v_company_id, v_client_id, '__smoke_test_project__', 'draft', 1234.56, 'automated smoke test'
  ) RETURNING id INTO v_deal_id;

  SELECT COUNT(*) INTO v_count
  FROM public.client_deals
  WHERE id = v_deal_id AND title = '__smoke_test_project__';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'client_deals smoke test failed: insert not visible';
  END IF;

  INSERT INTO public.jobs (
    company_id, client_id, title, description, status, deal_id
  ) VALUES (
    v_company_id, v_client_id, '__smoke_test_job__', 'linked from smoke test', 'scheduled', v_deal_id
  ) RETURNING id INTO v_job_id;

  UPDATE public.client_deals
  SET job_id = v_job_id, updated_at = now()
  WHERE id = v_deal_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.client_deals d ON d.id = j.deal_id AND d.job_id = j.id
    WHERE j.id = v_job_id AND d.id = v_deal_id
  ) THEN
    RAISE EXCEPTION 'client_deals smoke test failed: bidirectional job link';
  END IF;

  DELETE FROM public.jobs WHERE id = v_job_id;
  DELETE FROM public.client_deals WHERE id = v_deal_id;

  RAISE NOTICE 'client_deals smoke test passed for company %', v_company_id;
END $$;
