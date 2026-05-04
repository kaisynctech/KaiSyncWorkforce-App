-- Fix: "new row for relation employees violates check constraint employees_employee_code_format_chk"
-- Run once in Supabase Dashboard → SQL Editor → New query → Run (whole file).
-- Safe to re-run: drops and recreates the same constraint name.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employee_code_format_chk;

ALTER TABLE public.employees ADD CONSTRAINT employees_employee_code_format_chk CHECK (
  employee_code IS NULL OR (
    char_length(btrim(employee_code)) BETWEEN 2 AND 128
  )
);

COMMENT ON CONSTRAINT employees_employee_code_format_chk ON public.employees IS
  'Trimmed employee_code length 2–128 (KaiSync Workforce bootstrap + payroll IDs).';
