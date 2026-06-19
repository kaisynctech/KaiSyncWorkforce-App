-- .github/scripts/schema_fingerprint.sql
-- Produces deterministic text fingerprint of the public schema.
-- Exclude Supabase-internal objects.
SELECT 'TABLE_COLUMN' as kind,
  c.table_name || '.' || c.column_name as object,
  c.data_type || '|' || c.is_nullable || '|' || COALESCE(c.column_default, 'NULL') as definition
FROM information_schema.columns c
WHERE c.table_schema = 'public'
ORDER BY 1, 2
UNION ALL
SELECT 'FUNCTION' as kind,
  p.proname || '(' || pg_get_function_arguments(p.oid) || ')' as object,
  p.prosecdef::text || '|' || pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
ORDER BY 1, 2
UNION ALL
SELECT 'POLICY' as kind,
  pc.tablename || '.' || pc.policyname as object,
  pc.cmd || '|' || COALESCE(pc.qual, 'NULL') || '|' || COALESCE(pc.with_check, 'NULL') as definition
FROM pg_policies pc
WHERE pc.schemaname = 'public'
ORDER BY 1, 2
UNION ALL
SELECT 'TRIGGER' as kind,
  t.trigger_name || ' ON ' || t.event_object_table as object,
  t.action_timing || '|' || t.event_manipulation || '|' || t.action_statement as definition
FROM information_schema.triggers t
WHERE t.trigger_schema = 'public'
ORDER BY 1, 2;
