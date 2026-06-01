# Module — Settings

> **Module key:** `settings` · **Permissions:** `settings.view` (owner/admin actions gated further) · **Maturity:** Production (some stubs)

## Purpose

Centralized company administration: module toggles (`enabled_modules`), leave-policy numbers, branch geofencing, plan placeholders, ownership transfer, payroll-settings link, and password change.

## ViewModel & screen

`HrSettingsViewModel` → `Views/Hr/HrSettingsPage.xaml`. Related: `HrPayrollSettingsViewModel` → `HrPayrollSettingsPage.xaml`.

## Module toggles

The toggle list is built from `CompanyModules.All` (18 specs including `suppliers`) and bound to `ObservableCollection<ModuleToggleItem>`. Save: `CompanyModules.ApplyAll` → `UpdateCompanyAsync` persists `Company.EnabledModules`. Fallback writes: Property Management ↔ legacy `properties`; Suppliers ↔ `inventory`; Incidents ↔ `paperless`.

```92:97:KaiFlow.Timesheets.Maui/Helpers/CompanyModules.cs
    public static void SetEnabled(Company company, string key, bool value)
    {
        company.EnabledModules[key] = value;
        if (key == PropertyManagement)
            company.EnabledModules[LegacyProperties] = value;
    }
```

## Company settings surfaced

Name/contact/address (`EditCompanyDetailsAsync`), company-code copy, leave days (`annual_leave_days`/`sick_leave_days` in `CustomSettings`), branch list + geofence (`EnforceBranchSignInRadius`, `BranchSignInRadiusMeters` via `dispatch_settings`), plan codes (placeholder), sign-out, password change, ownership transfer.

## Storage methods

`GetCurrentCompanyAsync`, `UpdateCompanyAsync`, branch CRUD (`GetBranchesAsync`/`CreateBranchAsync`/`UpdateBranchAsync`/`DeleteBranchAsync`), `TransferOwnershipAsync`, `ChangePasswordAsync`, `SignOutAsync`.

## Permissions

`settings.view` for nav (`CanAccessSettings`); destructive actions gated by `IsOwner`/`IsOwnerOrAdmin`.

## Realtime / Offline

Module changes affect nav on the next dashboard refresh (`HrDashboardViewModel.RefreshModuleNavigation`) — not live-pushed.

## Interoperability

- **Controls every other module** via `enabled_modules`.
- **→ Attendance:** branch geofence settings consumed by `BranchGeofenceService`.
- **→ Payroll:** payroll policy via `HrPayrollSettingsPage`.

## Risks & gaps

1. **No branding upload** despite `Company.LogoUrl` existing.
2. **Plan upgrade is a stub** — no billing/payment integration.
3. **Ownership transfer uses a local random code + email compose** — not a server-verified OTP.
4. **Branch reads use try/catch** that swallows missing-table errors (partial-deploy tolerance).
5. **Disabling a module doesn't revoke in-flight permissions** until re-login / permission refresh.
