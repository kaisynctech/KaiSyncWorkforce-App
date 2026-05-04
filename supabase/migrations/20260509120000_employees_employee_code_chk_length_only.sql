-- Replace employees_employee_code_format_chk with length-only validation so bootstrap
-- codes (KW…, legacy NN-OWNER, national IDs with unusual punctuation) cannot fail regex
-- quirks or unmigrated patterns on hosted projects.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employee_code_format_chk;

ALTER TABLE public.employees ADD CONSTRAINT employees_employee_code_format_chk CHECK (
  employee_code IS NULL OR (
    char_length(btrim(employee_code)) BETWEEN 2 AND 128
  )
);

COMMENT ON CONSTRAINT employees_employee_code_format_chk ON public.employees IS
  'Trimmed employee_code length 2–128 (format left to HR / imports).';
