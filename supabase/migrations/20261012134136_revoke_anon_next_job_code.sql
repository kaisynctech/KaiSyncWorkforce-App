-- Direct job-code allocation is for a signed-in user.
-- Security-definer workflows (employee create, quote conversion, tenant issues)
-- still call this function as the owner.

REVOKE ALL ON FUNCTION public._next_job_code(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._next_job_code(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._next_job_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._next_job_code(uuid) TO service_role;

COMMENT ON FUNCTION public._next_job_code(uuid) IS
  'Next job code for a company. Executable by signed-in users. Anonymous direct calls are revoked.';
