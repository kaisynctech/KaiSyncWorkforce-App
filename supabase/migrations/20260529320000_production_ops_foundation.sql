-- Production operations: app versioning, feature flags, company settings, backups, error monitoring.

-- ═══════════════════════════════════════════════════════════════════════════════
-- app_versions — release catalogue (platform-managed)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.app_versions (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version                  text NOT NULL,
    build_number             integer NOT NULL DEFAULT 0,
    release_date             timestamptz NOT NULL DEFAULT now(),
    release_notes            text,
    minimum_required_version text,
    download_url             text,
    download_url_android     text,
    download_url_ios         text,
    download_url_windows     text,
    is_mandatory             boolean NOT NULL DEFAULT false,
    is_active                boolean NOT NULL DEFAULT true,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_versions_version_build_unique UNIQUE (version, build_number)
);
CREATE INDEX IF NOT EXISTS idx_app_versions_release_date ON public.app_versions (release_date DESC);
CREATE INDEX IF NOT EXISTS idx_app_versions_active ON public.app_versions (is_active) WHERE is_active = true;
-- Seed launch version
INSERT INTO public.app_versions (
    version, build_number, release_notes, minimum_required_version,
    is_mandatory, is_active
) VALUES (
    '1.0.0', 1,
    'KaiFlow Workforce launch — attendance, payroll, finance, reports, and full HR suite.',
    '1.0.0', false, true
) ON CONFLICT (version, build_number) DO NOTHING;
-- ═══════════════════════════════════════════════════════════════════════════════
-- feature_flags — per-company operational toggles (distinct from saas entitlements)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.feature_flags (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    feature_name text NOT NULL,
    enabled      boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feature_flags_company_feature_unique UNIQUE (company_id, feature_name)
);
CREATE INDEX IF NOT EXISTS idx_feature_flags_company ON public.feature_flags (company_id);
-- ═══════════════════════════════════════════════════════════════════════════════
-- company_settings — structured tenant configuration
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.company_settings (
    company_id           uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    timezone             text NOT NULL DEFAULT 'Africa/Johannesburg',
    currency             text NOT NULL DEFAULT 'ZAR',
    vat_rate             numeric(5, 2) NOT NULL DEFAULT 15.00,
    branding             jsonb NOT NULL DEFAULT '{}'::jsonb,
    logo_url             text,
    primary_color        text,
    secondary_color      text,
    payroll_preferences  jsonb NOT NULL DEFAULT '{}'::jsonb,
    leave_settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
-- Backfill settings rows for existing companies
INSERT INTO public.company_settings (company_id, leave_settings, payroll_preferences)
SELECT c.id,
       jsonb_build_object(
           'annual_leave_days', coalesce((c.custom_settings->>'annual_leave_days')::int, 15),
           'sick_leave_days', coalesce((c.custom_settings->>'sick_leave_days')::int, 10)
       ),
       coalesce(c.custom_settings, '{}'::jsonb)
FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;
-- ═══════════════════════════════════════════════════════════════════════════════
-- backup_jobs + company_backups — metadata framework (no destructive restore)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.backup_jobs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    job_type      text NOT NULL DEFAULT 'manual',
    status        text NOT NULL DEFAULT 'pending',
    requested_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    schedule_cron text,
    started_at    timestamptz,
    completed_at  timestamptz,
    error_message text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT backup_jobs_type_check CHECK (job_type IN ('manual', 'scheduled')),
    CONSTRAINT backup_jobs_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_company ON public.backup_jobs (company_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.company_backups (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    backup_job_id  uuid REFERENCES public.backup_jobs(id) ON DELETE SET NULL,
    label          text NOT NULL,
    storage_path   text,
    size_bytes     bigint,
    record_counts  jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_restorable  boolean NOT NULL DEFAULT true,
    created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_backups_company ON public.company_backups (company_id, created_at DESC);
-- ═══════════════════════════════════════════════════════════════════════════════
-- application_errors — structured exception sink
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.application_errors (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module         text,
    page           text,
    exception_type text,
    message        text,
    stack_trace    text,
    company_id     uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    employee_id    uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    app_version    text,
    platform       text,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_errors_company ON public.application_errors (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_application_errors_created ON public.application_errors (created_at DESC);
-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Latest app version for update checks
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_latest_app_version(p_platform text DEFAULT 'windows')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_row public.app_versions%ROWTYPE;
    v_download text;
BEGIN
    SELECT * INTO v_row
    FROM public.app_versions
    WHERE is_active = true
    ORDER BY release_date DESC, build_number DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN '{}'::jsonb;
    END IF;

    v_download := coalesce(
        CASE lower(p_platform)
            WHEN 'android' THEN v_row.download_url_android
            WHEN 'ios' THEN v_row.download_url_ios
            WHEN 'winui' THEN v_row.download_url_windows
            WHEN 'windows' THEN v_row.download_url_windows
            WHEN 'maccatalyst' THEN v_row.download_url_ios
            ELSE NULL
        END,
        v_row.download_url
    );

    RETURN jsonb_build_object(
        'id', v_row.id,
        'version', v_row.version,
        'build_number', v_row.build_number,
        'release_date', v_row.release_date,
        'release_notes', v_row.release_notes,
        'minimum_required_version', v_row.minimum_required_version,
        'download_url', v_download,
        'is_mandatory', v_row.is_mandatory
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_latest_app_version(text) TO anon, authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Log application error (HR JWT + worker code-login)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.log_application_error(
    p_module text,
    p_page text,
    p_exception_type text,
    p_message text,
    p_stack_trace text DEFAULT NULL,
    p_company_id uuid DEFAULT NULL,
    p_employee_id uuid DEFAULT NULL,
    p_app_version text DEFAULT NULL,
    p_platform text DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_id uuid;
    v_user uuid := auth.uid();
BEGIN
    IF p_company_id IS NOT NULL
       AND NOT (p_company_id = ANY(public.user_company_ids()))
       AND NOT public.platform_is_admin()
       AND (p_employee_id IS NULL OR NOT public._employee_valid(p_company_id, p_employee_id))
    THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    INSERT INTO public.application_errors (
        module, page, exception_type, message, stack_trace,
        company_id, user_id, employee_id, app_version, platform, metadata
    ) VALUES (
        p_module, p_page, p_exception_type, p_message, p_stack_trace,
        p_company_id, v_user, p_employee_id, p_app_version, p_platform, coalesce(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_application_error(
    text, text, text, text, text, uuid, uuid, text, text, jsonb
) TO anon, authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Company settings read/write
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_company_settings(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_row public.company_settings%ROWTYPE;
BEGIN
    IF NOT (p_company_id = ANY(public.user_company_ids()) OR public.platform_is_admin()) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT * INTO v_row FROM public.company_settings WHERE company_id = p_company_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('company_id', p_company_id);
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_settings(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.upsert_company_settings(p_company_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_row public.company_settings%ROWTYPE;
BEGIN
    IF NOT (public.is_company_owner(p_company_id) OR public.platform_is_admin()) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    INSERT INTO public.company_settings (
        company_id, timezone, currency, vat_rate, branding, logo_url,
        primary_color, secondary_color, payroll_preferences, leave_settings, updated_at
    ) VALUES (
        p_company_id,
        coalesce(p_payload->>'timezone', 'Africa/Johannesburg'),
        coalesce(p_payload->>'currency', 'ZAR'),
        coalesce((p_payload->>'vat_rate')::numeric, 15.00),
        coalesce(p_payload->'branding', '{}'::jsonb),
        p_payload->>'logo_url',
        p_payload->>'primary_color',
        p_payload->>'secondary_color',
        coalesce(p_payload->'payroll_preferences', '{}'::jsonb),
        coalesce(p_payload->'leave_settings', '{}'::jsonb),
        now()
    )
    ON CONFLICT (company_id) DO UPDATE SET
        timezone = coalesce(EXCLUDED.timezone, company_settings.timezone),
        currency = coalesce(EXCLUDED.currency, company_settings.currency),
        vat_rate = coalesce(EXCLUDED.vat_rate, company_settings.vat_rate),
        branding = coalesce(EXCLUDED.branding, company_settings.branding),
        logo_url = coalesce(EXCLUDED.logo_url, company_settings.logo_url),
        primary_color = coalesce(EXCLUDED.primary_color, company_settings.primary_color),
        secondary_color = coalesce(EXCLUDED.secondary_color, company_settings.secondary_color),
        payroll_preferences = coalesce(EXCLUDED.payroll_preferences, company_settings.payroll_preferences),
        leave_settings = coalesce(EXCLUDED.leave_settings, company_settings.leave_settings),
        updated_at = now()
    RETURNING * INTO v_row;

    RETURN to_jsonb(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_company_settings(uuid, jsonb) TO authenticated;
-- UUID owner check (bigint overload exists from legacy migrations)
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = p_company_id AND c.owner_user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.company_id = p_company_id
          AND e.user_id = auth.uid()
          AND e.access_level IN ('owner', 'admin', 'hr_admin')
          AND coalesce(e.is_active, true)
    );
$$;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid) TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_errors ENABLE ROW LEVEL SECURITY;
-- app_versions: read for all authenticated; write platform admin only
CREATE POLICY p_app_versions_select ON public.app_versions
    FOR SELECT TO authenticated
    USING (is_active = true OR public.platform_is_admin());
CREATE POLICY p_app_versions_admin ON public.app_versions
    FOR ALL TO authenticated
    USING (public.platform_is_admin())
    WITH CHECK (public.platform_is_admin());
-- feature_flags
CREATE POLICY p_feature_flags_select ON public.feature_flags
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());
CREATE POLICY p_feature_flags_write ON public.feature_flags
    FOR ALL TO authenticated
    USING (public.is_company_owner(company_id) OR public.platform_is_admin())
    WITH CHECK (public.is_company_owner(company_id) OR public.platform_is_admin());
-- company_settings (direct read for members; writes via RPC preferred)
CREATE POLICY p_company_settings_select ON public.company_settings
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());
CREATE POLICY p_company_settings_write ON public.company_settings
    FOR ALL TO authenticated
    USING (public.is_company_owner(company_id) OR public.platform_is_admin())
    WITH CHECK (public.is_company_owner(company_id) OR public.platform_is_admin());
-- backup_jobs
CREATE POLICY p_backup_jobs_select ON public.backup_jobs
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());
CREATE POLICY p_backup_jobs_write ON public.backup_jobs
    FOR ALL TO authenticated
    USING (public.is_company_owner(company_id) OR public.platform_is_admin())
    WITH CHECK (public.is_company_owner(company_id) OR public.platform_is_admin());
-- company_backups
CREATE POLICY p_company_backups_select ON public.company_backups
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());
CREATE POLICY p_company_backups_write ON public.company_backups
    FOR ALL TO authenticated
    USING (public.is_company_owner(company_id) OR public.platform_is_admin())
    WITH CHECK (public.is_company_owner(company_id) OR public.platform_is_admin());
-- application_errors: insert own scope; read company HR
CREATE POLICY p_application_errors_insert ON public.application_errors
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id IS NULL
        OR company_id = ANY(public.user_company_ids())
        OR public.platform_is_admin()
    );
CREATE POLICY p_application_errors_select ON public.application_errors
    FOR SELECT TO authenticated
    USING (
        company_id = ANY(public.user_company_ids())
        OR public.platform_is_admin()
    );
