# Security Hardening — Rollback Notes

Deploy rollback migrations in **reverse order**:

| Order | Migration | Action |
|------:|-----------|--------|
| 1 | `20260601140000_storage_hardening.sql` | Restore public bucket + anon insert policy |
| 2 | `20260601130000_authorization_audit_revoke_anon.sql` | Re-GRANT anon on HR/platform RPCs |
| 3 | `20260601120000_worker_session_enforcement_rpcs.sql` | Restore pre-session RPC signatures |
| 4 | `20260601110000_worker_session_enforcement_foundation.sql` | Drop `_assert_worker_access` helpers |

## Client rollback

Ship MAUI build from git tag **before** security sprint, or revert:

- `SupabaseStorageService.WorkerRpc.cs` (delete)
- `SupabaseStorageService.Media.cs` (delete)
- Restore `_supabase.Rpc(` calls
- Restore Preferences-based session stores
- Restore fail-open `ValidateCodeSessionAsync`

## Combined deploy requirement

**Database + client must match.** Session-enforced RPCs will reject old clients missing `p_session_token`. Storage grants required for worker uploads after storage migration.

## Verification after rollback

1. Code-login worker can punch and view jobs without re-sign-in
2. HR can manage shift templates
3. Leave attachment upload succeeds
4. Portal client/contractor login works
