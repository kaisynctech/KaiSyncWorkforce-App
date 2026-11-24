-- 20261027193849_company_portals_open
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.company_portal_open(p_company_id uuid, p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public
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
    IF v_link.client_id IS NULL THEN RAISE EXCEPTION 'Connection not found'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC), '[]'::jsonb) INTO v_jobs
    FROM (
      SELECT j.id, j.job_code, j.title, j.status, j.scheduled_start, j.scheduled_end, j.created_at
      FROM public.jobs j
      WHERE j.company_id = v_link.host_company_id AND j.client_id = v_link.client_id
        AND j.visibility IS DISTINCT FROM 'private'
        AND NOT (j.visibility = 'inherit' AND EXISTS (
          SELECT 1 FROM public.client_deals hidden
          WHERE hidden.id = j.deal_id AND hidden.company_id = j.company_id AND hidden.visibility = 'private'
        ))
      ORDER BY j.scheduled_start DESC NULLS LAST, j.created_at DESC
      LIMIT 200
    ) t;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.sent_at DESC NULLS LAST), '[]'::jsonb) INTO v_quotes
    FROM (
      SELECT q.id, q.quote_number, q.title, q.status, q.total_amount, q.currency, q.valid_until, q.sent_at
      FROM public.commercial_quotes q
      WHERE q.company_id = v_link.host_company_id AND q.client_id = v_link.client_id
        AND q.status IN ('sent', 'viewed', 'accepted', 'declined', 'expired')
      ORDER BY q.sent_at DESC NULLS LAST LIMIT 200
    ) t;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.issue_date DESC NULLS LAST), '[]'::jsonb) INTO v_invoices
    FROM (
      SELECT i.id, i.invoice_number, i.status, i.total_amount, i.balance_due, i.currency, i.issue_date, i.due_date
      FROM public.finance_invoices i
      WHERE i.company_id = v_link.host_company_id AND i.client_id = v_link.client_id
        AND i.status NOT IN ('draft', 'cancelled', 'voided')
      ORDER BY i.issue_date DESC NULLS LAST LIMIT 200
    ) t;
  ELSE
    IF v_link.contractor_id IS NULL THEN RAISE EXCEPTION 'Connection not found'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC), '[]'::jsonb) INTO v_jobs
    FROM (
      SELECT j.id, j.job_code, j.title, j.status, j.scheduled_start, j.scheduled_end, j.created_at
      FROM public.job_contractors jc
      JOIN public.jobs j ON j.id = jc.job_id AND j.company_id = jc.company_id
      WHERE jc.company_id = v_link.host_company_id AND jc.contractor_id = v_link.contractor_id AND jc.status <> 'cancelled'
      ORDER BY j.scheduled_start DESC NULLS LAST, j.created_at DESC
      LIMIT 200
    ) t;
    v_quotes := '[]'::jsonb;
    v_invoices := '[]'::jsonb;
  END IF;
  RETURN jsonb_build_object('link', public.portal_link_json(v_link, p_company_id), 'jobs', v_jobs, 'quotes', v_quotes, 'invoices', v_invoices);
END;
$$;
REVOKE ALL ON FUNCTION public.company_portal_open(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_portal_open(uuid, uuid) TO authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.company_portal_list('00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'portal list allowed an anonymous call';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%Not authenticated%' AND SQLERRM NOT ILIKE '%Access denied%' THEN
      RAISE;
    END IF;
  END;
END $$;
