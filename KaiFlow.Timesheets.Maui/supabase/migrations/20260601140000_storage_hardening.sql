-- ════════════════════════════════════════════════════════════════════════════
-- STORAGE HARDENING — private workforce-media + upload grants
--
-- Removes blanket anon INSERT on workforce-media. Workers obtain short-lived
-- upload grants via validated RPCs; HR uses authenticated JWT storage policies.
-- Reads use signed URLs (HR JWT client-side) or grant-validated anon SELECT.
--
-- Rollback: docs/security/storage-hardening-rollback.md
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = public;

-- ─── 1. Private bucket ───────────────────────────────────────────────────────
UPDATE storage.buckets
SET public = false
WHERE id = 'workforce-media';

INSERT INTO storage.buckets (id, name, public)
VALUES ('workforce-media', 'workforce-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ─── 2. Upload grant ledger (validated RPC → storage INSERT) ─────────────────
CREATE TABLE IF NOT EXISTS public.media_upload_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  employee_id  uuid,
  storage_path text NOT NULL,
  purpose      text NOT NULL DEFAULT 'attachment',
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_media_upload_grants_path UNIQUE (storage_path)
);

ALTER TABLE public.media_upload_grants ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_media_upload_grants_expires
  ON public.media_upload_grants (expires_at)
  WHERE consumed_at IS NULL;

-- ─── 3. Replace permissive anon storage policies ─────────────────────────────
DROP POLICY IF EXISTS p_workforce_media_anon_insert ON storage.objects;

CREATE POLICY p_workforce_media_hr_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'workforce-media'
  AND (storage.foldername(name))[1] IN (
    'job_requests',
    'incident_reports',
    'job_cards',
    'leave_attachments',
    'employee_documents',
    'project_documents',
    'job_documents',
    'job_photos'
  )
);

CREATE POLICY p_workforce_media_worker_insert ON storage.objects
FOR INSERT TO anon
WITH CHECK (
  bucket_id = 'workforce-media'
  AND EXISTS (
    SELECT 1
    FROM public.media_upload_grants g
    WHERE g.storage_path = name
      AND g.consumed_at IS NULL
      AND g.expires_at > now()
  )
);

CREATE POLICY p_workforce_media_hr_select ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'workforce-media');

CREATE POLICY p_workforce_media_worker_select ON storage.objects
FOR SELECT TO anon
USING (
  bucket_id = 'workforce-media'
  AND EXISTS (
    SELECT 1
    FROM public.media_upload_grants g
    WHERE g.storage_path = name
      AND g.expires_at > now()
  )
);

-- ─── 4. Worker upload grant RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_prepare_media_upload(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_storage_path  text,
  p_purpose       text DEFAULT 'attachment',
  p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_folder text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF v_path = '' THEN
    RAISE EXCEPTION 'storage_path_required';
  END IF;

  v_folder := split_part(v_path, '/', 1);
  IF v_folder NOT IN (
    'leave_attachments', 'incident_reports', 'job_photos',
    'employee_documents', 'job_documents', 'job_cards'
  ) THEN
    RAISE EXCEPTION 'folder_not_allowed';
  END IF;

  INSERT INTO public.media_upload_grants (
    company_id, employee_id, storage_path, purpose, expires_at
  ) VALUES (
    p_company_id, p_employee_id, v_path, coalesce(nullif(trim(p_purpose), ''), 'attachment'),
    now() + interval '15 minutes'
  )
  ON CONFLICT (storage_path) DO UPDATE SET
    company_id  = EXCLUDED.company_id,
    employee_id = EXCLUDED.employee_id,
    purpose     = EXCLUDED.purpose,
    expires_at  = EXCLUDED.expires_at,
    consumed_at = NULL;

  RETURN json_build_object(
    'storage_path', v_path,
    'expires_at', (now() + interval '15 minutes')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_consume_media_upload(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_storage_path  text,
  p_session_token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  UPDATE public.media_upload_grants
  SET consumed_at = now()
  WHERE storage_path = trim(both '/' from trim(p_storage_path))
    AND company_id = p_company_id
    AND employee_id = p_employee_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_prepare_media_upload(uuid, uuid, text, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_consume_media_upload(uuid, uuid, text, text)
  TO anon, authenticated;

-- ─── 5. Cleanup expired grants (optional cron) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_expired_media_upload_grants()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.media_upload_grants
    WHERE expires_at < now() - interval '1 day'
    RETURNING 1
  )
  SELECT count(*)::integer FROM d;
$$;

GRANT EXECUTE ON FUNCTION public.prune_expired_media_upload_grants() TO authenticated;
