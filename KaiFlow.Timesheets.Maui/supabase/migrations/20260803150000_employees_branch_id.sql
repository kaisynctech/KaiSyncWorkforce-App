-- Fix: employees.branch_id missing while web create/edit/list write it.
-- branches table already exists (20260520062624_feature_parity).

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS branch_id uuid
    REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_branch_id
  ON public.employees (branch_id)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_company_branch
  ON public.employees (company_id, branch_id)
  WHERE branch_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
