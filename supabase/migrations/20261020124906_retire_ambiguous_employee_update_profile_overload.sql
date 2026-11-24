-- 20261020124906_retire_ambiguous_employee_update_profile_overload
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

SET lock_timeout = '5s';
-- Non-destructive version of 20261019150000: the obsolete 10-argument overload is renamed
-- (kept for rollback) instead of dropped, which removes the PostgREST ambiguity (PGRST203).
ALTER FUNCTION public.employee_update_profile(uuid, uuid, text, text, text, text, text, text, text, text)
  RENAME TO employee_update_profile_legacy_10arg;
REVOKE EXECUTE ON FUNCTION public.employee_update_profile_legacy_10arg(uuid, uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
