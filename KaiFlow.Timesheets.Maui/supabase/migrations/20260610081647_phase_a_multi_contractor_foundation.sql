-- Migration: 20260610081647_phase_a_multi_contractor_foundation
-- Multi-contractor foundation - compliance pack, documents, incidents for portal
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_get_compliance_pack(p_contractor_id uuid, p_company_id uuid)
 RETURNS TABLE(document_type text, requirement text, sort_order integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT  i.document_type,
            i.requirement,
            i.sort_order
    FROM    public.contractors c
    JOIN    public.contractor_compliance_packs p
               ON  p.id          = c.compliance_pack_id
              AND  p.is_archived = false
    JOIN    public.contractor_compliance_pack_items i
               ON  i.pack_id = p.id
    WHERE   c.id         = p_contractor_id
      AND   c.company_id = p_company_id
    ORDER   BY CASE WHEN i.requirement = 'required' THEN 0 ELSE 1 END,
               i.sort_order;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_get_compliance_pack(p_contractor_id uuid, p_company_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_get_compliance_pack(p_contractor_id uuid, p_company_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_compliance_pack(p_contractor_id uuid, p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_compliance_pack(p_contractor_id uuid, p_company_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_get_documents(p_contractor_id uuid, p_company_id uuid)
 RETURNS SETOF contractor_documents
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT *
    FROM   public.contractor_documents
    WHERE  contractor_id = p_contractor_id
      AND  company_id    = p_company_id
      AND  is_current    = true
    ORDER  BY created_at DESC;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_get_documents(p_contractor_id uuid, p_company_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_get_documents(p_contractor_id uuid, p_company_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_documents(p_contractor_id uuid, p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_documents(p_contractor_id uuid, p_company_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_insert_document(p_contractor_id uuid, p_company_id uuid, p_document_type text, p_document_name text, p_file_url text, p_storage_path text, p_expiry_date date DEFAULT NULL::date, p_old_document_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_id          uuid;
    v_contractor_name text;
    v_action          text;
BEGIN
    IF p_old_document_id IS NOT NULL THEN
        UPDATE public.contractor_documents
           SET is_current  = false,
               updated_at  = now()
         WHERE id            = p_old_document_id
           AND contractor_id = p_contractor_id
           AND company_id    = p_company_id;
        v_action := 'replaced';
    ELSE
        v_action := 'uploaded';
    END IF;

    INSERT INTO public.contractor_documents (
        company_id,      contractor_id,   document_type,   document_name,
        file_url,        storage_path,    expiry_date,
        approval_status, is_required,     is_current,      uploaded_by_role,
        created_at,      updated_at
    ) VALUES (
        p_company_id,    p_contractor_id, p_document_type, p_document_name,
        p_file_url,      p_storage_path,  p_expiry_date,
        'pending',        false,           true,            'contractor_portal',
        now(),           now()
    )
    RETURNING id INTO v_new_id;

    SELECT name INTO v_contractor_name
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id;

    v_contractor_name := coalesce(v_contractor_name, 'Contractor');

    PERFORM public.notify_hr_contractor_document(
        p_company_id, p_contractor_id, v_new_id,
        v_contractor_name, p_document_name, p_document_type, v_action
    );

    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id, NULL,
        'ContractorPortal',
        'contractor_document_' || v_action,
        'info',
        jsonb_build_object(
            'contractor_id',   p_contractor_id,
            'contractor_name', v_contractor_name,
            'document_id',     v_new_id,
            'document_type',   p_document_type,
            'document_name',   p_document_name,
            'action',          v_action
        ),
        now()
    );

    RETURN v_new_id;
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_insert_document(p_contractor_id uuid, p_company_id uuid, p_document_type text, p_document_name text, p_file_url text, p_storage_path text, p_expiry_date date DEFAULT NULL::date, p_old_document_id uuid DEFAULT NULL::uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_insert_document(p_contractor_id uuid, p_company_id uuid, p_document_type text, p_document_name text, p_file_url text, p_storage_path text, p_expiry_date date DEFAULT NULL::date, p_old_document_id uuid DEFAULT NULL::uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_insert_document(p_contractor_id uuid, p_company_id uuid, p_document_type text, p_document_name text, p_file_url text, p_storage_path text, p_expiry_date date DEFAULT NULL::date, p_old_document_id uuid DEFAULT NULL::uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_insert_document(p_contractor_id uuid, p_company_id uuid, p_document_type text, p_document_name text, p_file_url text, p_storage_path text, p_expiry_date date DEFAULT NULL::date, p_old_document_id uuid DEFAULT NULL::uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_create_incident(p_company_code text, p_contractor_code text, p_job_id uuid, p_description text, p_severity text DEFAULT 'low'::text, p_reported_by_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_row public.incident_reports%ROWTYPE;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  INSERT INTO public.incident_reports (
    id, company_id, job_id, contractor_id, description, severity,
    reported_by_name, is_closed, created_at
  ) VALUES (
    gen_random_uuid(), v_ct.company_id, p_job_id, v_ct.id, trim(p_description),
    coalesce(nullif(trim(p_severity), ''), 'low'),
    p_reported_by_name, false, now()
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_create_incident(p_company_code text, p_contractor_code text, p_job_id uuid, p_description text, p_severity text DEFAULT 'low'::text, p_reported_by_name text DEFAULT NULL::text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_create_incident(p_company_code text, p_contractor_code text, p_job_id uuid, p_description text, p_severity text DEFAULT 'low'::text, p_reported_by_name text DEFAULT NULL::text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_create_incident(p_company_code text, p_contractor_code text, p_job_id uuid, p_description text, p_severity text DEFAULT 'low'::text, p_reported_by_name text DEFAULT NULL::text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_create_incident(p_company_code text, p_contractor_code text, p_job_id uuid, p_description text, p_severity text DEFAULT 'low'::text, p_reported_by_name text DEFAULT NULL::text) TO service_role;

