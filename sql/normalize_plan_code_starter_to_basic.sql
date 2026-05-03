set search_path = public;

update public.companies
set plan_code = 'basic'
where lower(coalesce(plan_code, '')) = 'starter';
