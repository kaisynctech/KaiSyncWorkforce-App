# Worker RPC Inventory & Session Enforcement Rollout

**Date:** 2026-06-01  
**Migrations:** `20260601110000` (foundation), `20260601120000` (RPCs), `20260601130000` (auth audit)

## Summary

| Category | Count | Anon access after rollout |
|----------|------:|---------------------------|
| Worker RPC (`employee_*`) | 79 | Yes — requires `p_session_token` |
| Portal RPC (`client_portal_*`, `contractor_portal_*`) | 18 | Yes — code-based (unchanged) |
| Platform RPC (`platform_*`, `saas_*`) | 12 | **No** — authenticated only |
| HR/Admin RPC (`hr_*`, `approve_*`, `get_employee_shift_templates`) | 8 | **No** — authenticated only |
| Public/onboarding RPC | 7 | Yes — intentional pre-auth |
| Finance/payroll PostgREST | — | JWT + RLS (unchanged) |

## Worker RPCs fixed (session enforcement)

All `employee_*` RPCs granted to `anon` now accept `p_session_token text DEFAULT NULL` and call `_assert_worker_access()` before data access. HR JWT callers (`auth.uid()` present) skip the token requirement.

**Auth RPCs excluded (no session token):**

- `employee_resolve_by_code`
- `employee_sign_in_with_code`
- `employee_refresh_code_session`
- `employee_revoke_code_session`
- `employee_validate_session`
- `employee_get_my_memberships_by_code`

**PA/messaging helpers also patched:**

- `sync_operational_pa_tasks`
- `upsert_employee_pa_settings`
- `enqueue_pa_task_notifications`
- `message_unread_counts_for_threads`
- `message_company_feed_unread_count`

Regenerate list: `python KaiFlow.Timesheets.Maui/scripts/generate_worker_session_migration.py`

## Portal RPCs (preserved)

| RPC | Category |
|-----|----------|
| `client_resolve_by_code` | Portal |
| `client_portal_*` (8 RPCs) | Portal |
| `contractor_resolve_by_code` | Portal |
| `contractor_portal_*` (9 RPCs) | Portal |

## Platform / HR RPCs — anon revoked

| RPC | Replacement auth |
|-----|------------------|
| `hr_upsert_shift_template` | HR JWT |
| `hr_delete_shift_template` | HR JWT |
| `hr_set_default_shift_template` | HR JWT |
| `hr_set_job_assignments` | HR JWT |
| `get_employee_shift_templates` | HR JWT |
| `hr_delete_employee_safe` | HR JWT |
| `hr_allocate_inventory_to_job` | HR JWT |
| `hr_get_employees_last_punch` | HR JWT |
| `approve_pending_employee` / `reject_pending_employee` | HR JWT |
| All `platform_*` | Platform admin JWT |

## Client changes (affected services)

| Service | Change |
|---------|--------|
| `SupabaseStorageService.WorkerRpc.cs` | `RpcAsync()` injects `p_session_token` for code-login |
| `SupabaseStorageService.cs` | All worker RPC calls routed through `RpcAsync` |
| `AppTelemetry.cs` | Sends `p_session_token` on `employee_log_app_event` |
| `CodeSessionStore.cs` | SecureStorage for codes + session token |

## Telemetry events

| Event | When |
|-------|------|
| `worker_session_validation_passed` | Worker RPC succeeds with token |
| `worker_session_validation_failed` | Missing/invalid token or UNAUTHORIZED |
| `token_restored` | SecureStorage migration/load success |
| `token_missing` | No JWT in SecureStorage |
| `secure_storage_failure` | SecureStorage read/write error |

## Risk reduction

| Before | After |
|--------|-------|
| Any anon caller with UUIDs could invoke worker RPCs | Requires valid `employee_code_sessions` token |
| HR shift/job RPCs callable with publishable key | Authenticated HR JWT only |
| Platform admin RPCs potentially reachable | Explicit anon revoke |
| Session validation fail-open on client | Fail-closed |

## RPCs remaining without session token (by design)

Public download/onboarding only:

- `get_latest_app_version`
- `list_public_app_versions`
- `self_register_company`
- `employee_self_register`
- Portal resolve/sign-in RPCs

## Rollback

1. Revert migrations `20260601120000`, `20260601130000`, `20260601110000` (in reverse order).
2. Deploy prior Supabase migration snapshot from git history.
3. Ship MAUI client build **without** `RpcAsync` token injection (or users must stay on old DB).

See `docs/security/rollback-notes.md`.
