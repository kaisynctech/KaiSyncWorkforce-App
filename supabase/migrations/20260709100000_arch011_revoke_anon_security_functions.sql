-- ARCH-011: Revoke anon EXECUTE from security-definer helper functions
--
-- These three functions are SECURITY DEFINER and are used internally by RLS
-- policies and authenticated client calls. They are meaningless to an
-- unauthenticated (anon) caller — auth.uid() returns NULL so they produce
-- empty/false results — but exposing SECURITY DEFINER functions to anon
-- unnecessarily widens the attack surface.
--
-- Impact on code-login employees (company code + ID number):
--   None. The portal login RPC runs as SECURITY DEFINER owner before a JWT
--   exists. Once the RPC issues a JWT the session becomes `authenticated`,
--   which retains full EXECUTE on all three functions.
--
-- user_company_ids()            — no args, returns uuid[]
--   Defined in 20260518130243. Never had an explicit anon revoke.
--
-- my_permissions(bigint)        — takes company_id (legacy int), returns permission rows
-- my_permissions(uuid)          — takes company_id (uuid), returns permission rows
--   Both defined in 20260512110000. Have REVOKE FROM public but not explicitly FROM anon.
--
-- user_has_permission(uuid,text)— takes company_id + permission key, returns bool
--   Defined in 20260618070915. Already has explicit revokes; included here for
--   completeness and to make ARCH-011 the single authoritative statement.

-- REVOKE is idempotent — safe to run even if a grant was never made.

REVOKE ALL ON FUNCTION public.user_company_ids()
  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.user_company_ids()
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.my_permissions(bigint)
  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.my_permissions(bigint)
  TO authenticated;

REVOKE ALL ON FUNCTION public.my_permissions(uuid)
  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.my_permissions(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.user_has_permission(uuid, text)
  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text)
  TO authenticated, service_role;
