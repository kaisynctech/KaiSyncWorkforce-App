-- Web employee create/import/list use department; live schema only had cost_center.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS department text;

CREATE INDEX IF NOT EXISTS idx_employees_company_department
  ON public.employees (company_id, department)
  WHERE department IS NOT NULL;

NOTIFY pgrst, 'reload schema';
