-- Project CRM: deposit, in_progress status, activity timeline, documents.

ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS deposit_required numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.client_deals DROP CONSTRAINT IF EXISTS client_deals_status_check;
ALTER TABLE public.client_deals DROP CONSTRAINT IF EXISTS client_deals_status_chk;
ALTER TABLE public.client_deals
  ADD CONSTRAINT client_deals_status_chk
  CHECK (status IN ('draft', 'sent', 'negotiation', 'in_progress', 'won', 'lost'));
CREATE TABLE IF NOT EXISTS public.client_deal_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  deal_id     uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  body        text NOT NULL,
  status_from text,
  status_to   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_deal_updates_deal
  ON public.client_deal_updates(deal_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.project_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  deal_id       uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  document_type text NOT NULL DEFAULT 'contract',
  file_url      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_documents_deal
  ON public.project_documents(deal_id, created_at DESC);
ALTER TABLE public.client_deal_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_deal_updates_company ON public.client_deal_updates;
CREATE POLICY client_deal_updates_company ON public.client_deal_updates FOR ALL TO authenticated
  USING (company_id IN (SELECT unnest(public.user_company_ids())))
  WITH CHECK (company_id IN (SELECT unnest(public.user_company_ids())));
DROP POLICY IF EXISTS project_documents_company ON public.project_documents;
CREATE POLICY project_documents_company ON public.project_documents FOR ALL TO authenticated
  USING (company_id IN (SELECT unnest(public.user_company_ids())))
  WITH CHECK (company_id IN (SELECT unnest(public.user_company_ids())));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_deal_updates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_documents TO authenticated;
-- Expose deposit on client portal RPCs.
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
      d.id, d.company_id, d.client_id, d.project_code, d.title, d.status,
      d.offer_amount, d.amount_paid, d.deposit_required, d.progress_percent,
      d.agreement_notes, d.last_update_note, d.last_update_at,
      d.expected_close_date, d.job_id, d.created_at, d.updated_at
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
      d.id, d.company_id, d.client_id, d.project_code, d.title, d.status,
      d.offer_amount, d.amount_paid, d.deposit_required, d.progress_percent,
      d.agreement_notes, d.last_update_note, d.last_update_at,
      d.expected_close_date, d.job_id, d.created_at, d.updated_at
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
