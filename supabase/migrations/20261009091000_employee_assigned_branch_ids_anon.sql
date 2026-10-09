-- Code sign-in uses the anon key plus a worker session token.
-- The same access check as the overview bundle applies inside the function.
GRANT EXECUTE ON FUNCTION public.employee_assigned_branch_ids(uuid, uuid, text) TO anon;
