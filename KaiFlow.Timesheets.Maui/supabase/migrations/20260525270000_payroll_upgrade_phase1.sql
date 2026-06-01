
-- Payroll upgrade phase 1: period lock, versioning, YTD, salary history, tax profile, cost center, release notify.

-- Period locks
create table if not exists payroll_period_locks (
    company_id   uuid not null references companies(id) on delete cascade,
    period_start date not null,
    period_end   date not null,
    locked_at    timestamptz not null default now(),
    locked_by    uuid references employees(id),
    primary key (company_id, period_start, period_end)
);

-- Salary history (effective-dated changes)
create table if not exists employee_salary_history (
    id              uuid primary key default gen_random_uuid(),
    employee_id     uuid not null references employees(id) on delete cascade,
    company_id      uuid not null references companies(id) on delete cascade,
    effective_date  date not null,
    monthly_salary  double precision not null default 0,
    hourly_rate     double precision not null default 0,
    daily_rate      double precision not null default 0,
    note            text,
    created_at      timestamptz not null default now()
);

create index if not exists employee_salary_history_emp_date_idx
    on employee_salary_history (employee_id, effective_date desc);

-- Employee tax profile + cost center
alter table employees
    add column if not exists tax_number text,
    add column if not exists paye_reference text,
    add column if not exists medical_aid_member_number text,
    add column if not exists pension_fund_number text,
    add column if not exists tax_directive_number text,
    add column if not exists tax_directive_rate_percent double precision,
    add column if not exists date_of_birth date,
    add column if not exists cost_center text;

-- Payslip extensions
alter table payment_approvals
    add column if not exists version int not null default 1,
    add column if not exists unpaid_leave_days double precision not null default 0,
    add column if not exists ytd_json jsonb,
    add column if not exists branch_label text,
    add column if not exists cost_center text;

-- Notify employee when payslip is released
create or replace function notify_payslip_released()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_emp employees%rowtype;
begin
    if TG_OP = 'UPDATE'
       and NEW.shared_with_employee = true
       and (OLD.shared_with_employee is distinct from true)
    then
        select * into v_emp from employees where id = NEW.employee_id;
        if not found then return NEW; end if;

        insert into app_notifications (
            company_id, audience, recipient_employee_id,
            type, title, body, ref_type, ref_id, dedupe_key, data
        ) values (
            NEW.company_id,
            'employee',
            NEW.employee_id,
            'payslip_released',
            'Payslip ready',
            'Your payslip for ' || to_char(NEW.period_start, 'Mon YYYY') || ' is now available.',
            'payment_approval',
            NEW.id::text,
            'payslip_released:' || NEW.id::text,
            jsonb_build_object(
                'payment_id', NEW.id,
                'period_start', NEW.period_start,
                'period_end', NEW.period_end,
                'net_pay', NEW.net_pay
            )
        )
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
    return NEW;
end;
$$;

drop trigger if exists trg_notify_payslip_released on payment_approvals;
create trigger trg_notify_payslip_released
    after update of shared_with_employee on payment_approvals
    for each row execute function notify_payslip_released();

grant execute on function notify_payslip_released() to authenticated, service_role;
