# Client Credential Hardening

**Date:** 2026-06-01

## Changes

| Component | Before | After |
|-----------|--------|-------|
| `CodeSessionStore` | Preferences (plaintext) | SecureStorage + one-time legacy migration |
| `MauiSupabaseSessionHandler` | Preferences primary | SecureStorage primary |
| `ClientPortalSessionStore` | Preferences | SecureStorage for IDs + portal codes |
| `ContractorPortalSessionStore` | Preferences | SecureStorage for IDs + portal codes |
| `ValidateCodeSessionAsync` | Fail-open | **Fail-closed** |

## Auto-login preserved

- Legacy Preferences values migrate to SecureStorage on first read.
- Code-login refresh flow unchanged (`employee_refresh_code_session`).
- HR JWT auto-refresh via Supabase `AutoRefreshToken`.

## Token rotation

- Server: `employee_refresh_code_session` issues new token; client saves via `CodeSessionStore.Save`.
- Logout: `employee_revoke_code_session` + SecureStorage clear.

## Telemetry

| Event | Source |
|-------|--------|
| `token_restored` | SecureStorage load/migration |
| `token_missing` | Empty JWT in SecureStorage |
| `secure_storage_failure` | SecureStorage exceptions |

Wired in `MauiProgram.cs` via `AppTelemetrySink` → `AppTelemetry.LogEvent`.

## Rollback

Revert store classes to Preferences-only. Users will need to sign in again after rollback (SecureStorage keys ignored).

## Compatibility

- **No UI changes.**
- Windows/macOS/iOS/Android SecureStorage backends used per MAUI platform defaults.
- If SecureStorage fails, code-login falls back to Preferences temporarily and logs `secure_storage_failure`.
