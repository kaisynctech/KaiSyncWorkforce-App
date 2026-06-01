# KaiFlow Enterprise Workforce Platform — Documentation Suite

> **Production system:** `KaiFlow.Timesheets.Maui` (.NET MAUI client) + `KaiFlow.Payroll` (calculation library) + Supabase (PostgreSQL, Auth, Realtime, Storage).
>
> **Flutter folders in this repository are REFERENCE ONLY and are not production architecture.**

This suite documents the real, as-built architecture of the KaiFlow platform, traced directly from the production codebase and the Supabase migration history (161 migrations as of this pass).

---

## How to read this suite

| Start here if you are… | Read |
|------------------------|------|
| New to the platform | `architecture/01-system-overview.md` |
| A .NET/MAUI engineer | `architecture/02-tech-stack.md` |
| Working on navigation / modules | `architecture/03-navigation-and-module-hierarchy.md` |
| A backend / database engineer | `backend/01-database.md`, `backend/02-rpcs.md`, `backend/03-migrations.md` |
| Working on auth / access | `security/01-authentication.md`, `security/02-permissions-and-rls.md` |
| Implementing a feature in a module | `modules/<module>.md` |
| Tracing an end-to-end flow | `workflows/01-core-workflows.md` |
| Working on dashboards / exports | `reporting/01-reporting-and-telemetry.md` |
| Building UI / using shared controls | `architecture/05-design-system.md` |
| SaaS platform / billing / entitlements | `architecture/07-saas-platform.md` |
| Platform admin / billing / feedback | `architecture/09-platform-admin.md` |
| Production launch / deployment | `deployment/05-production-readiness-report.md`, `architecture/08-production-operations.md` |
| Pilot go-live | `deployment/pilot-readiness-review.md`, `deployment/release-process.md` |
| Windows installer / Android APK | `deployment/windows-installer.md`, `deployment/android-release.md` |
| Release hosting (Supabase Storage) | `deployment/release-hosting.md` |
| Platform admin smoke test | `deployment/06-platform-admin-smoke-test.md` |
| Client download & onboarding email | `deployment/07-client-onboarding-pack.md` |
| Working on sync / connectivity | `architecture/04-offline-and-realtime.md` |
| Planning work | `roadmap/01-risks-and-technical-debt.md`, `roadmap/02-enterprise-roadmap.md` |

---

## Document map

```
docs/
├── README.md                         ← this index
├── architecture/
│   ├── 01-system-overview.md          System purpose, domains, philosophy, interoperability
│   ├── 02-tech-stack.md               .NET MAUI, MVVM, Supabase, DI, config, persistence
│   ├── 03-navigation-and-module-hierarchy.md   HR sidebar, employee nav, portals, routes
│   ├── 04-offline-and-realtime.md     Offline queue, realtime subscriptions, resilience
│   └── 05-design-system.md            Design tokens, reusable controls, native charts
│   └── 06-accounting-integration.md Provider-agnostic accounting sync foundation
│   └── 07-saas-platform.md            Subscriptions, entitlements, platform admin
│   └── 08-production-operations.md    Versioning, updates, backups, error monitoring
│   └── 09-platform-admin.md           Platform console, billing, feedback, health
├── deployment/
│   ├── 01-deployment-checklist.md
│   ├── 02-release-checklist.md
│   ├── 03-rollback-checklist.md
│   ├── 04-backup-checklist.md
│   ├── 05-production-readiness-report.md
│   ├── 06-platform-admin-smoke-test.md
│   ├── 07-client-onboarding-pack.md
│   ├── windows-installer.md
│   ├── android-release.md
│   ├── release-hosting.md
│   ├── release-process.md
│   └── pilot-readiness-review.md
├── backend/
│   ├── 01-database.md                 Tables, relationships, UUID strategy, company scoping
│   ├── 02-rpcs.md                     Security-definer RPC catalog by domain
│   └── 03-migrations.md               Migration history + the most important migrations
├── security/
│   ├── 01-authentication.md           HR JWT, employee code-login, contractor/client portals
│   └── 02-permissions-and-rls.md      Permission matrix, role hierarchy, RLS model
├── modules/
│   ├── README.md                      Module index + the first-class module list
│   ├── attendance.md
│   ├── jobs.md
│   ├── projects.md
│   ├── payroll.md
│   ├── leave.md
│   ├── scheduling.md
│   ├── incidents.md
│   ├── inventory.md
│   ├── suppliers.md
│   ├── contractors.md
│   ├── property-management.md
│   ├── messaging.md
│   ├── my-pa.md
│   ├── reports.md
│   ├── settings.md
│   ├── employees.md
│   └── portals.md                     Client portal + contractor portal
├── workflows/
│   └── 01-core-workflows.md           End-to-end flow walkthroughs
├── reporting/
│   └── 01-reporting-and-telemetry.md  Current reporting, telemetry, KPI sources, direction
└── roadmap/
    ├── 01-risks-and-technical-debt.md
    └── 02-enterprise-roadmap.md
```

---

## One-paragraph system summary

KaiFlow is a multi-tenant enterprise workforce platform. A single .NET MAUI application serves four distinct audiences — **HR/management**, **field employees**, **external contractors**, and **clients** — each with its own authentication path and navigation surface. The backend is Supabase (PostgreSQL + GoTrue auth + Realtime + Storage). Management users authenticate with standard Supabase JWT; field workers, contractors, and clients authenticate with **codes** and operate through **security-definer RPCs** rather than direct table access, because they run under the anonymous Supabase role. The platform is organized as a set of **first-class, independently-navigable domain modules** (Attendance, Jobs, Projects, Payroll, Leave, Incidents, Inventory, Suppliers, Contractors, Property Management, Messaging, My PA, Reports, Settings, Employees) that interoperate through shared company scoping and shared data contracts, while remaining individually toggleable per company.

---

_Generated from a full-codebase architecture audit. Each document cites real files, classes, RPCs, tables, and migrations. Where a capability is incomplete or carries risk, it is called out explicitly rather than glossed over._
