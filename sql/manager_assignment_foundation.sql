-- Manager assignment foundation
-- Adds per-employee direct manager mapping to HR users (same tenant/company).

set search_path = public;

alter table public.employees
  add column if not exists manager_user_id uuid null references auth.users(id) on delete set null;

create index if not exists idx_employees_company_manager
  on public.employees(company_id, manager_user_id);
