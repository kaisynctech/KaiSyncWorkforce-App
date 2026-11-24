-- 20260902131638_farms_wave3a_health_events
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE TABLE IF NOT EXISTS public.farm_health_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id             uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  group_id            uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  animal_id           uuid REFERENCES public.farm_animals(id) ON DELETE SET NULL,
  event_type          text NOT NULL CHECK (event_type IN ('illness', 'injury', 'treatment', 'vaccine', 'vet_visit', 'observation', 'quarantine', 'recovery')),
  event_date          date NOT NULL DEFAULT (CURRENT_DATE),
  product_label       text,
  inventory_item_id   uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  dosage              text,
  withdrawal_until    date,
  notes               text,
  recorded_by         uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_farm_health_events_farm ON public.farm_health_events (farm_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_farm_health_events_group ON public.farm_health_events (group_id, event_date DESC) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_farm_health_events_company ON public.farm_health_events (company_id, event_type);
COMMENT ON TABLE public.farm_health_events IS 'Livestock health / medicine book events (not inventory SKUs).';
ALTER TABLE public.farm_health_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS farm_health_events_select ON public.farm_health_events;
DROP POLICY IF EXISTS farm_health_events_insert ON public.farm_health_events;
DROP POLICY IF EXISTS farm_health_events_update ON public.farm_health_events;
DROP POLICY IF EXISTS farm_health_events_delete ON public.farm_health_events;
CREATE POLICY farm_health_events_select ON public.farm_health_events FOR SELECT TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.view'));
CREATE POLICY farm_health_events_insert ON public.farm_health_events FOR INSERT TO authenticated WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit') AND EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_health_events.farm_id AND f.company_id = farm_health_events.company_id));
CREATE POLICY farm_health_events_update ON public.farm_health_events FOR UPDATE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit')) WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
CREATE POLICY farm_health_events_delete ON public.farm_health_events FOR DELETE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_health_events TO authenticated;
REVOKE ALL ON public.farm_health_events FROM anon;
