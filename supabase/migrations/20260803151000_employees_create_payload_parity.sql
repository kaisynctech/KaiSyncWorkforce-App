-- Employee create/edit web payload parity with live schema.
-- branch_id added in 20260803150000.
-- Map gaps: manager hierarchy, pay-by-hour flag, bank account type.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS manager_id uuid
    REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pay_by_hour boolean NOT NULL DEFAULT false;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS account_type text;

CREATE INDEX IF NOT EXISTS idx_employees_manager_id
  ON public.employees (manager_id)
  WHERE manager_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
