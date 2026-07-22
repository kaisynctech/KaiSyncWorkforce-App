-- Phase 2B.3c: Contractor Portal Compliance Dashboard — database access layer.

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

GRANT EXECUTE ON FUNCTION public.contractor_portal_get_documents       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_compliance_pack TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_insert_document     TO anon, authenticated;

DROP POLICY IF EXISTS p_workforce_media_contractor_portal_insert ON storage.objects;
CREATE POLICY p_workforce_media_contractor_portal_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] = 'contractor_documents'
  );

DROP POLICY IF EXISTS p_workforce_media_contractor_portal_select ON storage.objects;
CREATE POLICY p_workforce_media_contractor_portal_select ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] = 'contractor_documents'
  );;
