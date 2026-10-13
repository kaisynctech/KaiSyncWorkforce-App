-- Amounts typed on the payslip (regular, overtime, bonus, incentive, refund,
-- uif, paye, loan deduction, loan balance, unpaid leave).
-- Gross, net, and total deductions are derived from these amounts.

alter table public.payment_approvals
  add column if not exists payslip_lines jsonb;
