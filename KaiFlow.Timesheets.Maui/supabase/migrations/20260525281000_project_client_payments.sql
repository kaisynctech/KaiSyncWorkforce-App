-- Client payments per project (deal) with running balance on client_deals.amount_paid.

CREATE TABLE IF NOT EXISTS public.project_client_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  deal_id         uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  amount          double precision NOT NULL CHECK (amount > 0),
  paid_at         timestamptz NOT NULL DEFAULT now(),
  payment_method  text,
  reference       text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_client_payments_deal
  ON public.project_client_payments (deal_id, paid_at DESC);

ALTER TABLE public.project_client_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_client_payments_all" ON public.project_client_payments
  FOR ALL TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.employees WHERE user_id = auth.uid())
  );
