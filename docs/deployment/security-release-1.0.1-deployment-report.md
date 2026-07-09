# Security release v1.0.1 — deployment report

**Date:** 2026-06-01  
**Supabase project:** `vcivtjwreybaxgtdhtou`

## Database — deployed

All migrations applied (`supabase migration list --linked` local = remote):

| Migration | Status |
|-----------|--------|
| `20260601110000_worker_session_enforcement_foundation.sql` | Applied |
| `20260601120000_worker_session_enforcement_rpcs.sql` | Applied |
| `20260601130000_authorization_audit_revoke_anon.sql` | Applied (fixed safe revoke helper) |
| `20260601140000_storage_hardening.sql` | Applied |
| `20260601150000_app_versions_security_release_1_0_1.sql` | Applied |

**Active release in DB:** `1.0.1` build `2`, mandatory, `minimum_required_version = 1.0.1`

## Client — built

| Artifact | Path | SHA256 |
|----------|------|--------|
| Windows installer | `KaiFlow.Timesheets.Maui/dist/KaiFlowSetup.exe` | `6AE3D679A1453D4F8B6BA20B85C4ED8B2EB3EA3D3EB26D8E75688ED03D812B39` |
| Versioned copy | `KaiFlow.Timesheets.Maui/dist/KaiFlowSetup-v1.0.1.exe` | same |
| Build manifest | `KaiFlow.Timesheets.Maui/dist/KaiFlowSetup-build-manifest.json` | — |

- **Version:** 1.0.1 (build 2) in `KaiFlow.Timesheets.Maui.csproj`
- **Size:** ~64.6 MB
- **Build script fix:** removed `-r win-x64` from publish (avoids missing Mono runtime pack on .NET 10)

## Remaining manual steps

1. **GitHub Release `v1.0.1`** — upload:
   - `dist/KaiFlowSetup.exe`
   - Android APK as `KaiFlow-v1.0.1.apk` (build separately if needed)
2. **Verify download URLs** resolve after upload (already set in `app_versions`)
3. **Smoke test** on installed v1.0.1:
   - Employee code login + punch
   - Leave attachment upload
   - HR JWT login + shift templates
4. **Notify pilots** — mandatory update; v1.0.0 clients will be blocked at login

## Rollback

See [docs/security/rollback-notes.md](../security/rollback-notes.md). Do not rollback DB without shipping a matching client.
