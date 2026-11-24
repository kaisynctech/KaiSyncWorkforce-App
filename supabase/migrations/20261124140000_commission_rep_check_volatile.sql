-- 20261124140000_commission_rep_check_volatile
-- employee_is_commission_rep was marked STABLE (read-only), but _assert_worker_access records the
-- worker's code session (an UPDATE). For workers signed in with a code, the API therefore refused the
-- call ("cannot execute UPDATE in a read-only transaction", HTTP 405): 47 times in the 24 h to
-- 24 Nov 2026, so commission reps signed in by code did not see their commission.
-- Same fix as 20261020124532_worker_rpcs_volatile_and_job_photo_urls. Undo: ALTER ... STABLE.
ALTER FUNCTION public.employee_is_commission_rep(uuid, uuid, text) VOLATILE;
NOTIFY pgrst, 'reload schema';
