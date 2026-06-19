-- .github/scripts/schema_fingerprint.sql
-- Produces a single MD5 line covering the deterministic public schema fingerprint.
-- Output matches supabase/production_fingerprint.txt for diff comparison.
SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY object_type, object_name, detail))
FROM (
  SELECT
    'TABLE_COLUMN' AS object_type,
    c.table_name || '.' || c.column_name AS object_name,
    c.data_type || '|' || COALESCE(c.column_default,'') || '|' || c.is_nullable AS detail
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  UNION ALL
  SELECT
    'FUNCTION' AS object_type,
    p.proname AS object_name,
    pg_get_function_identity_arguments(p.oid) AS detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
  UNION ALL
  SELECT
    'POLICY' AS object_type,
    pol.tablename || '.' || pol.policyname AS object_name,
    pol.cmd || '|' || COALESCE(pol.qual::text,'') AS detail
  FROM pg_policies pol
  WHERE pol.schemaname = 'public'
  UNION ALL
  SELECT
    'TRIGGER' AS object_type,
    t.trigger_name AS object_name,
    t.event_manipulation || '|' || t.event_object_table AS detail
  FROM information_schema.triggers t
  WHERE t.trigger_schema = 'public'
) t;
