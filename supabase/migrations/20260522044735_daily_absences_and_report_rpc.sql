
-- Daily absences table
create table if not exists public.daily_absences (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references public.companies(id) on delete cascade,
    employee_id uuid not null references public.employees(id) on delete cascade,
    date        date not null default current_date,
    reason      text not null check (reason in ('sick', 'personal', 'emergency', 'other')),
    note        text,
    created_at  timestamptz not null default now(),
    unique (employee_id, date)
);

-- RLS
alter table public.daily_absences enable row level security;

-- HR / admin / manager / owner can read all absences for their company
create policy "company_members_read_absences"
on public.daily_absences for select
using (company_id = any(user_company_ids()));

-- Employees can read their own
create policy "employee_read_own_absences"
on public.daily_absences for select
using (employee_id in (
    select id from public.employees
    where company_id = daily_absences.company_id
));

-- SECURITY DEFINER RPC so anon (code-login) employees can insert/upsert
create or replace function public.employee_report_absence(
    p_company_id  uuid,
    p_employee_id uuid,
    p_date        date,
    p_reason      text,
    p_note        text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_emp    public.employees%rowtype;
    v_result public.daily_absences%rowtype;
begin
    -- Validate employee belongs to company
    select * into v_emp
    from public.employees
    where id = p_employee_id and company_id = p_company_id and is_active = true;

    if not found then
        raise exception 'Employee not found in company';
    end if;

    -- Upsert: one absence record per employee per day
    insert into public.daily_absences (company_id, employee_id, date, reason, note)
    values (p_company_id, p_employee_id, p_date, p_reason, p_note)
    on conflict (employee_id, date)
    do update set
        reason = excluded.reason,
        note   = excluded.note
    returning * into v_result;

    return row_to_json(v_result);
end;
$$;

-- Allow anon role to execute the RPC
grant execute on function public.employee_report_absence(uuid, uuid, date, text, text) to anon;
grant execute on function public.employee_report_absence(uuid, uuid, date, text, text) to authenticated;
;
