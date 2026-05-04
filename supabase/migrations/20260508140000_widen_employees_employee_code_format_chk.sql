-- Further widen employee_code validation for national IDs / payroll refs that use
-- slashes, underscores, apostrophes (e.g. O'Brien), or spaces — still blocking
-- control characters implicitly via allowed charset.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employee_code_format_chk;

ALTER TABLE public.employees ADD CONSTRAINT employees_employee_code_format_chk CHECK (
  employee_code IS NULL OR (
    char_length(trim(employee_code)) BETWEEN 2 AND 80
    AND trim(employee_code) ~ $pat$^[A-Za-z0-9\-_/.' ]+$ $pat$
  )
);

COMMENT ON CONSTRAINT employees_employee_code_format_chk ON public.employees IS
  'Letters, digits, hyphen, underscore, slash, period, apostrophe, space (trimmed length 2–80).';
