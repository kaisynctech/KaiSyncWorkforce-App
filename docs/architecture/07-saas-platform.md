# SaaS platform architecture

> **Migration:** `20260529300000_saas_platform_foundation.sql` + `20260529310000_saas_employee_count_sync.sql` · **Status:** Foundation (billing provider integration pending)

## Purpose

Transforms KaiFlow from a single-tenant-capable enterprise app into a **multi-tenant SaaS platform** with subscription billing, feature entitlements, usage metering, platform administration, and tenant onboarding — without breaking existing HR auth, code-login, RLS, or module architecture.

## Four-layer access model

| Layer | Authority | Scope |
|-------|-----------|-------|
| **Plan entitlements** | `saas_plans.features_json` + `saas_company_features` | What the customer paid for |
| **Tenant module toggles** | `companies.enabled_modules` | What the company chose to enable |
| **Role permissions** | `PermissionsService` / `my_permissions` RPC | What the user may do |
| **PostgreSQL RLS** | `user_company_ids()` etc. | What data is reachable |

`FeatureAccessService` implements layer 1 on the client. UI gates compose:

```
visible = plan_entitlement ∧ module_toggle ∧ role_permission
data    = RLS (unchanged)
```

## Database tables

| Table | Purpose |
|-------|---------|
| `saas_plans` | Plan catalogue (Starter, Pro, Enterprise) |
| `saas_company_subscriptions` | One row per company |
| `saas_billing_transactions` | Payment history (provider-ready) |
| `saas_feature_flags` | Feature catalogue |
| `saas_company_features` | Per-tenant overrides / beta unlocks |
| `saas_usage_snapshots` | Monthly usage metrics |
| `saas_onboarding_progress` | Setup wizard steps |
| `platform_admins` | KaiFlow staff (not tenant HR) |
| `saas_platform_audit_log` | Admin actions, impersonation, overrides |
| `saas_support_notes` | Internal support notes |
| `saas_release_rollouts` | Staged feature rollouts |
| `saas_company_app_versions` | Per-tenant app version tracking |
| `saas_device_sessions` | Session revocation foundation |

## Key RPCs

- `platform_is_admin()` — staff check
- `saas_is_feature_enabled(company_id, feature_code)` — server-side entitlement
- `saas_get_company_subscription(company_id)` — tenant-readable summary
- `platform_list_companies` — cross-tenant list (admin only)
- `platform_set_subscription_status` — suspend/activate
- `platform_set_company_feature` — remote feature grant
- `saas_upsert_usage_snapshot` — usage metering

## Client services

| Service | Role |
|---------|------|
| `FeatureAccessService` | `IsFeatureEnabled`, `CanAccessModule`, capacity checks |
| `UsageMeteringService` | Buffer + flush monthly snapshots |
| `OnboardingService` | Wizard progress |
| `PlatformSupportService` | Health score, support notes |
| `ReleaseManagementService` | Rollout + app version |
| `PlatformObservabilityService` | Extended telemetry (RPC latency, platform actions) |

## Platform Admin console

`PlatformDashboardPage` — separate from HR dashboard. Requires row in `platform_admins` for `auth.uid()`.

See **`architecture/09-platform-admin.md`** for billing, feedback, health scoring, reporting, and telemetry.

Sections: Overview KPIs + charts, Companies, Subscriptions, Feedback, Health, Reports, Support, Audit.

## Client integration (wired)

| Area | Behaviour |
|------|-----------|
| HR dashboard | Plan-gated sidebar; Finance nav; subscription/trial banners; onboarding prompt; Platform Console link for `platform_admins` |
| Employee dashboard | `FeatureAccessService` + module toggles |
| Settings | Read-only plan from subscription; module toggles clamped to plan entitlements |
| Create / import employees | `CanAddEmployee()` capacity enforcement |
| Exports | `UsageMeteringService` records `export.*` metrics |
| Employee count | DB trigger keeps `current_employee_count` in sync |

Plan self-upgrade from Settings is disabled — changes go through platform billing/support.

## Tenant onboarding

`TenantOnboardingPage` — guided steps from `SaasFeatureCodes.OnboardingSteps`.

## Rollback

See migration file header. Dropping SaaS tables does not affect core workforce data.

## Related

- `security/02-permissions-and-rls.md`
- `modules/reports.md`
- `architecture/06-accounting-integration.md`
