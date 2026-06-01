# 02 — Permissions, Roles & RLS

KaiFlow has **two independent gating layers** that both must pass for management functionality to appear:

1. **Company module toggle** — is the feature enabled for this tenant? (`companies.enabled_modules`, read via `CompanyModules.IsEnabled`).
2. **Role permission** — does this user have the permission key? (`PermissionsService.Can(...)`).

A third layer, **Row Level Security (RLS)**, protects the data itself at the PostgreSQL level for authenticated users; untrusted roles are gated inside RPCs instead (see `security/01-authentication.md`).

## Role hierarchy

Roles are stored on `employees.access_level` and modeled by `AccessLevel` (`Models/Employee.cs`):

```
Employee  <  Manager  <  Admin / HrAdmin  <  Owner
```

`TimesheetStateService` exposes coarse role predicates (`IsOwner`, `IsOwnerOrAdmin`, `IsHrOrAbove`, `IsManagerOrAbove`) used for quick UI gating, but fine-grained gating uses **permission keys**.

## Permission keys

Defined in `Helpers/PermissionKeys.cs`. They align with the backend `company_role_permissions` seed:

| Domain | Keys |
|--------|------|
| Projects | `projects.view`, `projects.view_all`, `projects.create`, `projects.edit` |
| Jobs | `jobs.view`, `jobs.view_all`, `jobs.create`, `jobs.edit` |
| Employees | `employees.view`, `employees.create`, `employees.edit` |
| Contractors | `contractors.view`, `contractors.create`, `contractors.edit` |
| Clients | `clients.view`, `clients.edit` |
| Inventory | `inventory.view`, `inventory.edit` |
| Suppliers | `suppliers.view`, `suppliers.edit` |
| Attendance | `attendance.view_team`, `attendance.view_all` |
| Leave | `leave.view_all`, `leave.approve` |
| Payments | `payments.view_payroll`, `payments.approve` |
| Reports | `reports.view_operational`, `reports.view_financial` |
| Settings | `settings.view` |

> **Suppliers** has its own keys but `PermissionsService.CanViewSuppliers` accepts `inventory.view` as a fallback, so companies that adopted Inventory before Suppliers existed don't lose access:
> ```78:79:KaiFlow.Timesheets.Maui/Services/PermissionsService.cs
>     public bool CanViewSuppliers(Employee e) =>
>         Can(PermissionKeys.SuppliersView) || Can(PermissionKeys.InventoryView);
> ```

## How permissions load

`PermissionsService.RefreshAsync(companyId, employee)` (`Services/PermissionsService.cs`):

1. **Owner short-circuit** — owners get *all* keys true, no DB call.
2. **DB load** — calls `IStorageService.GetMyPermissionsAsync(companyId)` (the `my_permissions` RPC). If it returns any rows, those are authoritative.
3. **Defaults fallback** — if the RPC is unavailable (offline / type mismatch) or empty, falls back to `PermissionDefaults.ForAccessLevel(...)`.

```54:59:KaiFlow.Timesheets.Maui/Services/PermissionsService.cs
    public bool Can(string permissionKey)
    {
        if (_employee?.AccessLevel == AccessLevel.Owner)
            return true;
        return _permissions.TryGetValue(permissionKey, out var allowed) && allowed;
    }
```

This **fail-safe defaulting** matters for field resilience: a manager who briefly loses connectivity still gets a sensible permission set instead of being locked out.

## Default permission matrix (fallback)

From `Helpers/PermissionDefaults.cs`. ✔ = granted by default for that role when the DB matrix is unavailable.

| Permission | Owner | HR Admin / Admin | Manager | Employee |
|------------|:-----:|:----------------:|:-------:|:--------:|
| projects.view | ✔ | ✔ | ✔ | ✔ |
| projects.view_all | ✔ | ✔ | – | – |
| projects.create / edit | ✔ | ✔ | ✔ | – |
| jobs.view | ✔ | ✔ | ✔ | ✔ |
| jobs.view_all | ✔ | ✔ | – | – |
| jobs.create / edit | ✔ | ✔ | ✔ | – |
| employees.view/create/edit | ✔ | ✔ | ✔ | – |
| contractors.view/create/edit | ✔ | ✔ | ✔ | – |
| clients.view | ✔ | ✔ | ✔ | ✔ |
| clients.edit | ✔ | ✔ | ✔ | – |
| inventory.view | ✔ | ✔ | ✔ | ✔ |
| inventory.edit | ✔ | ✔ | ✔ | – |
| attendance.view_team | ✔ | ✔ | ✔ | – |
| attendance.view_all | ✔ | ✔ | – | – |
| leave.view_all / approve | ✔ | ✔ | – | – |
| payments.view_payroll | ✔ | ✔ | – | – |
| payments.approve | ✔ | ✔ | – | – |
| reports.view_operational | ✔ | ✔ | ✔ | – |
| reports.view_financial | ✔ | ✔ | – | – |
| settings.view | ✔ | ✔ | – | – |

(_HR Admin and Admin share the same default set — `Admin()` returns `HrAdmin()`._)

Key takeaways:
- **Managers** are operational: they run jobs/projects/employees/inventory and see operational reports, but **cannot** approve leave, see payroll, view financial reports, or access settings.
- **Employees** get read-only visibility into projects/jobs/clients/inventory and nothing administrative.
- **Owner** is unconditionally all-access.

## Convenience predicates

`PermissionsService` exposes intent-named helpers used widely in ViewModels:

| Method | Logic |
|--------|-------|
| `CanManageEmployees` | `employees.create OR employees.edit` |
| `CanApprovePayments` | `payments.approve` |
| `CanViewReports` | `reports.view_operational OR reports.view_financial` |
| `CanManageJobs` | `jobs.create OR jobs.edit` |
| `CanManageClients` | `clients.edit` |
| `CanManageInventory` | `inventory.edit` |
| `CanViewSuppliers` | `suppliers.view OR inventory.view` |
| `CanManageContractors` | `contractors.create OR contractors.edit` |
| `CanAccessSettings` | `settings.view` |
| `CanPunch` | always `true` (any worker may clock) |

## Module toggles (the other gate)

`Helpers/CompanyModules.cs` is the authority on which features a tenant has. Notable compatibility logic:

- **Property Management** reads `property_management`, falling back to the legacy `properties` key; `SetEnabled` writes both.
- **Suppliers** reads `suppliers`, falling back to `inventory` (so existing inventory-enabled tenants get suppliers automatically).
- **Incidents** is enabled by default; legacy tenants that only have a `paperless` flag inherit incidents from it (`IsIncidentsEnabled`).
- Most modules default to **enabled-if-missing** (`DefaultIfMissing = true`); `paperless` defaults **off**.

`SetEnabled` / `ApplyAll` are used by `HrSettingsViewModel` to persist toggles (see `modules/settings.md`).

## RLS model (PostgreSQL)

> Detailed policy enumeration is in `backend/01-database.md`. Summary of the model:

- **Company scoping is the universal isolation boundary.** Virtually every domain table carries `company_id`, and RLS policies restrict authenticated users to rows in companies they belong to.
- **Authenticated (HR/JWT) users** read/write through PostgREST under policies keyed on `auth.uid()` → their `employees`/membership rows → `company_id`.
- **Anon (code-login / portal) users cannot satisfy `auth.uid()`-based policies.** They are intentionally *not* granted broad table access. Instead, all their access is mediated by `security definer` RPCs that:
  1. validate the caller's code/identity,
  2. resolve the company internally,
  3. enforce scoping in the function body, and
  4. return only permitted rows.

This is why RPC routing exists (see `security/01-authentication.md`) and why the RPC catalog (`backend/02-rpcs.md`) is large.

## Gating in practice (example)

The HR sidebar combines both gates per item, e.g. Suppliers appears only when the module is enabled **and** the user can view it:

```585:587:KaiFlow.Timesheets.Maui/ViewModels/Hr/HrDashboardViewModel.cs
        ShowSuppliersNav = CompanyModules.IsEnabled(company, CompanyModules.Suppliers)
            && (_permissions.Can(PermissionKeys.SuppliersView) || _permissions.Can(PermissionKeys.InventoryView));
```

---

_Next: `security/01-authentication.md` for the four login flows and RPC-routing rationale._
