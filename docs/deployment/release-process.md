# Release process — end-to-end

Standard operating procedure for publishing a KaiFlow pilot or production release.

---

## Overview

```
Build (Windows + Android)
    → Upload to Supabase Storage (releases bucket)
    → Update app_versions
    → Deploy website (if copy changed)
    → Verify Download Center + in-app updates
    → Monitor telemetry 48h
```

---

## Step 1 — Build Windows release

```powershell
cd KaiFlow.Timesheets.Maui

# Bump version in KaiFlow.Timesheets.Maui.csproj first
.\scripts\build_windows_installer.ps1
```

**Artifact:** `dist/KaiFlowSetup.exe`  
**Doc:** [windows-installer.md](./windows-installer.md)

Checklist:
- [ ] Version/build incremented in csproj
- [ ] Installer runs on clean VM
- [ ] HR login + employee punch smoke test

---

## Step 2 — Build Android release

```powershell
$env:KAIFLOW_KEYSTORE_PATH = "C:\secure\kaiflow-release.keystore"
$env:KAIFLOW_KEYSTORE_PASSWORD = "***"

dotnet publish KaiFlow.Timesheets.Maui.csproj `
  -f net10.0-android -c Release -p:AndroidPackageFormat=apk
```

Rename output to `KaiFlow-v{version}.apk`.

**Doc:** [android-release.md](./android-release.md)

---

## Step 3 — Upload to Supabase Storage

Upload to `releases` bucket:

| File | Storage path |
|------|--------------|
| Windows installer | `releases/windows/KaiFlowSetup.exe` |
| Android APK | `releases/android/KaiFlow-v1.0.0.apk` |

**Doc:** [release-hosting.md](./release-hosting.md)

---

## Step 4 — Create or update app_versions record

```sql
INSERT INTO public.app_versions (
  version, build_number, release_notes, minimum_required_version,
  download_url_windows, download_url_android,
  is_mandatory, is_active, release_date
) VALUES (
  '1.0.0', 1,
  'KaiFlow pilot release — workforce, payroll, finance, portals.',
  '1.0.0',
  'https://vcivtjwreybaxgtdhtou.supabase.co/storage/v1/object/public/releases/windows/KaiFlowSetup.exe',
  'https://vcivtjwreybaxgtdhtou.supabase.co/storage/v1/object/public/releases/android/KaiFlow-v1.0.0.apk',
  false, true, now()
)
ON CONFLICT (version, build_number) DO UPDATE SET
  release_notes = EXCLUDED.release_notes,
  download_url_windows = EXCLUDED.download_url_windows,
  download_url_android = EXCLUDED.download_url_android,
  is_mandatory = EXCLUDED.is_mandatory,
  is_active = EXCLUDED.is_active,
  release_date = EXCLUDED.release_date;
```

**Mandatory update:** set `is_mandatory = true` OR set `minimum_required_version` above old client versions.

Deactivate old rows: `UPDATE app_versions SET is_active = false WHERE version < 'X';` (only one active latest is selected by RPC — newest `release_date` wins).

---

## Step 5 — Publish release notes

Release notes appear in:
- Website **Download Center** (`download.html`)
- Website **Releases** (`releases.html`)
- In-app **UpdatePage**

Write customer-facing notes in `release_notes` column (plain text, newline-separated bullets).

Optional: email pilot customers using [07-client-onboarding-pack.md](./07-client-onboarding-pack.md).

---

## Step 6 — Verify Download Center

1. Open https://kaisyncworkforce.vercel.app/download
2. Confirm **Latest Version**, **Release Date**, **Release Notes** load (not hardcoded)
3. Click **Download for Windows** → file downloads
4. Click **Download for Android** → APK downloads
5. iOS section shows web app + Add to Home Screen instructions

---

## Step 7 — Verify update detection

### Optional update

1. Install previous version (or lower build).
2. Launch app → login screen.
3. Expect alert: **Update Available** with **View update** / **Later**.
4. **UpdatePage** shows installed vs latest version + release notes.
5. **Download update** opens configured URL.

### Mandatory update

1. Set `is_mandatory = true` on new `app_versions` row (test environment first).
2. Launch old version → routed directly to **UpdatePage** (no skip).
3. **Update later** hidden; user must download update.

**Code path:** `IdEntryPage` → `AppUpdateService.CheckDetailedAsync()` → `VersionService.CheckForUpdateAsync()` → RPC `get_latest_app_version`.

---

## Step 8 — Post-release monitoring (48 hours)

| Signal | Where |
|--------|-------|
| Crashes / exceptions | `application_errors` table |
| Update checks | `app_events` action `update_check` |
| Login failures | Supabase Auth logs |
| Platform admin errors | Platform Console → Overview |

Rollback: [03-rollback-checklist.md](./03-rollback-checklist.md)

---

## Version bump cheat sheet

| Location | Field |
|----------|-------|
| `KaiFlow.Timesheets.Maui.csproj` | `ApplicationDisplayVersion`, `ApplicationVersion` |
| `app_versions` | `version`, `build_number`, URLs, notes |
| `installers/KaiFlowSetup.iss` | Via script `/DMyAppVersion=` `/DMyAppBuild=` |
| Website | Dynamic — no hardcoding |

---

## Related checklists

- [01-deployment-checklist.md](./01-deployment-checklist.md)
- [02-release-checklist.md](./02-release-checklist.md)
- [07-client-onboarding-pack.md](./07-client-onboarding-pack.md)
