-- 20261019104144_client_portal_get_project_portal_guard
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

DO $patch$
DECLARE
  def text;
  hits int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'client_portal_get_project';
  hits := (length(def) - length(replace(def, 'AND cl.client_code IS NOT NULL', ''))) / length('AND cl.client_code IS NOT NULL');
  IF hits <> 1 THEN
    RAISE EXCEPTION 'unexpected match count %', hits;
  END IF;
  IF position('portal_enabled' in def) > 0 THEN
    RAISE EXCEPTION 'already guarded';
  END IF;
  def := replace(def, 'AND cl.client_code IS NOT NULL', 'AND cl.client_code IS NOT NULL AND coalesce(cl.portal_enabled, false) = true');
  EXECUTE def;
END
$patch$;
