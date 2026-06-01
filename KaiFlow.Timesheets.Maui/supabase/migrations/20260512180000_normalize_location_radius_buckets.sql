-- Normalize legacy radius values to supported buckets: 200m, 500m, 1000m.

-- 1) Company-level dispatch settings JSONB:
--    - job_site_radius_m
--    - branch_sign_in_radius_m
with company_settings as (
  select
    id,
    dispatch_settings,
    case
      when coalesce(nullif(dispatch_settings->>'job_site_radius_m', ''), '500')::numeric <= 350 then 200
      when coalesce(nullif(dispatch_settings->>'job_site_radius_m', ''), '500')::numeric <= 750 then 500
      else 1000
    end as normalized_job_radius,
    case
      when coalesce(nullif(dispatch_settings->>'branch_sign_in_radius_m', ''), '500')::numeric <= 350 then 200
      when coalesce(nullif(dispatch_settings->>'branch_sign_in_radius_m', ''), '500')::numeric <= 750 then 500
      else 1000
    end as normalized_branch_radius
  from public.companies
)
update public.companies c
set dispatch_settings =
  jsonb_set(
    jsonb_set(
      coalesce(c.dispatch_settings, '{}'::jsonb),
      '{job_site_radius_m}',
      to_jsonb(cs.normalized_job_radius::numeric),
      true
    ),
    '{branch_sign_in_radius_m}',
    to_jsonb(cs.normalized_branch_radius::numeric),
    true
  )
from company_settings cs
where c.id = cs.id;
-- 2) Per-job override radius column:
update public.jobs
set site_radius_m = case
  when site_radius_m is null then null
  when site_radius_m <= 350 then 200
  when site_radius_m <= 750 then 500
  else 1000
end;
