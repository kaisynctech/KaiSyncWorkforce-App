-- Optional selling price per inventory unit (for sales / margin reporting).
ALTER TABLE IF EXISTS public.inventory_items
  ADD COLUMN IF NOT EXISTS selling_price numeric(12,2);

COMMENT ON COLUMN public.inventory_items.selling_price
  IS 'Optional sell price per unit in company currency when stock is sold.';

-- Work teams: HR-managed groups of employees for assignments and visibility.
CREATE TABLE IF NOT EXISTS public.work_teams (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_teams_company_name
  ON public.work_teams(company_id, name);

CREATE TABLE IF NOT EXISTS public.work_team_members (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES public.work_teams(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_work_team_member UNIQUE (team_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_work_team_members_company ON public.work_team_members(company_id);
CREATE INDEX IF NOT EXISTS idx_work_team_members_employee ON public.work_team_members(employee_id);

ALTER TABLE public.work_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_team_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_work_teams_hr_company') THEN
    CREATE POLICY p_work_teams_hr_company ON public.work_teams
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_work_team_members_hr_company') THEN
    CREATE POLICY p_work_team_members_hr_company ON public.work_team_members
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;

-- Logged-in worker: see own team memberships (for "My teams" in the employee app).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_work_team_members_self_read') THEN
    CREATE POLICY p_work_team_members_self_read ON public.work_team_members
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = work_team_members.employee_id
            AND e.profile_id IS NOT NULL
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_work_teams_member_read') THEN
    CREATE POLICY p_work_teams_member_read ON public.work_teams
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.work_team_members m
          JOIN public.employees e ON e.id = m.employee_id
          WHERE m.team_id = work_teams.id
            AND e.profile_id IS NOT NULL
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
