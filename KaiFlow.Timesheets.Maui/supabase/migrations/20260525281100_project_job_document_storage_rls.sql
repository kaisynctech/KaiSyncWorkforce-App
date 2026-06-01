-- Allow HR uploads to project/job document folders in workforce-media + align payment RLS.

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
    'employee_documents',
    'project_documents',
    'job_documents',
    'job_photos'
  )
);

DROP POLICY IF EXISTS "project_client_payments_all" ON public.project_client_payments;
CREATE POLICY project_client_payments_company ON public.project_client_payments
  FOR ALL TO authenticated
  USING (company_id IN (SELECT unnest(public.user_company_ids())))
  WITH CHECK (company_id IN (SELECT unnest(public.user_company_ids())));
