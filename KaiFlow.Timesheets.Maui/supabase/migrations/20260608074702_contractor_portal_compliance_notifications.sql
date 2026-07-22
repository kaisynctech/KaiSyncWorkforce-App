CREATE OR REPLACE FUNCTION public.notify_hr_contractor_document(
    p_company_id      uuid,
    p_contractor_id   uuid,
    p_doc_id          uuid,
    p_contractor_name text,
    p_document_name   text,
    p_document_type   text,
    p_action          text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT e.user_id  AS auth_user_id,
                        e.id       AS employee_id
        FROM   public.employees e
        WHERE  e.company_id  = p_company_id
          AND  e.is_active   = true
          AND  e.user_id     IS NOT NULL
          AND  e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
    LOOP
        INSERT INTO public.app_notifications (
            company_id, audience,
            recipient_auth_user_id, recipient_employee_id,
            type, title, body,
            ref_type, ref_id, dedupe_key, data
        ) VALUES (
            p_company_id, 'hr',
            r.auth_user_id, r.employee_id,
            'contractor_document_pending',
            'Compliance Document Pending Review',
            coalesce(nullif(trim(p_contractor_name), ''), 'Contractor')
                || ' '  || p_action || ': '
                || coalesce(nullif(trim(p_document_name), ''), 'a document')
                || ' — awaiting HR approval.',
            'contractor_document',
            p_doc_id::text,
            'contractor_doc_pending:' || p_doc_id::text || ':' || r.employee_id::text,
            jsonb_build_object(
                'contractor_id',   p_contractor_id,
                'contractor_name', p_contractor_name,
                'document_type',   p_document_type,
                'document_name',   p_document_name,
                'action',          p_action
            )
        )
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_hr_contractor_document TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.contractor_portal_insert_document(
    p_contractor_id   uuid,
    p_company_id      uuid,
    p_document_type   text,
    p_document_name   text,
    p_file_url        text,
    p_storage_path    text,
    p_expiry_date     date DEFAULT NULL,
    p_old_document_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_insert_document TO anon, authenticated;

COMMENT ON FUNCTION public.notify_hr_contractor_document IS
    'Notifies HR/admin employees when a contractor portal document is uploaded or replaced. Phase 2B.3c.';
COMMENT ON FUNCTION public.contractor_portal_insert_document IS
    'Contractor portal document insert with HR notifications + activity log. Phase 2B.3c.';;
