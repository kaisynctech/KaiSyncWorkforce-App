-- Edge Functions use the service_role JWT when calling PostgREST with the
-- service key. invite_worker_actor_authorized was only granted to
-- "authenticated", so admin.rpc(...) from invite_worker could fail with
-- "permission denied for function", blocking all invites and audit rows.

GRANT EXECUTE ON FUNCTION public.invite_worker_actor_authorized(bigint, uuid, text)
  TO service_role;
