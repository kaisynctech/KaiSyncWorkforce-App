-- Allow employee-side (anon) media uploads for job requests.
-- Scoped to the workforce-media bucket and known app folders.

set search_path = public;

insert into storage.buckets (id, name, public)
values ('workforce-media', 'workforce-media', true)
on conflict (id) do update set public = true;

drop policy if exists p_workforce_media_anon_insert on storage.objects;
create policy p_workforce_media_anon_insert
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'workforce-media'
  and (
    (storage.foldername(name))[1] in ('job_requests', 'incident_reports', 'job_cards')
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
