-- Keep saas_company_subscriptions.current_employee_count in sync with active employees.

CREATE OR REPLACE FUNCTION public.sync_saas_employee_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_company_id := OLD.company_id;
    ELSE
        v_company_id := NEW.company_id;
    END IF;

    UPDATE public.saas_company_subscriptions
    SET current_employee_count = (
            SELECT count(*)::integer
            FROM public.employees e
            WHERE e.company_id = v_company_id
              AND coalesce(e.is_active, true)
        ),
        updated_at = now()
    WHERE company_id = v_company_id;

    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_saas_employee_count ON public.employees;
CREATE TRIGGER trg_sync_saas_employee_count
    AFTER INSERT OR UPDATE OF is_active, company_id OR DELETE
    ON public.employees
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_saas_employee_count();
-- Backfill counts for existing subscriptions.
UPDATE public.saas_company_subscriptions s
SET current_employee_count = (
        SELECT count(*)::integer
        FROM public.employees e
        WHERE e.company_id = s.company_id
          AND coalesce(e.is_active, true)
    ),
    updated_at = now();
