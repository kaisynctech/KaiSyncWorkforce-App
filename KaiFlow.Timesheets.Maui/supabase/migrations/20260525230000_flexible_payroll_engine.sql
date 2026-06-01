
-- Flexible payroll: itemized breakdown, pay basis, HR overrides, employee statutory fields.

alter table employees
    add column if not exists pay_basis text,
    add column if not exists paye_rate_percent double precision,
    add column if not exists uif_exempt boolean not null default false;

alter table payment_approvals
    add column if not exists pay_basis text,
    add column if not exists base_salary double precision not null default 0,
    add column if not exists pay_full_base_salary boolean not null default false,
    add column if not exists waive_penalties boolean not null default false,
    add column if not exists manual_paye_override double precision,
    add column if not exists manual_adjustment double precision not null default 0,
    add column if not exists adjustment_note text,
    add column if not exists earnings_breakdown jsonb,
    add column if not exists deductions_breakdown jsonb;

-- leave_days may already be integer; allow fractional half-days
alter table payment_approvals
    alter column leave_days type double precision using leave_days::double precision;
