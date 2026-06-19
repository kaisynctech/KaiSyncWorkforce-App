-- KaiFlow v1.0.1 — security hardening release (session enforcement + storage hardening).
-- Upload KaiFlowSetup.exe and KaiFlow-v1.0.1.apk to GitHub Release v1.0.1 before activating.

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
  '1.0.1',
  2,
  'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.1/KaiFlowSetup.exe',
  'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.1/KaiFlowSetup.exe',
  'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.1/KaiFlow-v1.0.1.apk',
  'KaiFlow v1.0.1 — production security hardening.

- Mandatory worker session token validation on all field-worker RPCs
- HR and platform admin RPCs removed from anon access
- Private workforce-media storage with validated upload grants
- SecureStorage for worker and portal session credentials
- Dependency security patch (System.IO.Packaging)

Update required for code-login workers after server deploy.',
  now(),
  true,
  true,
  '1.0.1'
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
