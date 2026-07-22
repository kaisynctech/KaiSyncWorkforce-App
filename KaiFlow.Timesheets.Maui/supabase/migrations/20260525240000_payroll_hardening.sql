-- Payroll hardening: termination, fixed deductions, bonus, policy snapshot, audit, duplicate guard.

alter table employees
    add column if not exists termination_date date,
    add column if not exists medical_aid_deduction double precision not null default 0,
    add column if not exists pension_deduction double precision not null default 0,
    add column if not exists union_deduction double precision not null default 0;
alter table payment_approvals
    add column if not exists policy_snapshot jsonb,
    add column if not exists bonus_amount double precision not null default 0,
    add column if not exists bonus_note text,
    add column if not exists audit_log jsonb not null default '[]'::jsonb;
-- Prevent duplicate active payslips for the same employee and period.
create unique index if not exists payment_approvals_employee_period_active_uidx
    on payment_approvals (employee_id, period_start, period_end)
    where status not in ('rejected');
