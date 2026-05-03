set search_path = public;

drop policy if exists p_workforce_media_anon_insert on storage.objects;
create policy p_workforce_media_anon_insert
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'workforce-media'
  and (
    (storage.foldername(name))[1] in ('job_requests', 'incident_reports', 'job_cards', 'client_files')
  )
);

drop policy if exists p_workforce_media_public_select on storage.objects;
create policy p_workforce_media_public_select
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'workforce-media'
);

