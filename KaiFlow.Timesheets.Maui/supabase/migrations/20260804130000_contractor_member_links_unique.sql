-- Unique team member link per contractor (prevent double-link).
-- Deduplicate first (keep oldest row) for safety on non-empty tenants.

DELETE FROM public.contractor_member_links a
USING public.contractor_member_links b
WHERE a.contractor_id = b.contractor_id
  AND a.employee_id = b.employee_id
  AND a.created_at > b.created_at;

DELETE FROM public.contractor_member_links a
USING public.contractor_member_links b
WHERE a.contractor_id = b.contractor_id
  AND a.employee_id = b.employee_id
  AND a.id > b.id
  AND a.created_at = b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_member_links_contractor_employee
  ON public.contractor_member_links (contractor_id, employee_id);

COMMENT ON INDEX public.uq_contractor_member_links_contractor_employee IS
  'One employee may be linked to a contractor at most once.';
