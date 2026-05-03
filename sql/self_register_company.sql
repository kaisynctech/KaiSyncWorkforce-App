-- Self-service company registration
-- Run once in Supabase SQL editor.
--
-- What it does:
-- 1) Creates helper sequence for company code generation.
-- 2) Creates RPC self_register_company(p_company_name text).
-- 3) Maps auth.uid() to hr_users for the newly created company.
--
-- Notes:
-- - Expects `public.companies` and `public.hr_users` to already exist.
-- - Uses 2-digit company codes (01-99). You can change LPAD width if needed.

set search_path = public;

create sequence if not exists public.company_code_seq;

do $$
declare
  v_start bigint;
begin
  select coalesce(max(company_code::int), 0) + 1
  into v_start
  from public.companies
  where company_code ~ '^[0-9]+$';

  if v_start < 1 then
    v_start := 1;
  end if;

  perform setval('public.company_code_seq', v_start, false);
exception
  when others then
    -- if companies table empty or sequence already in sync, ignore
    null;
end;
$$;

drop function if exists public.self_register_company(text);
create or replace function public.self_register_company(
  p_company_name text
)
returns table (
  company_id bigint,
  company_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_code text;
  v_company_id bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'You must be signed in to register a company.';
  end if;

  if p_company_name is null or btrim(p_company_name) = '' then
    raise exception 'Company name is required.';
  end if;

  if exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = v_uid
      and h.is_active = true
  ) then
    raise exception 'This HR account is already mapped to a company.';
  end if;

  loop
    v_code := lpad(nextval('public.company_code_seq')::text, 2, '0');
    begin
      insert into public.companies (name, company_code, plan_code, trial_started_at)
      values (btrim(p_company_name), v_code, 'free_trial', now())
      returning id into v_company_id;
      exit;
    exception
      when unique_violation then
        -- Rare race condition, try next sequence value.
        continue;
    end;
  end loop;

  insert into public.hr_users (
    auth_user_id,
    company_id,
    role,
    is_active
  ) values (
    v_uid,
    v_company_id,
    'hr_admin',
    true
  );

  return query
  select v_company_id, v_code;
end;
$$;

grant execute on function public.self_register_company(text) to authenticated;
