-- Allow employee document uploads to workforce-media storage + document update support.

DROP POLICY IF EXISTS p_workforce_media_anon_insert ON storage.objects;
CREATE POLICY p_workforce_media_anon_insert
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'workforce-media'
  AND (storage.foldername(name))[1] IN (
    'job_requests',
    'incident_reports',
    'job_cards',
    'leave_attachments',
    'employee_documents'
  )
);
DROP POLICY IF EXISTS hr_update_employee_documents ON public.employee_documents;
CREATE POLICY hr_update_employee_documents ON public.employee_documents
FOR UPDATE
USING (
  company_id IN (
    SELECT company_id FROM employees
    WHERE user_id = auth.uid()
    AND access_level IN ('owner', 'hr_admin', 'admin', 'manager')
  )
)
WITH CHECK (
  company_id IN (
    SELECT company_id FROM employees
    WHERE user_id = auth.uid()
    AND access_level IN ('owner', 'hr_admin', 'admin', 'manager')
  )
);
CREATE OR REPLACE FUNCTION public.employee_update_document(
  p_document_id   uuid,
  p_company_id    uuid,
  p_employee_id   uuid,
  p_document_type text,
  p_document_name text,
  p_file_url      text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.employee_documents%rowtype;
BEGIN
  PERFORM 1 FROM employees
  WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  UPDATE public.employee_documents
  SET document_type    = p_document_type,
      document_name    = p_document_name,
      file_url         = p_file_url,
      uploaded_by_role = 'employee'
  WHERE id = p_document_id
    AND employee_id = p_employee_id
    AND company_id = p_company_id
  RETURNING * INTO v_doc;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  RETURN row_to_json(v_doc);
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_update_document(uuid, uuid, uuid, text, text, text) TO anon, authenticated;
