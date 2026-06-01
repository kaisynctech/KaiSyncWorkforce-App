# Windows installer deployment report — v1.0.0

**Date:** 2026-06-01  
**Phase:** KaiFlow deployment packaging — replace ZIP with Inno Setup installer  
**Status:** Built, verified locally, ready for GitHub Release upload

---

## Summary

Windows distribution moved from a raw MAUI publish ZIP to **`KaiFlowSetup.exe`**, an Inno Setup 6 installer that installs to Program Files with Start Menu and desktop shortcuts, supports in-place upgrades, and includes version metadata.

---

## Installer metrics

| Property | Value |
|----------|-------|
| **File name** | `KaiFlowSetup.exe` |
| **Size** | 64.63 MB (67,764,523 bytes) |
| **SHA256** | `015D8F649AD0A75FCF5AD374A6A1D8BA914DF0009DFDC1BE39124B41A623D7D0` |
| **Version** | 1.0.0 (build 1) |
| **Build location** | `KaiFlow.Timesheets.Maui/dist/KaiFlowSetup.exe` |
| **Versioned copy** | `KaiFlow.Timesheets.Maui/dist/KaiFlowSetup-v1.0.0.exe` |
| **Build manifest** | `KaiFlow.Timesheets.Maui/dist/KaiFlowSetup-build-manifest.json` |

---

## Build pipeline

```
dotnet publish (Release, win-x64)
    → publish/windows/
    → Inno Setup (installers/KaiFlowSetup.iss)
    → dist/KaiFlowSetup.exe
```

**Command:**

```powershell
cd KaiFlow.Timesheets.Maui
.\scripts\build_windows_installer.ps1
# First-time: .\scripts\build_windows_installer.ps1 -InstallInnoSetup
```

**Prerequisites:** .NET 10 SDK, MAUI Windows workload, Inno Setup 6 (`ISCC.exe`).

---

## Installation behaviour

| Requirement | Implementation |
|-------------|----------------|
| Program Files | `{autopf}\KaiFlow` → `C:\Program Files\KaiFlow` (admin install) |
| Start Menu shortcut | `Programs\KaiFlow\KaiFlow.lnk` |
| Desktop shortcut | `Common Desktop\KaiFlow.lnk` (checked on first install) |
| Uninstall entry | Start Menu → Uninstall KaiFlow |
| Version info | File properties: 1.0.0.0, KaiSync Tech, KaiFlow |
| Branding | App name **KaiFlow**, publisher **KaiSync Tech**, support URL |
| Upgrade | Same `AppId` GUID — re-running installer upgrades in place |
| Close running app | `CloseApplications=force` during upgrade |

**Installed executable:** `C:\Program Files\KaiFlow\KaiFlow.Timesheets.Maui.exe`

---

## Verification (automated)

Script: `scripts/verify_windows_installer.ps1`

| Test | Result |
|------|--------|
| Fresh silent install | **PASS** |
| Upgrade (re-run same installer) | **PASS** |
| Silent uninstall | **PASS** |

Logs: `dist/verify-logs/install-fresh.log`, `install-upgrade.log`, `uninstall.log`

---

## Release location (production)

| Channel | URL |
|---------|-----|
| **GitHub Release** | `https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/download/v1.0.0/KaiFlowSetup.exe` |
| **Website** | Dynamic via Supabase RPC `get_latest_app_version` → `download_url_windows` |
| **In-app update** | Same RPC URL opened by **Download update** on `UpdatePage` |

Migration: `20260601100000_app_versions_windows_installer_url.sql`

---

## Upgrade behaviour (customer-facing)

1. User downloads new `KaiFlowSetup.exe` from website or in-app update link.
2. Runs installer — Inno Setup detects existing install via fixed `AppId`.
3. Files replaced in `C:\Program Files\KaiFlow`; shortcuts preserved.
4. User data remains in **Supabase** (cloud); local reinstall does not wipe tenant data.
5. No manual uninstall required for normal version upgrades.

---

## What customers no longer receive

- ~~`KaiFlow-Windows-v1.0.0.zip`~~ (raw publish folder)
- ~~Manual unzip instructions~~

---

## Android (unchanged)

Pilot Android distribution remains **`KaiFlow-v1.0.0.apk`** via GitHub Releases. No changes in this phase.

---

## Related files

| File | Purpose |
|------|---------|
| `installers/KaiFlowSetup.iss` | Inno Setup script |
| `scripts/build_windows_installer.ps1` | Publish + compile installer |
| `scripts/verify_windows_installer.ps1` | Install/upgrade/uninstall smoke test |
| `docs/deployment/windows-installer.md` | Operator guide |
| `docs/deployment/release-process.md` | End-to-end release SOP |

---

## Next operator steps

1. Upload `dist/KaiFlowSetup.exe` to GitHub Release `v1.0.0` (replace or supersede ZIP asset).
2. Apply migration `20260601100000_app_versions_windows_installer_url.sql` (`supabase db push`).
3. Confirm https://www.kaisyncworkforce.com/download serves `KaiFlowSetup.exe`.
4. Optional: code-sign installer to reduce SmartScreen warnings.
