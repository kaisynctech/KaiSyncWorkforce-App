-- W1 / F7: the owner (or HR admin) employee created at company sign-up was saved as employment_type
-- 'part-time'. New sign-ups now create the row as 'permanent'. Applied 22 Oct 2026 by replacing only
-- that literal inside self_register_company (grants and everything else unchanged). Existing companies'
-- rows are not changed.
DO $$
DECLARE v_def text := pg_get_functiondef('public.self_register_company'::regproc);
BEGIN
  IF position('''part-time'', CASE WHEN v_safe_role' in v_def) > 0 THEN
    EXECUTE replace(v_def, '''part-time'', CASE WHEN v_safe_role', '''permanent'', CASE WHEN v_safe_role');
  END IF;
END $$;
