# 01 — System Overview

## What the platform is

KaiFlow is a **multi-tenant enterprise workforce-management platform**. It combines time & attendance, field-job management, project/CRM, payroll, leave, incidents, inventory & suppliers, contractor management, property management, messaging, a personal-assistant productivity layer, and reporting into a single application backed by a single shared backend.

The production client is a **.NET MAUI** application (`KaiFlow.Timesheets.Maui`) targeting Windows, Android, iOS, and Mac Catalyst from one codebase. Payroll math lives in a separate referenced class library (`KaiFlow.Payroll`). The backend is **Supabase** (PostgreSQL, GoTrue authentication, Realtime, and Storage).

> The repository also contains Flutter folders. These are **reference only** and must never be treated as production architecture. All statements in this suite refer to the MAUI + Supabase system.

## Enterprise purpose

The platform exists to run the **day-to-day operations of a service/field-work business** end to end:

- Track who is working, where, and for how long (attendance + geofencing).
- Dispatch and execute field jobs and longer-running projects.
- Capture incidents, inventory usage, and site activity from the field.
- Pay people correctly (South-African-style payroll: PAYE, UIF, IRP5).
- Manage leave, scheduling, contractors, suppliers, and properties.
- Give clients and contractors their own self-service portals.
- Surface all of the above to management through dashboards and reports.

## Target users (four audiences, one app)

| Audience | Who | How they sign in | Primary surface |
|----------|-----|------------------|-----------------|
| **HR / Management** | Owners, admins, HR admins, managers | Supabase JWT (email + password) | HR dashboard (sidebar shell) |
| **Field employees** | Permanent / part-time / contract staff | Company code + employee code/PIN → anon session | Employee dashboard (bottom-tab + More) |
| **Contractors** | External service providers | Contractor code → anon session | Contractor portal |
| **Clients** | Customers of the company | Client portal code → anon session | Client portal |

The role hierarchy for management users is expressed in `Models/Employee.cs` (`AccessLevel`) and surfaced through `TimesheetStateService`:

```23:26:KaiFlow.Timesheets.Maui/Services/TimesheetStateService.cs
    public bool IsOwner => CurrentEmployee?.AccessLevelRaw == "owner";
    public bool IsOwnerOrAdmin => CurrentEmployee?.AccessLevelRaw is "owner" or "admin" or "hr_admin";
    public bool IsHrOrAbove => CurrentEmployee?.AccessLevelRaw is "owner" or "admin" or "hr_admin" or "hr";
    public bool IsManagerOrAbove => CurrentEmployee?.AccessLevelRaw is "owner" or "admin" or "hr_admin" or "hr" or "manager";
```

## Operational domains (the module ecosystem)

KaiFlow is organized as a set of **first-class domain modules**, each with independent navigation identity, permissions, telemetry, and (increasingly) reporting. The canonical module keys live in `Helpers/CompanyModules.cs`:

| Module | Key | Notes |
|--------|-----|-------|
| Attendance | `attendance` | Clock-ins, sessions, geofencing |
| Jobs | `ticketing` | Field jobs; employee-created jobs |
| Projects | `ticketing` (+ `projects.view` perm) | CRM-style longer engagements |
| Clients | `clients` | Client register + client portal |
| Payroll | `payroll` | SA payroll engine |
| Leave | `leave` | Applications + approvals |
| Scheduling | `scheduling` | Shift templates + calendar |
| Incidents | `incidents` | Standalone + job-linked |
| Inventory | `inventory` | Stock + usage |
| Suppliers | `suppliers` | Independent module; interoperates with Inventory |
| Contractors | `contractors` | External providers + portal |
| Property Management | `property_management` (legacy `properties`) | Sites/units/residents (early-stage) |
| Asset Compliance | `asset_compliance` | Inspection / certificate tracking |
| My PA | `my_pa` | Personal-assistant productivity |
| Messaging | `messaging` | DMs, feeds, job/incident discussions |
| Paperless Forms | `paperless` | Custom forms (default off) |
| Reports | `reports` | Analytics (expansion area) |
| Employees | `employees` | Employee records |
| Settings | `settings` | Company config + module toggles |

Each company stores its enabled set in the `companies.enabled_modules` JSONB column, read through `CompanyModules.IsEnabled(...)`:

```89:90:KaiFlow.Timesheets.Maui/Models/Company.cs
    public bool IsModuleEnabled(string moduleKey, bool defaultIfMissing = true) =>
        CompanyModules.IsEnabled(this, moduleKey, defaultIfMissing);
```

## Architecture philosophy

1. **Domain-oriented modules.** Each module is a self-contained vertical: its own ViewModels, Views, storage methods, RPCs, tables, permissions, and telemetry. Modules are toggled per company and gated per permission.

2. **One backend, many front doors.** A single Supabase project serves all four audiences. The differentiator is *how* each audience reaches the data: management via authenticated PostgREST + RLS; field/contractor/client users via **security-definer RPCs** under the anon role.

3. **RPC routing for untrusted roles.** Field workers, contractors, and clients run as the anonymous Supabase role. They cannot satisfy row-level-security policies that depend on `auth.uid()`, so all their reads/writes go through `security definer` functions that enforce scoping internally. (See `security/01-authentication.md` and `backend/02-rpcs.md`.)

4. **Company scoping everywhere.** Virtually every table carries a `company_id`. Multi-tenancy isolation is enforced both by RLS (for authenticated users) and inside RPCs (for code-login users).

5. **Offline-tolerant field capture.** Operations a field worker performs (punches, incidents) are queued locally and replayed when connectivity returns (`OfflineQueueService`).

6. **Resilient startup.** The app must paint a window even if the network/Supabase is unavailable; Supabase initialization and realtime are deferred off the UI thread (`App.xaml.cs`, `AppShell.xaml.cs`).

## Interoperability model

Modules stay independent but interoperate through **shared identifiers and shared contracts** rather than duplication:

- **Company scoping** is the universal join key (`company_id`).
- **Jobs ↔ Incidents:** an incident can be standalone or linked to a job.
- **Jobs ↔ Inventory:** inventory usage is allocated against jobs.
- **Inventory ↔ Suppliers:** inventory items reference a supplier; Suppliers remain an independently-navigable module (they are *not* buried inside Inventory). Suppliers are modeled as `Contractor` rows discriminated by `PartnerKinds` (supplier vs contractor).
- **Jobs/Projects ↔ Clients:** projects and jobs can be linked to clients and surfaced in the client portal.
- **My PA ↔ Jobs/Projects/Deals:** the personal-assistant calendar aggregates jobs, projects, and CRM deals into one timeline.
- **Everything ↔ Telemetry:** modules emit structured events to a shared `app_events` telemetry table via `AppTelemetry`.
- **Everything ↔ Messaging/Notifications:** account notifications and threaded discussions are cross-cutting.

## Target outcome

One enterprise workforce ecosystem, composed of multiple professional domain modules that operate independently, integrate naturally through shared scoping and contracts, scale safely, and remain individually maintainable and toggleable.

---

_Next: `02-tech-stack.md` for the technical implementation, or `03-navigation-and-module-hierarchy.md` for the navigation structure._
