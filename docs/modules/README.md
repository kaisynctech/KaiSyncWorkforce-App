# Module Documentation Index

KaiFlow is built from **first-class domain modules**. Each is independently navigable, permission-gated, company-toggleable, and emits its own telemetry, while interoperating with others through shared `company_id` scoping and shared models.

Every module document follows the same template:

> **Purpose · Responsibilities · ViewModels · Views/Screens · Storage methods · RPCs · Tables · Permissions · Telemetry · Realtime · Offline · Navigation · Interoperability · Risks/Gaps**

## Module catalog

| Module | Doc | Module key | Maturity |
|--------|-----|------------|----------|
| Attendance & Time Punch | [`attendance.md`](attendance.md) | `attendance` | Production |
| Jobs | [`jobs.md`](jobs.md) | `ticketing` | Production |
| Projects (CRM) | [`projects.md`](projects.md) | `ticketing` + `projects.*` | Production |
| Payroll | [`payroll.md`](payroll.md) | `payroll` | Production (sensitive) |
| Finance | [`finance.md`](finance.md) | `payments` | Production (sensitive) |
| Leave | [`leave.md`](leave.md) | `leave` | Production |
| Scheduling / Shifts | [`scheduling.md`](scheduling.md) | `scheduling` | Production |
| Incidents | [`incidents.md`](incidents.md) | `incidents` | Production |
| Inventory | [`inventory.md`](inventory.md) | `inventory` | Production |
| Suppliers | [`suppliers.md`](suppliers.md) | `suppliers` | Production |
| Contractors | [`contractors.md`](contractors.md) | `contractors` | Production |
| Property Management | [`property-management.md`](property-management.md) | `property_management` | Early-stage |
| Messaging | [`messaging.md`](messaging.md) | `messaging` | Production |
| My PA | [`my-pa.md`](my-pa.md) | `my_pa` | Production |
| Reports | [`reports.md`](reports.md) | `reports` | Expansion area |
| Settings | [`settings.md`](settings.md) | `settings` | Production |
| Employees | [`employees.md`](employees.md) | `employees` | Production |
| Client & Contractor Portals | [`portals.md`](portals.md) | (via `clients` / `contractors`) | Production |

## Interoperability map

```
                         ┌─────────────┐
                         │  COMPANY    │  company_id scopes everything
                         └──────┬──────┘
            ┌───────────────────┼───────────────────────┐
            │                   │                        │
       ┌────▼────┐         ┌────▼─────┐            ┌─────▼─────┐
       │ EMPLOYEE│         │   JOBS   │◄──────────►│ INCIDENTS │
       │ (record)│         │          │  job-linked│           │
       └────┬────┘         └──┬────┬──┘            └───────────┘
            │                 │    │
   ┌────────▼──────┐   ┌──────▼┐  ┌▼────────────┐
   │  ATTENDANCE   │   │ INVENT│  │  PROJECTS   │
   │  (punches)    │   │ -ORY  │  │   (CRM)     │
   └────────┬──────┘   └───┬───┘  └──────┬──────┘
            │              │             │
     ┌──────▼─────┐   ┌────▼────┐   ┌────▼────┐
     │  PAYROLL   │   │SUPPLIERS│   │ CLIENTS │
     │ (consumes  │   │(sourcing│   │ +portal │
     │  punches,  │   │  links) │   └─────────┘
     │  leave)    │   └─────────┘
     └──────┬─────┘
       ┌────▼────┐
       │  LEAVE  │  (feeds payroll: paid/unpaid days)
       └─────────┘

   MY PA  ── aggregates jobs + projects + deals into one timeline
   MESSAGING ── cross-cuts jobs, incidents, clients, company feed
   SETTINGS ── toggles every module above
   REPORTS / TELEMETRY ── observes every module (app_events)
```

## Cross-cutting contracts

- **`company_id`** — universal tenant boundary, present on nearly every table.
- **`Contractor` model** — backs both the Contractors module and the Suppliers module, discriminated by `PartnerKinds`.
- **`Job` model** — referenced by incidents (optional link), inventory usage (allocation), projects (job codes/CRM links), and the My PA timeline.
- **`AppTelemetry` → `app_events`** — every module emits structured events for reporting.
- **Account notifications** — every module can raise notifications surfaced via `AccountNotificationAlertService`.

> Each module doc explains its own slice of these contracts in detail.
