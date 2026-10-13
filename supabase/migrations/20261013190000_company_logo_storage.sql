-- Company logos upload into workforce-media/company_logos/{company_id}/.
-- Authenticated HR can insert and replace a logo for their own company.

create policy p_workforce_media_hr_company_logo_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'workforce-media'
    and (storage.foldername(name))[1] = 'company_logos'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and public.role_is_hr_or_above(public.get_my_role(((storage.foldername(name))[2])::uuid))
  );

create policy p_workforce_media_hr_company_logo_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'workforce-media'
    and (storage.foldername(name))[1] = 'company_logos'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and public.role_is_hr_or_above(public.get_my_role(((storage.foldername(name))[2])::uuid))
  )
  with check (
    bucket_id = 'workforce-media'
    and (storage.foldername(name))[1] = 'company_logos'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and public.role_is_hr_or_above(public.get_my_role(((storage.foldername(name))[2])::uuid))
  );
