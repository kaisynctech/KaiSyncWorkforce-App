# Production operations architecture

> **Migration:** `20260529320000_production_ops_foundation.sql` · **Status:** Launch-ready foundation

## Purpose

Commercial production infrastructure for KaiFlow Workforce: app versioning, auto-updates, operational feature flags, structured company settings, backup metadata, and structured error monitoring — without new business modules.

## Components

| Layer | Tables / services |
|-------|-------------------|
| **Versioning** | `app_versions`, `IVersionService`, `UpdatePage` |
| **Updates** | Startup check on `IdEntryPage`; mandatory gate via `UpdatePage` |
| **Feature flags** | `feature_flags` (per-company ops toggles), `IFeatureFlagService` |
| **Company settings** | `company_settings`, `ICompanySettingsService` |
| **Backups** | `backup_jobs`, `company_backups`, `IBackupService` (metadata only) |
| **Errors** | `application_errors`, integrated via `AppTelemetry.LogError` |

## Distinction from SaaS layer

| Concern | SaaS (`saas_*`) | Production ops |
|---------|-----------------|----------------|
| Feature control | Plan entitlements, billing | Operational rollout flags |
| Settings | Subscription limits | Timezone, VAT, branding, payroll/leave prefs |
| Versioning | `saas_company_app_versions` (last seen) | `app_versions` (release catalogue) |

## Client startup flow

```
App launch → IdEntryPage
  → VersionService.CheckForUpdateAsync()
  → mandatory → UpdatePage (blocks)
  → optional  → alert or UpdatePage
HR dashboard load → FeatureFlagService.RefreshAsync()
Errors → AppTelemetry → app_events + application_errors
```

## Related

- [Deployment checklist](../deployment/01-deployment-checklist.md)
- [Production readiness report](../deployment/05-production-readiness-report.md)
- [SaaS platform](./07-saas-platform.md)
