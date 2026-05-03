-- ============================================================
-- Client model rework
-- - clients.client_type: 'individual' | 'company' | 'property'
-- - ensure_client_primary_site(): idempotent get-or-create site
--   (used so property-type clients can have units even when the
--   user hasn't manually set up a site).
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_type text DEFAULT 'company';

UPDATE public.clients SET client_type = 'company' WHERE client_type IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_client_type_chk') THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_client_type_chk
      CHECK (client_type IN ('individual','company','property'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_type ON public.clients(client_type);

CREATE OR REPLACE FUNCTION public.ensure_client_primary_site(p_client_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id    bigint;
  v_company_id bigint;
  v_client     record;
BEGIN
  SELECT id INTO v_site_id
  FROM   sites
  WHERE  client_id = p_client_id
  ORDER  BY id ASC
  LIMIT  1;

  IF v_site_id IS NOT NULL THEN
    RETURN v_site_id;
  END IF;

  SELECT id, company_id, name, address
  INTO   v_client
  FROM   clients
  WHERE  id = p_client_id;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client % not found', p_client_id;
  END IF;

  INSERT INTO sites (company_id, client_id, name, address)
  VALUES (v_client.company_id, v_client.id, v_client.name, v_client.address)
  RETURNING id INTO v_site_id;

  RETURN v_site_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_client_primary_site(bigint) TO authenticated;
