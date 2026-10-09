-- Company enforcement stays the master switch. This flag chooses which people
-- must be at a branch to clock in. Location is still stored on the punch when off.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS enforce_branch_geofence boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.employees.enforce_branch_geofence IS
  'When company branch sign-in enforcement is on, true requires a clock-in inside an assigned branch. False still records the punch location.';

GRANT SELECT (enforce_branch_geofence), UPDATE (enforce_branch_geofence)
  ON public.employees TO authenticated;

DO $$
DECLARE
  src text;
  next text;
BEGIN
  SELECT pg_get_functiondef(
    'public.list_employee_directory(uuid,text,text,text,text,uuid,integer,integer)'::regprocedure
  ) INTO src;
  next := replace(
    src,
    'e.shift_template_id',
    E'e.shift_template_id,\n      e.enforce_branch_geofence'
  );
  IF next = src THEN
    RAISE EXCEPTION 'list_employee_directory was not patched for enforce_branch_geofence';
  END IF;
  EXECUTE next;

  SELECT pg_get_functiondef(
    'public.employee_get_overview_bundle(uuid,uuid,text,boolean,boolean,boolean,boolean,boolean)'::regprocedure
  ) INTO src;
  next := replace(
    src,
    '''branch_id'', e.branch_id',
    E'''branch_id'', e.branch_id,\n        ''enforce_branch_geofence'', e.enforce_branch_geofence'
  );
  IF next = src THEN
    RAISE EXCEPTION 'employee_get_overview_bundle was not patched for enforce_branch_geofence';
  END IF;
  EXECUTE next;
END $$;

NOTIFY pgrst, 'reload schema';
