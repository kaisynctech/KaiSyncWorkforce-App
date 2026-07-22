-- Pay full monthly salary for mid-month joiners (per employee) + payslip release day in company settings.

alter table employees
    add column if not exists pay_full_monthly_salary boolean not null default false;
