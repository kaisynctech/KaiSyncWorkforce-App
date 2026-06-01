-- Per-job site-radius override for check-in enforcement.
-- `inherit` defers to company dispatch settings.
alter table public.jobs
  add column if not exists site_radius_mode text not null default 'inherit',
  add column if not exists site_radius_m numeric(10,2);
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_site_radius_mode_chk'
  ) then
    alter table public.jobs
      add constraint jobs_site_radius_mode_chk
      check (site_radius_mode in ('inherit', 'enforce', 'disable'));
  end if;
end
$$;
