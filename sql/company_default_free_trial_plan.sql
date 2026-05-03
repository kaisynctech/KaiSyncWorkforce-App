set search_path = public;

alter table public.companies
  alter column plan_code set default 'free_trial';

update public.companies
set plan_code = 'free_trial'
where plan_code is null
   or btrim(plan_code) = ''
   or lower(plan_code) = 'starter';
