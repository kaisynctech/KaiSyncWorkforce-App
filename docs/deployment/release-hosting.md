# Release hosting — GitHub Releases

Host KaiFlow release binaries on **GitHub Releases**. The **website Download Center** and **in-app update flow** read URLs from Supabase `app_versions` — binaries are never stored in the website repository.

---

## Recommended release assets

```
GitHub Release v1.0.0
├── KaiFlowSetup.exe          (Windows — Inno Setup installer)
└── KaiFlow-v1.0.0.apk        (Android — signed Release APK)
```

Do **not** publish raw `publish/windows/` ZIP archives to customers.

Optional future: mirror to Supabase Storage `releases/` bucket when on a plan that supports files > 50 MB.

---

## Build → host workflow

```powershell
cd KaiFlow.Timesheets.Maui
.\scripts\build_windows_installer.ps1          # → dist/KaiFlowSetup.exe
# Android: dotnet publish -f net10.0-android -c Release -p:AndroidPackageFormat=apk
```

Upload `dist/KaiFlowSetup.exe` and `dist/KaiFlow-v1.0.0.apk` to the GitHub Release, then update `app_versions`.

---

## Public URL format

```
https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v{version}/KaiFlowSetup.exe
https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v{version}/KaiFlow-v1.0.0.apk
```

---

## Wire URLs to app_versions

```sql
UPDATE public.app_versions
SET
  download_url_windows = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlowSetup.exe',
  download_url_android = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlow-v1.0.0.apk',
  download_url = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlowSetup.exe',
  release_date = now()
WHERE version = '1.0.0' AND build_number = 1;
```

RPC aliases (website + in-app):

| Column | RPC alias |
|--------|-----------|
| `download_url_windows` | `windows_download_url` |
| `download_url_android` | `android_download_url` |

---

## Supabase Storage (optional mirror)

Bucket `releases` exists (migration `20260529360000_releases_storage_bucket.sql`) for future use:

```
releases/windows/KaiFlowSetup.exe
releases/android/KaiFlow-v1.0.0.apk
```

Free-tier global upload limit is 50 MB; the Windows installer (~65 MB) requires GitHub Releases or Supabase Pro.

---

## Related docs

- [release-process.md](./release-process.md)
- [windows-installer.md](./windows-installer.md)
- [windows-installer-deployment-report.md](./windows-installer-deployment-report.md)
- [android-release.md](./android-release.md)
