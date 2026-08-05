-- Wire pilot release binaries to app_versions.
-- Hosting: GitHub Releases (free tier Supabase Storage global limit is 50 MB; Windows ZIP ~96 MB, APK ~68 MB).
-- When Supabase Pro is enabled, optionally mirror to releases bucket and swap URLs.

UPDATE public.app_versions
SET
    download_url = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlow-Windows-v1.0.0.zip',
    download_url_windows = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlow-Windows-v1.0.0.zip',
    download_url_android = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlow-v1.0.0.apk',
    release_notes = 'KaiFlow pilot release — workforce, payroll, finance, HR suite, and client portals.',
    release_date = now(),
    is_active = true
WHERE version = '1.0.0' AND build_number = 1;
