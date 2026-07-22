-- ARCH-005 Migration 3: Platform admin backup health RPC
CREATE OR REPLACE FUNCTION public.admin_get_backup_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin boolean;
    v_result jsonb;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.platform_admins
        WHERE auth_user_id = auth.uid()
          AND is_active = true
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'ARCH-005: admin_get_backup_health requires platform admin role';
    END IF;

    SELECT jsonb_build_object(
        'export_jobs_total_7d',
            (SELECT COUNT(*) FROM public.company_export_jobs
             WHERE created_at >= now() - interval '7 days'),
        'export_jobs_completed_7d',
            (SELECT COUNT(*) FROM public.company_export_jobs
             WHERE created_at >= now() - interval '7 days'
               AND status = 'completed'),
        'export_jobs_failed_7d',
            (SELECT COUNT(*) FROM public.company_export_jobs
             WHERE created_at >= now() - interval '7 days'
               AND status = 'failed'),
        'last_completed_export',
            (SELECT jsonb_build_object(
                'company_id', company_id,
                'completed_at', completed_at,
                'record_counts', record_counts
             )
             FROM public.company_export_jobs
             WHERE status = 'completed'
             ORDER BY completed_at DESC
             LIMIT 1),
        'metadata_snapshots_total_7d',
            (SELECT COUNT(*) FROM public.company_backups
             WHERE created_at >= now() - interval '7 days'),
        'generated_at', now()
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_backup_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_backup_health() FROM anon;
REVOKE ALL ON FUNCTION public.admin_get_backup_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_backup_health() TO service_role;

COMMENT ON FUNCTION public.admin_get_backup_health IS
    'Platform admin only. Returns export job health statistics for the last 7 days. PITR status must be checked in Supabase Dashboard.';
