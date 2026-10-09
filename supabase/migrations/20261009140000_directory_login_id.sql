-- The employees list "code" is the ID number people use to sign in.
-- The directory already returns employee_code, which is often empty.

DO $$
DECLARE
  src text;
  next text;
BEGIN
  SELECT pg_get_functiondef(
    'public.list_employee_directory(uuid,text,text,text,text,uuid,integer,integer)'::regprocedure
  ) INTO src;

  IF strpos(src, 'e.id_number') > 0 THEN
    RETURN;
  END IF;

  next := replace(
    src,
    'e.employee_code,',
    E'e.employee_code,\n      e.id_number,'
  );
  IF next = src THEN
    RAISE EXCEPTION 'list_employee_directory select list was not patched for id_number';
  END IF;

  next := replace(
    next,
    'OR strpos(lower(coalesce(e.employee_code, '''')), lower(v_search)) > 0',
    E'OR strpos(lower(coalesce(e.employee_code, '''')), lower(v_search)) > 0\n        OR strpos(lower(coalesce(e.id_number, '''')), lower(v_search)) > 0'
  );
  IF (length(next) - length(replace(next, 'e.id_number', ''))) / length('e.id_number') < 3 THEN
    RAISE EXCEPTION 'list_employee_directory was not fully patched for id_number';
  END IF;

  EXECUTE next;
END $$;
