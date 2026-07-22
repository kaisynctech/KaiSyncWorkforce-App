
CREATE OR REPLACE FUNCTION public.hr_upsert_compliance_pack(
  p_company_id uuid,
  p_pack_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack_id uuid := COALESCE(p_pack_id, gen_random_uuid());
  v_item jsonb;
BEGIN
  INSERT INTO contractor_compliance_packs (id, company_id, name, description, is_default)
  VALUES (v_pack_id, p_company_id, p_name, p_description, false)
  ON CONFLICT (id) DO UPDATE
    SET name        = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at  = now();

  -- Replace all items for this pack
  DELETE FROM contractor_compliance_pack_items WHERE pack_id = v_pack_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO contractor_compliance_pack_items (pack_id, document_type, requirement)
    VALUES (v_pack_id, v_item->>'document_type', v_item->>'requirement');
  END LOOP;

  RETURN v_pack_id;
END;
$$;
;
