
alter table payment_approvals
    add column if not exists working_days   integer not null default 0,
    add column if not exists leave_days     integer not null default 0,
    add column if not exists absent_days    integer not null default 0,
    add column if not exists regular_pay   double precision not null default 0,
    add column if not exists overtime_pay  double precision not null default 0;
;
