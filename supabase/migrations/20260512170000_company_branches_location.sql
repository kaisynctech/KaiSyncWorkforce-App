-- Add geocoded location fields for branch-level sign-in enforcement.
alter table public.company_branches
  add column if not exists address text,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;
