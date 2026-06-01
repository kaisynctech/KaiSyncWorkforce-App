-- Website + app download URL aliases (no schema change — RPC JSON aliases only).

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
        'download_url_windows', v_row.download_url_windows,
        'download_url_android', v_row.download_url_android,
        'download_url_ios', v_row.download_url_ios,
        'windows_download_url', v_row.download_url_windows,
        'android_download_url', v_row.download_url_android,
        'download_url_fallback', v_row.download_url,
        'is_mandatory', v_row.is_mandatory
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_public_app_versions(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
    SELECT coalesce(
        jsonb_agg(row_data ORDER BY sort_date DESC, sort_build DESC),
        '[]'::jsonb
    )
    FROM (
        SELECT
            jsonb_build_object(
                'id', v.id,
                'version', v.version,
                'build_number', v.build_number,
                'release_date', v.release_date,
                'release_notes', v.release_notes,
                'minimum_required_version', v.minimum_required_version,
                'download_url', v.download_url,
                'download_url_windows', v.download_url_windows,
                'download_url_android', v.download_url_android,
                'download_url_ios', v.download_url_ios,
                'windows_download_url', v.download_url_windows,
                'android_download_url', v.download_url_android,
                'is_mandatory', v.is_mandatory
            ) AS row_data,
            v.release_date AS sort_date,
            v.build_number AS sort_build
        FROM public.app_versions v
        WHERE v.is_active = true
        ORDER BY v.release_date DESC, v.build_number DESC
        LIMIT greatest(1, least(p_limit, 100))
    ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_app_version(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_app_versions(integer) TO anon, authenticated;
