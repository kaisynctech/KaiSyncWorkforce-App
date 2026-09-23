-- ============================================================
-- Properties Wave E: scale helpers
-- Aggregated unit counts per site (avoids loading every unit row).
-- ============================================================

CREATE OR REPLACE FUNCTION public.hr_site_unit_counts(p_company_id uuid)
RETURNS TABLE (
  site_id uuid,
  total bigint,
  occupied bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    u.site_id,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE u.is_occupied IS TRUE)::bigint AS occupied
  FROM public.units u
  WHERE u.company_id = p_company_id
    AND p_company_id = ANY (public.user_company_ids())
  GROUP BY u.site_id;
$$;

COMMENT ON FUNCTION public.hr_site_unit_counts(uuid) IS
  'Per-site unit totals and occupied counts for property portfolio KPIs (RLS via INVOKER + company check).';

GRANT EXECUTE ON FUNCTION public.hr_site_unit_counts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.hr_site_unit_counts(uuid) FROM anon;

CREATE INDEX IF NOT EXISTS idx_units_company_site_occupied
  ON public.units (company_id, site_id, is_occupied);

CREATE INDEX IF NOT EXISTS idx_finance_invoices_rent_arrears
  ON public.finance_invoices (company_id, due_date)
  WHERE invoice_type = 'rent'
    AND balance_due > 0
    AND status IS DISTINCT FROM 'draft'
    AND status IS DISTINCT FROM 'cancelled'
    AND status IS DISTINCT FROM 'voided'
    AND status IS DISTINCT FROM 'paid';
