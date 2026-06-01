-- Point Windows downloads to KaiFlowSetup.exe (Inno Setup installer) on GitHub Releases.

UPDATE public.app_versions
SET
    download_url = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlowSetup.exe',
    download_url_windows = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlowSetup.exe',
    release_notes = 'KaiFlow v1.0.0 — Windows installer (KaiFlowSetup.exe) and Android APK. Workforce, payroll, finance, HR suite, and client portals.',
    release_date = now(),
    is_active = true
WHERE version = '1.0.0' AND build_number = 1;
