-- 20261117200000_commission_reps_not_a_link_table
-- Restored on 2026-11-24 from the live database. Applied to production on 17 Nov 2026 in the SQL editor.
-- commission_reps had a primary key made only of foreign keys (company_id, employee_id), so the API treated it as a
-- link table between companies and employees and the employees -> companies embed became ambiguous (login loop, 16 Nov).

ALTER TABLE public.commission_reps ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.commission_reps DROP CONSTRAINT commission_reps_pkey;
ALTER TABLE public.commission_reps ADD CONSTRAINT commission_reps_pkey PRIMARY KEY (id);
ALTER TABLE public.commission_reps ADD CONSTRAINT commission_reps_company_employee_key UNIQUE (company_id, employee_id);
NOTIFY pgrst, 'reload schema';
