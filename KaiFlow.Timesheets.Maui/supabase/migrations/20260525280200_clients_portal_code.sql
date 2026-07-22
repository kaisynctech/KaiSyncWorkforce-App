-- Client portal login code (company code + client code, e.g. C280001).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_code text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_company_client_code
  ON public.clients(company_id, upper(client_code))
  WHERE client_code IS NOT NULL;
-- Resolve client for portal sign-in (company code + client code).
CREATE OR REPLACE FUNCTION public.client_resolve_by_code(
  p_company_code text,
  p_client_code  text
)
RETURNS TABLE (
  client_id    uuid,
  company_id   uuid,
  company_code text,
  client_code  text,
  client_name  text,
  email        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cl.id,
    c.id,
    c.code,
    cl.client_code,
    cl.name,
    cl.email
  FROM public.companies c
  JOIN public.clients cl ON cl.company_id = c.id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND cl.client_code IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.client_resolve_by_code(text, text) TO anon, authenticated;
