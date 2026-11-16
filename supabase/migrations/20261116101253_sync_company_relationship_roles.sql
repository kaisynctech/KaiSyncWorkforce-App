-- One-time repair: company_relationships.role drifted from employees.access_level
-- for some owners (trigger only fires on UPDATE OF access_level).
-- Keep the sync function and re-assert the trigger.

CREATE OR REPLACE FUNCTION public.sync_employee_role_to_relationship()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    UPDATE public.company_relationships
    SET role = NEW.access_level
    WHERE user_id = NEW.user_id
      AND company_id = NEW.company_id
      AND role IS DISTINCT FROM NEW.access_level;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_employee_role ON public.employees;
CREATE TRIGGER trg_sync_employee_role
  AFTER UPDATE OF access_level ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_employee_role_to_relationship();

UPDATE public.company_relationships cr
SET role = e.access_level
FROM public.employees e
WHERE e.user_id = cr.user_id
  AND e.company_id = cr.company_id
  AND e.is_active = true
  AND e.user_id IS NOT NULL
  AND e.access_level IS NOT NULL
  AND cr.role IS DISTINCT FROM e.access_level;
