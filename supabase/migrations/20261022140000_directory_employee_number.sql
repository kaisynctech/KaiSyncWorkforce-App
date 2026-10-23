-- W2 follow-up: the employee directory returns employee_number and searches it.
-- Also fixes the search: it used coalesce(employee_code, id_number), so the ID number was only
-- searched when the sign-in code was empty. Number, sign-in code and ID number are now each searched.
-- Applied as a text replacement of the live definition (the function body is long).
DO $m$
DECLARE d text := pg_get_functiondef('public.list_employee_directory'::regproc);
  a1 text := E'      e.employee_code,\n      e.id_number,';
  a2 text := E'OR strpos(lower(coalesce(e.employee_code,\n      e.id_number, \'\')), lower(v_search)) > 0';
  n1 int; n2 int;
BEGIN
  n1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  n2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  IF n1 <> 1 OR n2 <> 2 THEN RAISE EXCEPTION 'unexpected matches % %', n1, n2; END IF;
  d := replace(d, a1, E'      e.employee_code,\n      e.employee_number,\n      e.id_number,');
  d := replace(d, a2, E'OR strpos(lower(coalesce(e.employee_number, \'\')), lower(v_search)) > 0\n        OR strpos(lower(coalesce(e.employee_code, \'\')), lower(v_search)) > 0\n        OR strpos(lower(coalesce(e.id_number, \'\')), lower(v_search)) > 0');
  EXECUTE d;
END $m$;
