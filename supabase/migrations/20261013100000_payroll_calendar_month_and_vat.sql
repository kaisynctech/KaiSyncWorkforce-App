-- One pending payslip per employee per calendar month, and a VAT flag on the person.
-- VAT does not change PAYE or UIF.

alter table public.employees
  add column if not exists vat_applies boolean not null default false;

comment on column public.employees.vat_applies is
  'Whether VAT applies to this person. Does not change PAYE or UIF.';

grant update (vat_applies) on table public.employees to authenticated;

with ranked as (
  select
    id,
    row_number() over (
      partition by employee_id, date_trunc('month', period_start)
      order by created_at desc nulls last, id desc
    ) as rn
  from public.payment_approvals
  where status = 'pending'
)
delete from public.payment_approvals p
using ranked r
where p.id = r.id
  and r.rn > 1;

update public.payment_approvals
set
  period_start = date_trunc('month', period_start)::date,
  period_end = (date_trunc('month', period_start) + interval '1 month' - interval '1 day')::date
where status = 'pending'
  and (
    period_start is distinct from date_trunc('month', period_start)::date
    or period_end is distinct from (date_trunc('month', period_start) + interval '1 month' - interval '1 day')::date
  );
