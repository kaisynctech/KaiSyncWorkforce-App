# Authorization Audit — Remediation Report

**Date:** 2026-06-01  
**Migration:** `20260601130000_authorization_audit_revoke_anon.sql`

## Finding

Multiple HR, admin, and platform RPCs were granted `EXECUTE TO anon`, allowing invocation with only the publishable Supabase anon key — no HR JWT or platform admin check at the grant layer.

## Remediation applied

| RPC group | Previous grant | New grant | Validation |
|-----------|----------------|-----------|------------|
| HR shift templates | anon + authenticated | authenticated | HR JWT + in-function checks |
| HR job assignments | anon + authenticated | authenticated | HR JWT |
| Employee shift templates read | anon + authenticated | authenticated | HR JWT |
| HR employee/inventory/punch admin | anon (where present) | authenticated | HR JWT + RLS |
| Platform SaaS admin | authenticated (some implicit) | authenticated + explicit anon revoke | `platform_is_admin()` |

## Preserved anon access (appropriate)

| RPC | Reason |
|-----|--------|
| `employee_*` worker RPCs | Code-login workers (now session-bound) |
| `client_portal_*`, `contractor_portal_*` | External portal codes |
| `employee_sign_in_with_code` etc. | Worker authentication |
| `get_latest_app_version` | Public website downloads |
| `self_register_company` | Onboarding |

## Finance / Payroll / Reporting

No finance or payroll **RPC** anon grants were found. Finance/payroll modules use authenticated PostgREST with company RLS — unchanged.

## Rollback

Re-run grants from source migrations, e.g.:

```sql
GRANT EXECUTE ON FUNCTION public.hr_set_job_assignments(uuid, uuid, uuid, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_shift_templates(uuid) TO anon, authenticated;
-- etc.
```

**Warning:** Rollback restores the pre-audit anon exposure.

## Residual risk

- Portal RPCs still use shared codes (documented in `01-authentication.md`) — out of scope for this sprint.
- Worker RPC security depends on session token rollout + client update deployed together.
