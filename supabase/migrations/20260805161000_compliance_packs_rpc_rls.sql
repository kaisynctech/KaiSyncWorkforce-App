-- ============================================================
-- Compliance packs: fix pack_code upsert, auth RPCs, permission RLS
-- ============================================================

CREATE OR REPLACE FUNCTION public._slug_pack_code(p_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN coalesce(nullif(trim(regexp_replace(lower(replace(coalesce(p_name, ''), ' ', '_')), '[^a-z0-9_]', '', 'g')), ''), '') = ''
      THEN 'pack_' || extract(epoch from now())::bigint::text
    ELSE trim(both '_' from regexp_replace(lower(replace(coalesce(p_name, ''), ' ', '_')), '[^a-z0-9_]', '', 'g'))
  END;
$$;

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
SET row_security = off
AS $$
DECLARE
  v_pack_id uuid := coalesce(p_pack_id, gen_random_uuid());
  v_item jsonb;
  v_code text;
  v_is_new boolean := (p_pack_id IS NULL);
  v_base text;
  v_try text;
  v_n int := 0;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  IF trim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'NAME_REQUIRED';
  END IF;

  IF NOT v_is_new THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.contractor_compliance_packs
      WHERE id = v_pack_id AND company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'PACK_NOT_FOUND';
    END IF;

    UPDATE public.contractor_compliance_packs
    SET name = trim(p_name),
        description = p_description,
        updated_at = now()
    WHERE id = v_pack_id AND company_id = p_company_id;
  ELSE
    v_base := public._slug_pack_code(p_name);
    v_try := v_base;
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.contractor_compliance_packs
        WHERE company_id = p_company_id AND pack_code = v_try
      );
      v_n := v_n + 1;
      v_try := v_base || '_' || v_n::text;
    END LOOP;
    v_code := v_try;

    INSERT INTO public.contractor_compliance_packs (
      id, company_id, name, pack_code, description, is_default, is_archived
    ) VALUES (
      v_pack_id, p_company_id, trim(p_name), v_code, p_description, false, false
    );
  END IF;

  DELETE FROM public.contractor_compliance_pack_items WHERE pack_id = v_pack_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    IF coalesce(v_item->>'document_type', '') <> ''
       AND coalesce(v_item->>'requirement', '') IN ('required', 'recommended') THEN
      INSERT INTO public.contractor_compliance_pack_items (pack_id, document_type, requirement)
      VALUES (v_pack_id, v_item->>'document_type', v_item->>'requirement');
    END IF;
  END LOOP;

  RETURN v_pack_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_set_default_compliance_pack(
  p_company_id uuid,
  p_pack_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  IF NOT EXISTS (
    SELECT 1 FROM public.contractor_compliance_packs
    WHERE id = p_pack_id AND company_id = p_company_id AND coalesce(is_archived, false) = false
  ) THEN
    RAISE EXCEPTION 'PACK_NOT_FOUND';
  END IF;

  UPDATE public.contractor_compliance_packs
  SET is_default = false, updated_at = now()
  WHERE company_id = p_company_id AND is_default = true;

  UPDATE public.contractor_compliance_packs
  SET is_default = true, updated_at = now()
  WHERE id = p_pack_id AND company_id = p_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_archive_compliance_pack(
  p_company_id uuid,
  p_pack_id uuid,
  p_archived boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  UPDATE public.contractor_compliance_packs
  SET is_archived = p_archived,
      is_default = CASE WHEN p_archived THEN false ELSE is_default END,
      updated_at = now()
  WHERE id = p_pack_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACK_NOT_FOUND';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_upsert_compliance_pack(uuid, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_upsert_compliance_pack(uuid, uuid, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_upsert_compliance_pack(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_upsert_compliance_pack(uuid, uuid, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.hr_set_default_compliance_pack(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_set_default_compliance_pack(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_set_default_compliance_pack(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_set_default_compliance_pack(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.hr_archive_compliance_pack(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_archive_compliance_pack(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_archive_compliance_pack(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_archive_compliance_pack(uuid, uuid, boolean) TO service_role;

-- Packs RLS
DROP POLICY IF EXISTS p_compliance_packs_authenticated ON public.contractor_compliance_packs;
DROP POLICY IF EXISTS contractor_compliance_packs_select ON public.contractor_compliance_packs;
DROP POLICY IF EXISTS contractor_compliance_packs_insert ON public.contractor_compliance_packs;
DROP POLICY IF EXISTS contractor_compliance_packs_update ON public.contractor_compliance_packs;
DROP POLICY IF EXISTS contractor_compliance_packs_delete ON public.contractor_compliance_packs;

CREATE POLICY contractor_compliance_packs_select ON public.contractor_compliance_packs
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'contractors.view')
      OR public.user_has_permission(company_id, 'suppliers.view')
    )
  );

CREATE POLICY contractor_compliance_packs_insert ON public.contractor_compliance_packs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'contractors.edit')
  );

CREATE POLICY contractor_compliance_packs_update ON public.contractor_compliance_packs
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'contractors.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'contractors.edit')
  );

CREATE POLICY contractor_compliance_packs_delete ON public.contractor_compliance_packs
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'contractors.edit')
  );

-- Items RLS
DROP POLICY IF EXISTS p_compliance_pack_items_authenticated ON public.contractor_compliance_pack_items;
DROP POLICY IF EXISTS contractor_compliance_pack_items_select ON public.contractor_compliance_pack_items;
DROP POLICY IF EXISTS contractor_compliance_pack_items_write ON public.contractor_compliance_pack_items;

CREATE POLICY contractor_compliance_pack_items_select ON public.contractor_compliance_pack_items
  FOR SELECT TO authenticated
  USING (
    pack_id IN (
      SELECT p.id FROM public.contractor_compliance_packs p
      WHERE p.company_id = ANY (public.user_company_ids())
        AND (
          public.user_has_permission(p.company_id, 'contractors.view')
          OR public.user_has_permission(p.company_id, 'suppliers.view')
        )
    )
  );

CREATE POLICY contractor_compliance_pack_items_write ON public.contractor_compliance_pack_items
  FOR ALL TO authenticated
  USING (
    pack_id IN (
      SELECT p.id FROM public.contractor_compliance_packs p
      WHERE p.company_id = ANY (public.user_company_ids())
        AND public.user_has_permission(p.company_id, 'contractors.edit')
    )
  )
  WITH CHECK (
    pack_id IN (
      SELECT p.id FROM public.contractor_compliance_packs p
      WHERE p.company_id = ANY (public.user_company_ids())
        AND public.user_has_permission(p.company_id, 'contractors.edit')
    )
  );

REVOKE ALL ON TABLE public.contractor_compliance_packs FROM anon;
REVOKE ALL ON TABLE public.contractor_compliance_pack_items FROM anon;
