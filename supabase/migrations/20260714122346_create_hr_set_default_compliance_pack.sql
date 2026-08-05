
CREATE OR REPLACE FUNCTION public.hr_set_default_compliance_pack(
  p_company_id uuid,
  p_pack_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE contractor_compliance_packs
  SET is_default = false
  WHERE company_id = p_company_id AND is_default = true;

  UPDATE contractor_compliance_packs
  SET is_default = true
  WHERE id = p_pack_id AND company_id = p_company_id;
END;
$$;
;
