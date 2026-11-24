-- 20261124150000_lock_old_is_company_owner
-- The old bigint version of is_company_owner refers to employees.profile_id, a column that no longer
-- exists, so it fails if called. The four policies that check company ownership all use
-- is_company_owner(uuid); the bigint version is only called by is_visible_to_me(text,bigint,bigint),
-- which was already locked in 20261124130000. Same treatment: no API access, function kept.
-- Undo: GRANT EXECUTE ON FUNCTION public.is_company_owner(bigint) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_company_owner(bigint) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
