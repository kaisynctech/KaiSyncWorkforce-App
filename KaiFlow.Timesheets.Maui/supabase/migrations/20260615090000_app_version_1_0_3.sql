-- KaiSync Workforce v1.0.3 pilot release.
-- Assets must exist before this migration is applied.

BEGIN;
UPDATE public.app_versions
SET is_active = false
WHERE is_active = true;
INSERT INTO public.app_versions (
    version,
    build_number,
    download_url,
    download_url_windows,
    download_url_android,
    release_notes,
    release_date,
    is_active,
    is_mandatory,
    minimum_required_version
)
VALUES (
    '1.0.3',
    4,
    'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.3/KaiSyncWorkforceSetup.exe',
    'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.3/KaiSyncWorkforceSetup.exe',
    'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.3/KaiSyncWorkforce-v1.0.3.apk',
    E'KaiSync Workforce v1.0.3 pilot release.\n\n'
      '- Expanded contractor lifecycle, compliance, banking, quotes, job assignment, and payout workflows.\n'
      '- Improved HR dashboards, reports, navigation, and finance approval experiences.\n'
      '- Added employee PIN authentication and worker-session security updates.\n'
      '- Includes Windows stability and Android packaging improvements.',
    now(),
    true,
    false,
    '1.0.0'
)
ON CONFLICT (version, build_number) DO UPDATE SET
    download_url = EXCLUDED.download_url,
    download_url_windows = EXCLUDED.download_url_windows,
    download_url_android = EXCLUDED.download_url_android,
    release_notes = EXCLUDED.release_notes,
    release_date = EXCLUDED.release_date,
    is_active = EXCLUDED.is_active,
    is_mandatory = EXCLUDED.is_mandatory,
    minimum_required_version = EXCLUDED.minimum_required_version;
COMMIT;
