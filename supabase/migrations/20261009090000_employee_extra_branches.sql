-- A person can work at more than one branch. employees.branch_id stays the home branch.
-- Extra branches live here. Clock-in accepts the home branch or any extra branch.

CREATE TABLE IF NOT EXISTS public.employee_branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_branch_assignments_unique UNIQUE (employee_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_branch_assignments_employee
  ON public.employee_branch_assignments (employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_branch_assignments_branch
  ON public.employee_branch_assignments (company_id, branch_id);

CREATE OR REPLACE FUNCTION public.employee_branch_assignment_company_ok()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    JOIN public.branches b ON b.id = NEW.branch_id
    WHERE e.id = NEW.employee_id
      AND e.company_id = NEW.company_id
      AND b.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Branch must belong to the same company as the employee'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_branch_assignment_company_ok() FROM PUBLIC;

DROP TRIGGER IF EXISTS employee_branch_assignments_company_ok ON public.employee_branch_assignments;
CREATE TRIGGER employee_branch_assignments_company_ok
  BEFORE INSERT OR UPDATE ON public.employee_branch_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.employee_branch_assignment_company_ok();

ALTER TABLE public.employee_branch_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_branch_assignments_select ON public.employee_branch_assignments;
CREATE POLICY employee_branch_assignments_select
  ON public.employee_branch_assignments
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT e.company_id
      FROM public.employees e
      WHERE e.user_id = auth.uid()
        AND e.is_active = true
    )
  );

DROP POLICY IF EXISTS employee_branch_assignments_write ON public.employee_branch_assignments;
CREATE POLICY employee_branch_assignments_write
  ON public.employee_branch_assignments
  FOR ALL
  TO authenticated
  USING (
    company_id IN (
      SELECT e.company_id
      FROM public.employees e
      WHERE e.user_id = auth.uid()
        AND e.is_active = true
        AND e.access_level = ANY (ARRAY['owner', 'admin', 'hr', 'hr_admin', 'manager'])
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT e.company_id
      FROM public.employees e
      WHERE e.user_id = auth.uid()
        AND e.is_active = true
        AND e.access_level = ANY (ARRAY['owner', 'admin', 'hr', 'hr_admin', 'manager'])
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_branch_assignments TO authenticated;
REVOKE ALL ON public.employee_branch_assignments FROM anon;

CREATE OR REPLACE FUNCTION public.employee_assigned_branch_ids(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  RETURN (
    SELECT COALESCE(array_agg(DISTINCT b.branch_id), ARRAY[]::uuid[])
    FROM (
      SELECT e.branch_id
      FROM public.employees e
      WHERE e.id = p_employee_id
        AND e.company_id = p_company_id
        AND e.branch_id IS NOT NULL
      UNION
      SELECT a.branch_id
      FROM public.employee_branch_assignments a
      WHERE a.employee_id = p_employee_id
        AND a.company_id = p_company_id
    ) b
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_assigned_branch_ids(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_assigned_branch_ids(uuid, uuid, text) TO authenticated;

-- Directory branch filter includes extra branches, not only the home branch.
DO $$
DECLARE
  src text;
BEGIN
  SELECT pg_get_functiondef(
    'public.list_employee_directory(uuid,text,text,text,text,uuid,integer,integer)'::regprocedure
  ) INTO src;

  src := replace(
    src,
    'AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)',
    'AND (p_branch_id IS NULL OR e.branch_id = p_branch_id OR EXISTS (SELECT 1 FROM public.employee_branch_assignments a WHERE a.employee_id = e.id AND a.branch_id = p_branch_id))'
  );
  EXECUTE src;
END $$;

-- Anna Magaya works at Polokwane (home) and Pretoria.
INSERT INTO public.employee_branch_assignments (company_id, employee_id, branch_id)
SELECT e.company_id, e.id, pretoria.id
FROM public.employees e
JOIN public.branches home
  ON home.id = e.branch_id
 AND home.name = 'Polokwane'
JOIN public.branches pretoria
  ON pretoria.company_id = e.company_id
 AND pretoria.name = 'Pretoria'
WHERE e.name = 'Anna'
  AND e.surname = 'Magaya'
ON CONFLICT (employee_id, branch_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
