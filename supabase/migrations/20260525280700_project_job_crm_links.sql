-- Project manager, quotations, job contractor/cost, photos, job documents.

ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS manager_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quotation_notes text,
  ADD COLUMN IF NOT EXISTS quotation_valid_until date,
  ADD COLUMN IF NOT EXISTS quotation_sent_at timestamptz;
CREATE TABLE IF NOT EXISTS public.project_quotation_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  deal_id     uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  line_no     integer NOT NULL DEFAULT 1,
  description text NOT NULL,
  quantity    numeric(12,2) NOT NULL DEFAULT 1,
  unit_price  numeric(12,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_quotation_lines_deal
  ON public.project_quotation_lines(deal_id, line_no);
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contractor_cost numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS photo_urls_before text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS photo_urls_after text[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS public.job_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  document_type text NOT NULL DEFAULT 'other',
  file_url      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_documents_job
  ON public.job_documents(job_id, created_at DESC);
ALTER TABLE public.project_quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_quotation_lines_company ON public.project_quotation_lines;
CREATE POLICY project_quotation_lines_company ON public.project_quotation_lines FOR ALL TO authenticated
  USING (company_id IN (SELECT unnest(public.user_company_ids())))
  WITH CHECK (company_id IN (SELECT unnest(public.user_company_ids())));
DROP POLICY IF EXISTS job_documents_company ON public.job_documents;
CREATE POLICY job_documents_company ON public.job_documents FOR ALL TO authenticated
  USING (company_id IN (SELECT unnest(public.user_company_ids())))
  WITH CHECK (company_id IN (SELECT unnest(public.user_company_ids())));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_quotation_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_documents TO authenticated;
-- Client portal: expose quotation on project detail.
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
      d.expected_close_date, d.job_id, d.created_at, d.updated_at,
      d.quotation_notes, d.quotation_valid_until, d.quotation_sent_at,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'line_no', ql.line_no,
            'description', ql.description,
            'quantity', ql.quantity,
            'unit_price', ql.unit_price,
            'line_total', ql.quantity * ql.unit_price
          ) ORDER BY ql.line_no
        ), '[]'::json)
        FROM public.project_quotation_lines ql
        WHERE ql.deal_id = d.id
      ) AS quotation_lines
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
