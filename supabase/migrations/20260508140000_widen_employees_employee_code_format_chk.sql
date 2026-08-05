-- Regex-based checks can fail when applied to existing rows (legacy employee_codes).
-- Use length-only validation so migrations apply cleanly on production data.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employee_code_format_chk;
ALTER TABLE public.employees ADD CONSTRAINT employees_employee_code_format_chk CHECK (
  employee_code IS NULL OR (
    char_length(btrim(employee_code)) BETWEEN 2 AND 128
  )
);
COMMENT ON CONSTRAINT employees_employee_code_format_chk ON public.employees IS
  'Trimmed employee_code length 2–128 (existing rows + bootstrap codes).';
