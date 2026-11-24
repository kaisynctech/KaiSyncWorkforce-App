-- Payslip header edits: a rand overtime rate, and typed leave balances.
-- Null means the payslip still shows the calculated figure.

alter table public.employees
  add column if not exists overtime_hourly_rate numeric,
  add column if not exists paid_leave_balance numeric,
  add column if not exists sick_leave_balance numeric;

comment on column public.employees.overtime_hourly_rate is
  'Rand amount per overtime hour shown on the payslip. Null uses the hourly rate times the overtime multiple.';

comment on column public.employees.paid_leave_balance is
  'Paid time off days typed on the payslip. Null uses the calculated annual leave balance.';

comment on column public.employees.sick_leave_balance is
  'Sick time off days typed on the payslip. Null uses the calculated sick leave balance.';

grant select (overtime_hourly_rate, paid_leave_balance, sick_leave_balance)
  on table public.employees to anon, authenticated;
grant update (overtime_hourly_rate, paid_leave_balance, sick_leave_balance)
  on table public.employees to authenticated;
