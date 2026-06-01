# Release process — end-to-end

Standard operating procedure for publishing a KaiFlow pilot or production release.

---

## Overview

```
Build (Windows installer + Android APK)
    → Upload to GitHub Releases
    → Update app_versions (download URLs)
    → Deploy website (if copy changed)
    → Verify Download Center + in-app updates
    → Monitor telemetry 48h
```

---

## Step 1 — Build Windows installer

```powershell
cd KaiFlow.Timesheets.Maui

# Bump version in KaiFlow.Timesheets.Maui.csproj first
.\scripts\build_windows_installer.ps1
```

**Artifact:** `dist/KaiFlowSetup.exe` (Inno Setup installer)  
**Optional:** `dist/KaiFlowSetup-v{version}.exe` (versioned copy for release tagging)  
**Doc:** [windows-installer.md](./windows-installer.md)

Checklist:
- [ ] Version/build incremented in csproj
- [ ] `.\scripts\verify_windows_installer.ps1` passes (fresh install, upgrade, uninstall)
- [ ] HR login + employee punch smoke test on installed app

> **Do not ship** raw `publish/windows/` folders or ZIP archives to customers.

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

## Step 3 — Upload to GitHub Releases

Create or update a GitHub Release (e.g. `v1.0.0`) and attach:

| File | Release asset name |
|------|-------------------|
| Windows installer | `KaiFlowSetup.exe` |
| Android APK | `KaiFlow-v1.0.0.apk` |

**Doc:** [release-hosting.md](./release-hosting.md)

---

## Step 4 — Create or update app_versions record

```sql
UPDATE public.app_versions
SET
  download_url = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlowSetup.exe',
  download_url_windows = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlowSetup.exe',
  download_url_android = 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlow-v1.0.0.apk',
  release_notes = 'Pilot release — Windows installer + Android APK.',
  release_date = now(),
  is_active = true
WHERE version = '1.0.0' AND build_number = 1;
```

**Mandatory update:** set `is_mandatory = true` OR raise `minimum_required_version` so older clients are blocked at login until updated.

---

## Step 5 — Publish release notes

Release notes appear in:
- Website **Download Center** (`download.html`)
- Website **Releases** (`releases.html`)
- In-app **UpdatePage**

Write customer-facing notes in `release_notes` column (plain text, newline-separated bullets).

---

## Step 6 — Verify Download Center

1. Open https://www.kaisyncworkforce.com/download
2. Confirm **Latest Version**, **Release Date**, **Release Notes** load
3. Click **Download for Windows** → `KaiFlowSetup.exe` downloads (not a ZIP)
4. Click **Download for Android** → APK downloads

---

## Step 7 — Verify update detection

### Optional update

1. Install previous version (or lower build).
2. Launch app → login screen.
3. Expect alert: **Update Available** with **View update** / **Later**.
4. **UpdatePage** shows installed vs latest version + release notes.
5. **Download update** opens `KaiFlowSetup.exe` URL.

### Mandatory update

1. Set `is_mandatory = true` on new `app_versions` row (test environment first).
2. Launch old version → routed directly to **UpdatePage** (no skip).

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
- [windows-installer-deployment-report.md](./windows-installer-deployment-report.md)
- [07-client-onboarding-pack.md](./07-client-onboarding-pack.md)
