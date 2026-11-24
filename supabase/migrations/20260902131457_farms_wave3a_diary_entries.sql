-- 20260902131457_farms_wave3a_diary_entries
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE TABLE IF NOT EXISTS public.farm_diary_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  land_unit_id    uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  group_id        uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  planting_id     uuid REFERENCES public.farm_plantings(id) ON DELETE SET NULL,
  animal_id       uuid REFERENCES public.farm_animals(id) ON DELETE SET NULL,
  entry_date      date NOT NULL DEFAULT (CURRENT_DATE),
  title           text,
  body            text NOT NULL,
  recorded_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_diary_entries_body_not_blank CHECK (length(trim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_farm_diary_entries_farm ON public.farm_diary_entries (farm_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_farm_diary_entries_company ON public.farm_diary_entries (company_id, entry_date DESC);
COMMENT ON TABLE public.farm_diary_entries IS 'Farm diary / daily ops notes — replaces paper notebooks.';
ALTER TABLE public.farm_diary_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS farm_diary_entries_select ON public.farm_diary_entries;
DROP POLICY IF EXISTS farm_diary_entries_insert ON public.farm_diary_entries;
DROP POLICY IF EXISTS farm_diary_entries_update ON public.farm_diary_entries;
DROP POLICY IF EXISTS farm_diary_entries_delete ON public.farm_diary_entries;
CREATE POLICY farm_diary_entries_select ON public.farm_diary_entries FOR SELECT TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.view'));
CREATE POLICY farm_diary_entries_insert ON public.farm_diary_entries FOR INSERT TO authenticated WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit') AND EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_diary_entries.farm_id AND f.company_id = farm_diary_entries.company_id));
CREATE POLICY farm_diary_entries_update ON public.farm_diary_entries FOR UPDATE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit')) WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
CREATE POLICY farm_diary_entries_delete ON public.farm_diary_entries FOR DELETE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_diary_entries TO authenticated;
REVOKE ALL ON public.farm_diary_entries FROM anon;
