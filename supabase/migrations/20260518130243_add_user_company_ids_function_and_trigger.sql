
-- ─── Helper function: returns all company UUIDs for the current user ──
CREATE OR REPLACE FUNCTION user_company_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(company_id), '{}')
  FROM company_relationships
  WHERE user_id = auth.uid() AND is_active = true;
$$;

-- ─── Trigger: auto-insert company_relationship when company is created ─
CREATE OR REPLACE FUNCTION fn_auto_company_relationship()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO company_relationships (user_id, company_id, role, is_active)
  VALUES (NEW.owner_user_id, NEW.id, 'owner', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_company_relationship ON companies;
CREATE TRIGGER trg_auto_company_relationship
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION fn_auto_company_relationship();
;
