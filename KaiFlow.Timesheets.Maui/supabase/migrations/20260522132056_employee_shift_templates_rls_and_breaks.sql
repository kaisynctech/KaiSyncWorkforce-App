
-- 1. Enable RLS (idempotent)
alter table employee_shift_templates enable row level security;

-- 2. Drop old policy if it exists, then recreate
drop policy if exists "templates_company_all" on employee_shift_templates;

create policy "templates_company_all"
on employee_shift_templates
for all
to authenticated
using  (company_id = any(user_company_ids()))
with check (company_id = any(user_company_ids()));

-- 3. Add breaks JSONB column (multiple break slots)
alter table employee_shift_templates
add column if not exists breaks jsonb not null default '[]'::jsonb;

-- 4. Refresh the get_employee_shift_templates RPC so it returns the new breaks column
create or replace function get_employee_shift_templates(p_company_id uuid)
returns json language plpgsql security definer set search_path = public
as $$
begin
  return (
    select coalesce(
      json_agg(row_to_json(t) order by t.name),
      '[]'::json
    )
    from employee_shift_templates t
    where t.company_id = p_company_id
  );
end;
$$;

grant execute on function get_employee_shift_templates(uuid) to anon, authenticated;
;
