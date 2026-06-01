# Windows installer — KaiFlowSetup.exe

Production guide for building and distributing the KaiFlow .NET MAUI Windows desktop client.

**Output artifact:** `dist/KaiFlowSetup.exe`  
**Installed app:** `KaiFlow.Timesheets.Maui.exe` (Start Menu + optional desktop shortcut)

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| .NET 10 SDK | MAUI publish |
| Windows 10/11 x64 | Build machine |
| [Inno Setup 6](https://jrsoftware.org/isinfo.php) | `KaiFlowSetup.exe` packaging |
| Visual Studio 2022 (optional) | F5 debugging; CLI publish is sufficient |

Workload: **.NET Multi-platform App UI development**

---

## Version numbering

Set in `KaiFlow.Timesheets.Maui.csproj`:

```xml
<ApplicationDisplayVersion>1.0.0</ApplicationDisplayVersion>  <!-- user-visible -->
<ApplicationVersion>1</ApplicationVersion>                   <!-- build number -->
```

These values appear in:
- Windows file properties (via Inno Setup `VersionInfo*`)
- In-app **Settings → About** (`AppInfo.VersionString` / `BuildString`)
- `app_versions` table (must match for update detection)

**Rule:** Every release increments `ApplicationVersion` (build). Bump `ApplicationDisplayVersion` for customer-visible releases.

---

## Build commands

### 1. Publish MAUI Windows (Release)

```powershell
cd KaiFlow.Timesheets.Maui

dotnet publish KaiFlow.Timesheets.Maui.csproj `
  -f net10.0-windows10.0.19041.0 `
  -c Release `
  -r win-x64 `
  --self-contained false `
  -o publish\windows
```

Output: `publish\windows\KaiFlow.Timesheets.Maui.exe` + dependencies.

> **Note:** `WindowsPackageType` is `None` (unpackaged WinUI). Inno Setup wraps the publish folder — not MSIX.

### 2. Build installer (automated)

```powershell
cd KaiFlow.Timesheets.Maui
.\scripts\build_windows_installer.ps1
```

Optional parameters:

```powershell
.\scripts\build_windows_installer.ps1 -Version 1.0.1 -Build 2
.\scripts\build_windows_installer.ps1 -SkipPublish   # re-pack only
```

**Output:** `dist\KaiFlowSetup.exe`

### 3. Manual Inno Setup

```powershell
& "${env:ProgramFiles}\Inno Setup 6\ISCC.exe" `
  installers\KaiFlowSetup.iss `
  "/DPublishDir=$PWD\publish\windows" `
  "/DMyAppVersion=1.0.0" `
  "/DMyAppBuild=1"
```

---

## Installer behaviour

| Feature | Implementation |
|---------|----------------|
| Install location | `%ProgramFiles%\KaiFlow` |
| Start Menu | KaiFlow shortcut + Uninstall entry |
| Desktop shortcut | Optional (checked by default) |
| Branding | App name **KaiFlow**, publisher **KaiSync Tech** |
| Version in filename | `KaiFlowSetup.exe` (version in file properties) |
| Launch after install | Optional post-install run |

Script: `installers/KaiFlowSetup.iss`

---

## Release checklist (Windows)

- [ ] Bump `ApplicationDisplayVersion` and `ApplicationVersion` in `.csproj`
- [ ] Run `.\scripts\build_windows_installer.ps1`
- [ ] Smoke-test `KaiFlowSetup.exe` on a clean Windows VM
- [ ] Verify Start Menu + desktop shortcut
- [ ] Sign in as HR — dashboard loads
- [ ] Employee code login + punch smoke test
- [ ] Upload `KaiFlowSetup.exe` to Supabase Storage (see [release-hosting.md](./release-hosting.md))
- [ ] Update `app_versions.download_url_windows` with public URL
- [ ] Verify [Download Center](https://kaisyncworkforce.vercel.app/download) button
- [ ] Verify in-app update check opens download URL

---

## Upgrade process

1. User downloads new `KaiFlowSetup.exe` (website or in-app update link).
2. Run installer — Inno Setup upgrades in place (same `AppId`).
3. Shortcuts remain; no manual uninstall required for normal upgrades.

**Breaking changes:** Set `app_versions.is_mandatory = true` and/or raise `minimum_required_version` so older clients are blocked at login until updated.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| SmartScreen warning | Code-sign the installer (recommended for production) or instruct users: More info → Run anyway |
| Publish folder empty | Ensure `-f net10.0-windows10.0.19041.0` and Windows workload installed |
| Inno Setup not found | Install Inno Setup 6; re-run script |
| Wrong version in About | Re-publish after csproj bump; reinstall |

---

## Related docs

- [android-release.md](./android-release.md)
- [release-hosting.md](./release-hosting.md)
- [release-process.md](./release-process.md)
- [architecture/08-production-operations.md](../architecture/08-production-operations.md)
