-- Security fix (approved 30 Oct 2026): report snapshot functions answered for any company id,
-- including without sign-in. Each now starts with an office check for that company
-- (owner, admin, HR or manager), the same check Linked companies uses.
CREATE OR REPLACE FUNCTION public._reports_office(p_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN PERFORM public._company_link_office(p_company_id); END $$;

DO $$
DECLARE r record; v_def text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'hr_get_%snapshot' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position('_reports_office' in v_def) > 0 THEN CONTINUE; END IF;
    EXECUTE regexp_replace(v_def, '\mBEGIN\M', E'BEGIN\n  PERFORM public._reports_office(p_company_id);', '');
  END LOOP;
END $$;

-- Permissions (run separately):
-- REVOKE ALL ON FUNCTION public._reports_office(uuid) FROM PUBLIC, anon, authenticated;
-- hr_get_*_snapshot: REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated.
