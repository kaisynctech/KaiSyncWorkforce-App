-- Employee-level PAYE/UIF amounts persist across payslips.

alter table employees
    add column if not exists paye_fixed_amount double precision not null default 0,
    add column if not exists uif_rate_percent double precision,
    add column if not exists uif_fixed_amount double precision not null default 0;
