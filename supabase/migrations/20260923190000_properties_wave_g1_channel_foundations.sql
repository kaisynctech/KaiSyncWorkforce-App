-- ============================================================
-- Properties Wave G1: channel sync foundations
-- Connections + unit mappings + stay external identity + overlap guard.
-- No live OTA API yet — prepares for iCal / channel-manager sync.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Channel connection (per property) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.property_channel_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider              text NOT NULL DEFAULT 'manual'
    CHECK (provider = ANY (ARRAY[
      'manual'::text,
      'ical'::text,
      'channex'::text,
      'siteminder'::text,
      'cloudbeds'::text,
      'other'::text
    ])),
  display_name          text NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  -- Future iCal / CM identifiers (non-secret)
  ical_import_url       text,
  ical_export_token     text,
  external_property_id  text,
  -- Non-secret provider settings only — never store API keys here
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_configured boolean NOT NULL DEFAULT false,
  sync_status           text NOT NULL DEFAULT 'idle'
    CHECK (sync_status = ANY (ARRAY[
      'idle'::text,
      'pending'::text,
      'syncing'::text,
      'ok'::text,
      'error'::text
    ])),
  last_sync_at          timestamptz,
  last_sync_error       text,
  created_by            uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_channel_connections_name_ok CHECK (length(trim(display_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_property_channel_connections_site
  ON public.property_channel_connections (site_id, is_active);

CREATE INDEX IF NOT EXISTS idx_property_channel_connections_company
  ON public.property_channel_connections (company_id);

COMMENT ON TABLE public.property_channel_connections IS
  'B&B channel sync connection per property (iCal / channel manager). Secrets stay out of config jsonb.';
COMMENT ON COLUMN public.property_channel_connections.config IS
  'Non-secret provider settings only. API keys must not be stored here.';
COMMENT ON COLUMN public.property_channel_connections.credentials_configured IS
  'True when secrets are stored in a vault/edge secret — not in this row.';

-- ── Unit ↔ external room mapping ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_unit_channel_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_id         uuid NOT NULL REFERENCES public.property_channel_connections(id) ON DELETE CASCADE,
  unit_id               uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  external_room_id      text NOT NULL,
  external_room_name    text,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_unit_channel_mappings_room_ok CHECK (length(trim(external_room_id)) > 0),
  CONSTRAINT property_unit_channel_mappings_unique_room
    UNIQUE (connection_id, external_room_id),
  CONSTRAINT property_unit_channel_mappings_unique_unit
    UNIQUE (connection_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_property_unit_channel_mappings_unit
  ON public.property_unit_channel_mappings (unit_id)
  WHERE is_active;

COMMENT ON TABLE public.property_unit_channel_mappings IS
  'Maps KaiSync units (rooms) to external channel room identifiers.';

-- ── Stay external identity / sync fields ──────────────────────
ALTER TABLE public.property_stays
  ADD COLUMN IF NOT EXISTS booking_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS channel_connection_id uuid
    REFERENCES public.property_channel_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_booking_id text,
  ADD COLUMN IF NOT EXISTS external_status text,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_payload jsonb;

ALTER TABLE public.property_stays DROP CONSTRAINT IF EXISTS property_stays_booking_source_check;
ALTER TABLE public.property_stays
  ADD CONSTRAINT property_stays_booking_source_check
  CHECK (booking_source = ANY (ARRAY[
    'manual'::text,
    'phone'::text,
    'walk_in'::text,
    'ical'::text,
    'booking_com'::text,
    'airbnb'::text,
    'expedia'::text,
    'channel_manager'::text,
    'other'::text
  ]));

ALTER TABLE public.property_stays DROP CONSTRAINT IF EXISTS property_stays_sync_status_check;
ALTER TABLE public.property_stays
  ADD CONSTRAINT property_stays_sync_status_check
  CHECK (sync_status = ANY (ARRAY[
    'local'::text,
    'pending'::text,
    'synced'::text,
    'error'::text,
    'ignored'::text
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS uq_property_stays_external_booking
  ON public.property_stays (channel_connection_id, external_booking_id)
  WHERE channel_connection_id IS NOT NULL
    AND external_booking_id IS NOT NULL
    AND length(trim(external_booking_id)) > 0;

CREATE INDEX IF NOT EXISTS idx_property_stays_source
  ON public.property_stays (company_id, booking_source);

COMMENT ON COLUMN public.property_stays.booking_source IS
  'Origin of the booking: manual/phone/walk_in or OTA/channel.';
COMMENT ON COLUMN public.property_stays.external_booking_id IS
  'Idempotent external reservation id from iCal UID or channel manager.';
COMMENT ON COLUMN public.property_stays.external_payload IS
  'Optional raw external payload for audit / reprocessing (keep small).';

-- Prevent double-booking active stays on the same unit (checkout day frees room)
ALTER TABLE public.property_stays DROP CONSTRAINT IF EXISTS property_stays_no_overlap;
ALTER TABLE public.property_stays
  ADD CONSTRAINT property_stays_no_overlap
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(check_in_date, check_out_date, '[)') WITH &&
  )
  WHERE (status = ANY (ARRAY['reserved'::text, 'checked_in'::text]));

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.property_channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_unit_channel_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_channel_connections_select ON public.property_channel_connections;
DROP POLICY IF EXISTS property_channel_connections_insert ON public.property_channel_connections;
DROP POLICY IF EXISTS property_channel_connections_update ON public.property_channel_connections;
DROP POLICY IF EXISTS property_channel_connections_delete ON public.property_channel_connections;

CREATE POLICY property_channel_connections_select ON public.property_channel_connections
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.view')
  );

CREATE POLICY property_channel_connections_insert ON public.property_channel_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
    AND EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = property_channel_connections.site_id
        AND s.company_id = property_channel_connections.company_id
    )
  );

CREATE POLICY property_channel_connections_update ON public.property_channel_connections
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

CREATE POLICY property_channel_connections_delete ON public.property_channel_connections
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

DROP POLICY IF EXISTS property_unit_channel_mappings_select ON public.property_unit_channel_mappings;
DROP POLICY IF EXISTS property_unit_channel_mappings_insert ON public.property_unit_channel_mappings;
DROP POLICY IF EXISTS property_unit_channel_mappings_update ON public.property_unit_channel_mappings;
DROP POLICY IF EXISTS property_unit_channel_mappings_delete ON public.property_unit_channel_mappings;

CREATE POLICY property_unit_channel_mappings_select ON public.property_unit_channel_mappings
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.view')
  );

CREATE POLICY property_unit_channel_mappings_insert ON public.property_unit_channel_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
    AND EXISTS (
      SELECT 1 FROM public.property_channel_connections c
      WHERE c.id = property_unit_channel_mappings.connection_id
        AND c.company_id = property_unit_channel_mappings.company_id
    )
    AND EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = property_unit_channel_mappings.unit_id
        AND u.company_id = property_unit_channel_mappings.company_id
    )
  );

CREATE POLICY property_unit_channel_mappings_update ON public.property_unit_channel_mappings
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

CREATE POLICY property_unit_channel_mappings_delete ON public.property_unit_channel_mappings
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_channel_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_unit_channel_mappings TO authenticated;
REVOKE ALL ON public.property_channel_connections FROM anon;
REVOKE ALL ON public.property_unit_channel_mappings FROM anon;

NOTIFY pgrst, 'reload schema';
