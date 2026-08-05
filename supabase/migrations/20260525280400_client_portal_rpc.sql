-- Client portal: list/get projects via company + client code (anon-safe, no internal notes).

CREATE OR REPLACE FUNCTION public.client_portal_list_projects(
  p_company_code text,
  p_client_code  text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
  FROM (
    SELECT
      d.id,
      d.company_id,
      d.client_id,
      d.project_code,
      d.title,
      d.status,
      d.offer_amount,
      d.amount_paid,
      d.progress_percent,
      d.agreement_notes,
      d.last_update_note,
      d.last_update_at,
      d.expected_close_date,
      d.job_id,
      d.created_at,
      d.updated_at
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND d.visibility <> 'private'
  ) t;
$$;
CREATE OR REPLACE FUNCTION public.client_portal_get_project(
  p_company_code text,
  p_client_code  text,
  p_deal_id      uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(t)
  FROM (
    SELECT
      d.id,
      d.company_id,
      d.client_id,
      d.project_code,
      d.title,
      d.status,
      d.offer_amount,
      d.amount_paid,
      d.progress_percent,
      d.agreement_notes,
      d.last_update_note,
      d.last_update_at,
      d.expected_close_date,
      d.job_id,
      d.created_at,
      d.updated_at
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND d.id = p_deal_id
      AND d.visibility <> 'private'
    LIMIT 1
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.client_portal_list_projects(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_project(text, text, uuid) TO anon, authenticated;
