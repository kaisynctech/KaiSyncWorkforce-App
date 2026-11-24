-- The monthly rate belongs on the billing cards. The line list is only what is due.

CREATE OR REPLACE FUNCTION public.company_get_billing_summary(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id required';
  END IF;

  IF NOT public.platform_is_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.company_id = p_company_id
        AND e.user_id = auth.uid()
        AND coalesce(e.is_active, true)
        AND lower(coalesce(e.access_level, '')) IN ('owner', 'hr', 'hr_admin', 'admin')
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  RETURN public.kaiflow_sync_company_subscription(p_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.company_get_billing_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_get_billing_summary(uuid) TO authenticated;
