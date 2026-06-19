-- Phase 2B.3c: Contractor Portal Compliance Dashboard — database access layer.
--
-- The contractor portal authenticates via company_code + contractor_code (no JWT).
-- Direct PostgREST queries require the `authenticated` role, so we need SECURITY DEFINER
-- RPC functions that the anon role can call while enforcing contractor_id + company_id filters.
--
-- Functions added:
--   contractor_portal_get_documents         — read contractor's uploaded documents
--   contractor_portal_get_compliance_pack   — read pack items assigned to contractor
--   contractor_portal_insert_document       — insert new document record (portal upload)
--
-- Storage policy added:
--   p_workforce_media_contractor_portal_insert — allow anon to upload to contractor_documents/


-- ── 1. Read contractor documents ─────────────────────────────────────────────
--
-- Returns all current (is_current=true) documents for the contractor.
-- SECURITY DEFINER bypasses RLS; the function enforces contractor_id + company_id.

CREATE OR REPLACE FUNCTION public.contractor_portal_get_documents(
    p_contractor_id uuid,
    p_company_id    uuid
)
RETURNS SETOF public.contractor_documents
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM   public.contractor_documents
    WHERE  contractor_id = p_contractor_id
      AND  company_id    = p_company_id
      AND  is_current    = true
    ORDER  BY created_at DESC;
$$;


-- ── 2. Read compliance pack items assigned to contractor ──────────────────────
--
-- Joins contractors → contractor_compliance_packs → contractor_compliance_pack_items.
-- Returns an empty set when no pack is assigned (compliance_pack_id IS NULL).
-- Required rows ordered first; within each group ordered by sort_order.

CREATE OR REPLACE FUNCTION public.contractor_portal_get_compliance_pack(
    p_contractor_id uuid,
    p_company_id    uuid
)
RETURNS TABLE (
    document_type text,
    requirement   text,
    sort_order    int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT  i.document_type,
            i.requirement,
            i.sort_order
    FROM    public.contractors c
    JOIN    public.contractor_compliance_packs p
               ON  p.id          = c.compliance_pack_id
              AND  p.is_archived = false
    JOIN    public.contractor_compliance_pack_items i
               ON  i.pack_id = p.id
    WHERE   c.id         = p_contractor_id
      AND   c.company_id = p_company_id
    ORDER   BY CASE WHEN i.requirement = 'required' THEN 0 ELSE 1 END,
               i.sort_order;
$$;


-- ── 3. Insert a portal-uploaded document record ───────────────────────────────
--
-- Called after the MAUI app uploads the file bytes to Supabase Storage.
-- Portal documents start as approval_status = 'pending' (HR must approve).
-- When p_old_document_id is supplied the old document is superseded (is_current = false).
-- Returns the new document's UUID.

CREATE OR REPLACE FUNCTION public.contractor_portal_insert_document(
    p_contractor_id   uuid,
    p_company_id      uuid,
    p_document_type   text,
    p_document_name   text,
    p_file_url        text,
    p_storage_path    text,
    p_expiry_date     date DEFAULT NULL,
    p_old_document_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_id uuid;
BEGIN
    -- Supersede old document if this is a replacement upload.
    -- The contractor_id check prevents a contractor superseding another's document.
    IF p_old_document_id IS NOT NULL THEN
        UPDATE public.contractor_documents
           SET is_current  = false,
               updated_at  = now()
         WHERE id            = p_old_document_id
           AND contractor_id = p_contractor_id
           AND company_id    = p_company_id;
    END IF;

    INSERT INTO public.contractor_documents (
        company_id,     contractor_id,    document_type,    document_name,
        file_url,       storage_path,     expiry_date,
        approval_status, is_required,     is_current,       uploaded_by_role,
        created_at,     updated_at
    )
    VALUES (
        p_company_id,    p_contractor_id,  p_document_type,  p_document_name,
        p_file_url,      p_storage_path,   p_expiry_date,
        'pending',        false,            true,             'contractor_portal',
        now(),           now()
    )
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;


-- ── 4. Grant execute to anon + authenticated ──────────────────────────────────

GRANT EXECUTE ON FUNCTION public.contractor_portal_get_documents       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_compliance_pack TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_insert_document     TO anon, authenticated;


-- ── 5. Storage: allow anon to upload contractor documents ─────────────────────
--
-- The portal authenticates via company/contractor codes (no JWT), so the Supabase
-- Storage client runs as anon. This policy gates uploads to the contractor_documents/
-- subfolder only. The app enforces contractor_id/company_id at the DB insert level
-- via the SECURITY DEFINER RPC above.

DROP POLICY IF EXISTS p_workforce_media_contractor_portal_insert ON storage.objects;
CREATE POLICY p_workforce_media_contractor_portal_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] = 'contractor_documents'
  );

-- Allow anon to read files in contractor_documents (needed to generate signed URLs).
DROP POLICY IF EXISTS p_workforce_media_contractor_portal_select ON storage.objects;
CREATE POLICY p_workforce_media_contractor_portal_select ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] = 'contractor_documents'
  );


-- ── 6. Comments ───────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.contractor_portal_get_documents IS
  'Contractor portal: returns all current documents for a contractor. '
  'SECURITY DEFINER — bypasses RLS while enforcing contractor_id + company_id. '
  'Phase 2B.3c.';

COMMENT ON FUNCTION public.contractor_portal_get_compliance_pack IS
  'Contractor portal: returns pack items assigned to a contractor. '
  'Returns empty when no compliance pack is assigned. Phase 2B.3c.';

COMMENT ON FUNCTION public.contractor_portal_insert_document IS
  'Contractor portal: inserts a new pending document record after file upload. '
  'Supersedes the old document when p_old_document_id is provided. Phase 2B.3c.';
