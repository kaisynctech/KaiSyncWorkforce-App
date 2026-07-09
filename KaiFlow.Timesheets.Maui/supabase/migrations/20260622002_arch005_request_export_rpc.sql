-- ARCH-005 Migration 2: request_company_export RPC
CREATE OR REPLACE FUNCTION public.request_company_export(
    p_company_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
    v_job_id uuid;
BEGIN
    v_role := get_my_role(p_company_id);
    IF v_role NOT IN ('owner', 'hr') THEN
        RAISE EXCEPTION 'ARCH-005: export requires owner or hr role';
    END IF;

    INSERT INTO public.company_export_jobs (
        company_id,
        requested_by,
        status,
        created_at
    ) VALUES (
        p_company_id,
        auth.uid(),
        'processing',
        now()
    ) RETURNING id INTO v_job_id;

    BEGIN
        PERFORM write_audit_event(
            p_company_id := p_company_id,
            p_event_type := 'data_export_requested',
            p_table_name := 'company_export_jobs',
            p_record_id  := v_job_id::text,
            p_payload    := jsonb_build_object('job_id', v_job_id)
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_company_export(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_company_export(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_company_export(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_company_export(uuid) TO service_role;
