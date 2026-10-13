-- vat_applies was granted UPDATE only. Selecting it returns
-- "permission denied for table employees" because employee reads are column grants.

grant select (vat_applies) on table public.employees to anon, authenticated;
