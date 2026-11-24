-- UNDO for 20261124130000_fix_removed_table_references (run only if something goes wrong).
-- Restores the four functions and all removed rights from the backups taken by the migration.
DO $undo$
DECLARE r record;
BEGIN
  FOR r IN SELECT name, def FROM public._fn_backup
           WHERE name LIKE 'before 20261124130000%' ORDER BY saved_at
  LOOP
    EXECUTE r.def;
  END LOOP;
END $undo$;
NOTIFY pgrst, 'reload schema';
