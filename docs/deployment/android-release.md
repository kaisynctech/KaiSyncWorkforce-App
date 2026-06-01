# Android release — KaiFlow.apk & KaiFlow.aab

Production guide for signed Android builds of the KaiFlow .NET MAUI app.

**Package ID:** `com.kaisynctech.kaiflow.timesheets`  
**Display name:** KaiFlow Timesheets

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| .NET 10 SDK + MAUI Android workload | Build |
| JDK 17+ | Android toolchain |
| Android SDK (API 21+) | Target `net10.0-android` |
| Release keystore | APK/AAB signing (create once, store securely) |

---

## Keystore configuration

Create a release keystore **once** and back it up offline:

```powershell
keytool -genkeypair -v `
  -keystore kaiflow-release.keystore `
  -alias kaiflow `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -storetype PKCS12
```

Store the keystore **outside** the git repository (e.g. secure vault or CI secret).

### MSBuild signing (recommended)

Add to `KaiFlow.Timesheets.Maui.csproj` (Release only) — use environment variables or a local untracked `Directory.Build.props.user`:

```xml
<PropertyGroup Condition="'$(Configuration)' == 'Release'">
  <AndroidKeyStore>true</AndroidKeyStore>
  <AndroidSigningKeyStore>$(KAIFLOW_KEYSTORE_PATH)</AndroidSigningKeyStore>
  <AndroidSigningKeyAlias>kaiflow</AndroidSigningKeyAlias>
  <AndroidSigningKeyPass>$(KAIFLOW_KEYSTORE_PASSWORD)</AndroidSigningKeyPass>
  <AndroidSigningStorePass>$(KAIFLOW_KEYSTORE_PASSWORD)</AndroidSigningStorePass>
</PropertyGroup>
```

Set before build:

```powershell
$env:KAIFLOW_KEYSTORE_PATH = "C:\secure\kaiflow-release.keystore"
$env:KAIFLOW_KEYSTORE_PASSWORD = "your-password"
```

> **Never commit** keystore files or passwords to git.

---

## Version management

Same as Windows — `KaiFlow.Timesheets.Maui.csproj`:

```xml
<ApplicationDisplayVersion>1.0.0</ApplicationDisplayVersion>
<ApplicationVersion>1</ApplicationVersion>
```

| Field | Android mapping |
|-------|-----------------|
| `ApplicationDisplayVersion` | `versionName` |
| `ApplicationVersion` | `versionCode` (integer, must increase every Play upload) |

Sync with `app_versions.version` and `app_versions.build_number` for update detection and website display.

---

## Build commands

### Signed APK (direct distribution — pilot customers)

```powershell
cd KaiFlow.Timesheets.Maui

dotnet publish KaiFlow.Timesheets.Maui.csproj `
  -f net10.0-android `
  -c Release `
  -p:AndroidPackageFormat=apk
```

Signed APK typical path:

```
bin\Release\net10.0-android\publish\com.kaisynctech.kaiflow.timesheets-Signed.apk
```

Rename for hosting: `KaiFlow-v1.0.0.apk`

### Signed AAB (Google Play — future)

```powershell
dotnet publish KaiFlow.Timesheets.Maui.csproj `
  -f net10.0-android `
  -c Release `
  -p:AndroidPackageFormat=aab
```

Output: `*-Signed.aab` — upload to Google Play Console when listed.

---

## Signing process

1. Configure keystore (above).
2. Build Release publish — MAUI signs during publish when `AndroidKeyStore=true`.
3. Verify signature:

```powershell
apksigner verify --verbose bin\Release\net10.0-android\publish\*-Signed.apk
```

4. Upload signed artifact only — never distribute unsigned `-Signed.apk` failures.

---

## Release notes support

Release notes live in **`app_versions.release_notes`** (not embedded in APK).

Flow:
1. Publish APK to Supabase Storage.
2. Insert/update `app_versions` row with notes + `download_url_android`.
3. Website Download Center and in-app **UpdatePage** display notes from RPC `get_latest_app_version`.

Legacy fallback: `config/app-version.json` in Supabase Storage (deprecated — use `app_versions`).

---

## Customer install (APK sideload)

1. Open download link on Android device.
2. Allow install from browser/Files (one-time).
3. Install → open **KaiFlow Timesheets**.
4. Employee login: company code + login code.

Document this in [07-client-onboarding-pack.md](./07-client-onboarding-pack.md).

---

## Release checklist (Android)

- [ ] Increment `ApplicationVersion` (versionCode)
- [ ] Bump `ApplicationDisplayVersion` if customer-visible
- [ ] Build signed APK (or AAB for Play)
- [ ] Test on physical device: install, login, punch
- [ ] Upload to `releases/android/KaiFlow-vX.Y.Z.apk`
- [ ] Update `app_versions.download_url_android`
- [ ] Verify website Download Center
- [ ] Verify optional/mandatory update flow on device

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Install blocked | Enable unknown sources for browser/Files |
| Update won't install | versionCode must be higher than installed |
| Wrong signing key | Always use same keystore for updates |
| Play Protect warning | Normal for sideload; Play listing removes this |

---

## Related docs

- [windows-installer.md](./windows-installer.md)
- [release-hosting.md](./release-hosting.md)
- [release-process.md](./release-process.md)
