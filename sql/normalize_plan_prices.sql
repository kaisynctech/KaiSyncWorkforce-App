set search_path = public;

update public.companies
set plan_price_zar = case
  when lower(plan_code) = 'basic' then 700
  when lower(plan_code) = 'pro' then 1000
  when lower(plan_code) = 'premium' then 1500
  when lower(plan_code) = 'free_trial' then 0
  else plan_price_zar
end
where lower(plan_code) in ('basic', 'pro', 'premium', 'free_trial');
