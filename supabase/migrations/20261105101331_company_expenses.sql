-- 20261105101331_company_expenses
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE TABLE IF NOT EXISTS public.company_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  category text NOT NULL DEFAULT 'Other',
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('once', 'weekly', 'monthly', 'quarterly', 'yearly')),
  start_date date NOT NULL,
  end_date date,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('card', 'debit_order', 'eft', 'cash', 'other')),
  supplier_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  notes text,
  archived_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS company_expenses_company_idx ON public.company_expenses (company_id);
ALTER TABLE public.company_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_expenses_read ON public.company_expenses FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
CREATE POLICY company_expenses_insert ON public.company_expenses FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
CREATE POLICY company_expenses_update ON public.company_expenses FOR UPDATE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
GRANT SELECT, INSERT, UPDATE ON public.company_expenses TO authenticated;

CREATE OR REPLACE FUNCTION public._expense_payments(p_company_id uuid, p_from date, p_to date)
RETURNS TABLE (expense_id uuid, pay_date date, amount numeric, vat_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, d.pay_date, e.amount, e.vat_amount
  FROM public.company_expenses e
  CROSS JOIN LATERAL (
    SELECT (CASE e.frequency
              WHEN 'weekly' THEN e.start_date + (n * 7)
              WHEN 'monthly' THEN (e.start_date + make_interval(months => n))::date
              WHEN 'quarterly' THEN (e.start_date + make_interval(months => n * 3))::date
              WHEN 'yearly' THEN (e.start_date + make_interval(years => n))::date
              ELSE e.start_date END) AS pay_date
    FROM generate_series(0, CASE WHEN e.frequency = 'once' THEN 0 ELSE 600 END) n
  ) d
  WHERE e.company_id = p_company_id AND e.archived_at IS NULL
    AND d.pay_date BETWEEN greatest(p_from, e.start_date) AND least(p_to, coalesce(e.end_date, p_to))
$$;
REVOKE ALL ON FUNCTION public._expense_payments(uuid, date, date) FROM PUBLIC, anon, authenticated;
