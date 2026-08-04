-- Harden contractor multi-tenant RLS and restore portal code expiry on resolve.
--
-- 1) contractor_compliance_packs / _items were USING (true) — cross-tenant R/W.
-- 2) contractor_quote_items was USING (true) — cross-tenant quote line leakage.
-- 3) contractor_resolve_by_code (billing migration) required portal_enabled but
--    dropped ARCH-003 contractor_code_expires_at enforcement.

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS: compliance packs
-- ═══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_compliance_packs_authenticated ON public.contractor_compliance_packs;
CREATE POLICY p_compliance_packs_authenticated
  ON public.contractor_compliance_packs
  FOR ALL
  TO authenticated
  USING (company_id = ANY(public.user_company_ids()))
  WITH CHECK (company_id = ANY(public.user_company_ids()));

DROP POLICY IF EXISTS p_compliance_pack_items_authenticated ON public.contractor_compliance_pack_items;
CREATE POLICY p_compliance_pack_items_authenticated
  ON public.contractor_compliance_pack_items
  FOR ALL
  TO authenticated
  USING (
    pack_id IN (
      SELECT p.id
      FROM public.contractor_compliance_packs p
      WHERE p.company_id = ANY(public.user_company_ids())
    )
  )
  WITH CHECK (
    pack_id IN (
      SELECT p.id
      FROM public.contractor_compliance_packs p
      WHERE p.company_id = ANY(public.user_company_ids())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS: quote line items
-- ═══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_contractor_quote_items_authenticated ON public.contractor_quote_items;
CREATE POLICY p_contractor_quote_items_authenticated
  ON public.contractor_quote_items
  FOR ALL
  TO authenticated
  USING (company_id = ANY(public.user_company_ids()))
  WITH CHECK (company_id = ANY(public.user_company_ids()));

CREATE INDEX IF NOT EXISTS idx_contractor_quote_items_company
  ON public.contractor_quote_items (company_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Portal resolve: portal_enabled + code expiry
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.contractor_resolve_by_code(
  p_company_code    text,
  p_contractor_code text
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contractor RECORD;
BEGIN
  SELECT
    ct.id                        AS contractor_id,
    ct.company_id,
    ct.name                      AS contractor_name,
    ct.contractor_code,
    ct.contractor_code_expires_at,
    c.code                       AS company_code
  INTO v_contractor
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true
    AND coalesce(ct.portal_enabled, false) = true
    AND ct.contractor_code IS NOT NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN '[]'::json;
  END IF;

  IF v_contractor.contractor_code_expires_at IS NOT NULL
     AND v_contractor.contractor_code_expires_at < now() THEN
    RAISE EXCEPTION 'PORTAL_CODE_EXPIRED: contractor portal code has expired'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN json_build_array(json_build_object(
    'contractor_id',   v_contractor.contractor_id,
    'company_id',      v_contractor.company_id,
    'contractor_name', v_contractor.contractor_name,
    'contractor_code', v_contractor.contractor_code,
    'company_code',    v_contractor.company_code
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.contractor_resolve_by_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contractor_resolve_by_code(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.contractor_resolve_by_code(text, text) IS
  'Portal login resolve. Requires active contractor, portal_enabled, and non-expired contractor_code.';
