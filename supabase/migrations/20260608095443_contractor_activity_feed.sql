-- Phase 2C: Contractor Activity Feed.
--
-- 1. Adds a GIN-friendly expression index so lookups by contractor_id in
--    app_events.meta are efficient.
-- 2. Adds a SECURITY DEFINER RPC the HR app calls to read contractor-specific
--    events. Using a function rather than direct PostgREST query guarantees
--    the meta->>contractor_id filter is always applied correctly regardless
--    of SDK version.

-- ── Index ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_app_events_contractor_id
  ON public.app_events ( (meta->>'contractor_id') )
  WHERE meta IS NOT NULL;


-- ── RPC ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_contractor_activity_feed(
    p_company_id    uuid,
    p_contractor_id uuid,
    p_limit         int DEFAULT 200
)
RETURNS SETOF public.app_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM   public.app_events
    WHERE  company_id = p_company_id
      AND  meta @> jsonb_build_object('contractor_id', p_contractor_id::text)
      AND  level IN ('info', 'warning')   -- exclude raw errors from feed
    ORDER  BY created_at DESC
    LIMIT  p_limit;
$$;

-- HR authenticated users only (not portal anon)
GRANT EXECUTE ON FUNCTION public.get_contractor_activity_feed TO authenticated;

COMMENT ON FUNCTION public.get_contractor_activity_feed IS
    'Returns contractor-specific app_events ordered newest-first. '
    'Used by HR Contractor Details → Activity tab. Phase 2C.';;
