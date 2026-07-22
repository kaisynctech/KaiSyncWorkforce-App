-- Optional company-matrix flags: let Owner enable "see all projects/jobs" for managers (or any role).
-- Skipped when company_role_permissions is not present (uuid-only deployments).
set search_path = public;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'company_role_permissions'
  ) THEN
    INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
    SELECT c.id, v.role, v.permission_key, v.allowed
    FROM public.companies c
    CROSS JOIN (
      VALUES
        ('employee',  'projects.view_all', false),
        ('manager',   'projects.view_all', false),
        ('admin',     'projects.view_all', true),
        ('hr_admin',  'projects.view_all', true),
        ('employee',  'jobs.view_all',     false),
        ('manager',   'jobs.view_all',     false),
        ('admin',     'jobs.view_all',     true),
        ('hr_admin',  'jobs.view_all',     true)
    ) AS v(role, permission_key, allowed)
    ON CONFLICT (company_id, role, permission_key) DO NOTHING;
  END IF;
END $$;
