-- Public releases bucket for KaiFlow installer hosting (website + in-app updates).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'releases',
    'releases',
    true,
    524288000,
    ARRAY['application/octet-stream', 'application/vnd.android.package-archive', 'application/x-msdownload', 'application/zip', 'application/x-zip-compressed']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
-- Public read
DROP POLICY IF EXISTS "Public read releases" ON storage.objects;
CREATE POLICY "Public read releases"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'releases');
-- Service role / authenticated upload (platform ops)
DROP POLICY IF EXISTS "Service upload releases" ON storage.objects;
CREATE POLICY "Service upload releases"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'releases');
DROP POLICY IF EXISTS "Service update releases" ON storage.objects;
CREATE POLICY "Service update releases"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'releases');
