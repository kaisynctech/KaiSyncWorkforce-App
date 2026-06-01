-- Contractor parent entities + member linkage

CREATE TABLE IF NOT EXISTS public.contractors (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contractor_type text NOT NULL DEFAULT 'individual',
  display_name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contractors_type_chk'
      AND conrelid = 'public.contractors'::regclass
  ) THEN
    ALTER TABLE public.contractors
      ADD CONSTRAINT contractors_type_chk
      CHECK (contractor_type IN ('company','individual'));
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contractors_status_chk'
      AND conrelid = 'public.contractors'::regclass
  ) THEN
    ALTER TABLE public.contractors
      ADD CONSTRAINT contractors_status_chk
      CHECK (status IN ('active','inactive'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_contractors_company_status
  ON public.contractors(company_id, status, display_name);
CREATE TABLE IF NOT EXISTS public.contractor_members (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contractor_id bigint NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role_label text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_member_once
  ON public.contractor_members(contractor_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_contractor_members_company
  ON public.contractor_members(company_id, contractor_id);
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_contractors_hr_company') THEN
    CREATE POLICY p_contractors_hr_company ON public.contractors
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_contractor_members_hr_company') THEN
    CREATE POLICY p_contractor_members_hr_company ON public.contractor_members
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;
