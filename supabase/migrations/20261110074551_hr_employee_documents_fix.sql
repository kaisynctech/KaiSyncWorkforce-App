-- Fix HR employee_documents access for canonical role 'hr' and register RPC.
-- Legacy policies only allowed owner/hr_admin/admin/manager (missing 'hr').

DROP POLICY IF EXISTS "hr_select_employee_documents" ON public.employee_documents;
DROP POLICY IF EXISTS "hr_insert_employee_documents" ON public.employee_documents;
DROP POLICY IF EXISTS "hr_delete_employee_documents" ON public.employee_documents;

CREATE POLICY "hr_select_employee_documents" ON public.employee_documents
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.role_is_hr_or_above(public.get_my_role(company_id))
      OR public.get_my_role(company_id) = 'manager'
    )
  );

CREATE POLICY "hr_insert_employee_documents" ON public.employee_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND (
      public.role_is_hr_or_above(public.get_my_role(company_id))
      OR public.get_my_role(company_id) = 'manager'
    )
  );

CREATE POLICY "hr_delete_employee_documents" ON public.employee_documents
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.role_is_hr_or_above(public.get_my_role(company_id))
      OR public.get_my_role(company_id) = 'manager'
    )
  );

-- Register an already-uploaded workforce-media path for an employee document.
CREATE OR REPLACE FUNCTION public.hr_register_employee_document(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_document_type text,
  p_document_name text,
  p_file_url      text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_role text;
  v_path text := trim(both '/' from trim(coalesce(p_file_url, '')));
  v_doc  public.employee_documents%ROWTYPE;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids())) THEN
    RAISE EXCEPTION 'Company not accessible' USING ERRCODE = '42501';
  END IF;

  v_role := public.get_my_role(p_company_id);
  IF NOT (public.role_is_hr_or_above(v_role) OR v_role = 'manager') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: HR or manager required to upload employee documents'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.employees e
  WHERE e.id = p_employee_id
    AND e.company_id = p_company_id
    AND e.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found' USING ERRCODE = 'P0002';
  END IF;

  IF nullif(trim(coalesce(p_document_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'document_type_required';
  END IF;
  IF nullif(trim(coalesce(p_document_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'document_name_required';
  END IF;
  IF v_path = '' OR split_part(v_path, '/', 1) <> 'employee_documents' THEN
    RAISE EXCEPTION 'file_url must be under employee_documents/';
  END IF;

  INSERT INTO public.employee_documents (
    company_id, employee_id, document_type, document_name, file_url, uploaded_by_role
  ) VALUES (
    p_company_id,
    p_employee_id,
    trim(p_document_type),
    trim(p_document_name),
    v_path,
    CASE
      WHEN v_role IN ('owner', 'admin', 'hr', 'hr_admin', 'manager') THEN v_role
      ELSE 'hr'
    END
  )
  RETURNING * INTO v_doc;

  RETURN row_to_json(v_doc);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_register_employee_document(uuid, uuid, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.hr_register_employee_document(uuid, uuid, text, text, text) IS
  'HR/manager registers an uploaded employee_documents storage path on employee_documents.';
