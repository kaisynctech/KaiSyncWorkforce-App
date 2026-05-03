# KaiFlow / KaiSync Workforce

A Flutter field-operations platform with a Supabase backend. Companies sign
up, invite their workforce, schedule work, capture jobs in the field with
photos and signatures, run payroll, and track compliance — all from one
multi-tenant codebase. Customers who manage residential complexes can turn
on the Property Management module to add units, residents, asset
compliance, and contractor scorecards on top.

## Two customer profiles, one product

KaiFlow is shaped to serve both:

1. **Full-stack customers** (small services companies) — KaiFlow runs the
   whole operation: ticketing, scheduling, payroll, paperless ops, in-app
   reporting.
2. **Partial-stack customers** (managing agents like PPSP) — KaiFlow plugs
   alongside an existing ticketing system and BI tool. KaiFlow handles
   contractor onboarding, in-field execution, asset compliance, and
   resident feedback; tickets ingest via webhook; reporting flows out
   through SQL views to Power BI.

Behaviour is controlled per-company by `companies.enabled_modules` (a
JSONB flag set), not by hardcoded verticals. See
[`docs/kaiflow_vs_ppsp_gap_analysis.md`](docs/kaiflow_vs_ppsp_gap_analysis.md)
for the architectural rationale and roadmap.

## Modules

Each company toggles modules independently:

- `ticketing` — jobs / job cards lifecycle
- `scheduling` — recurring shifts and assignments
- `payroll` — monthly salary, hourly rate, payment approvals
- `paperless` — form templates, submissions, signatures
- `compliance` — employee compliance records (certificates, expiry alerts)
- `contractors` — third-party service providers with their own scorecard
- `property_management` — sites → units → residents
- `asset_compliance` — geysers, lifts, fire panels with inspection
  schedules and certificates
- `reporting_external` — Power BI / Metabase direct-connect via SQL views

When a module is off, its sidebar entry hides and its routes are skipped.
Toggle from the database for now (settings UI lands in a follow-up):

```sql
UPDATE companies
SET enabled_modules = enabled_modules
  || '{"property_management":true,"contractors":true,"asset_compliance":true}'::jsonb
WHERE id = <company_id>;
```

## Workforce

Every person doing work is a Worker. The `employees` table carries a
`worker_type` column with values `employee`, `contractor`, or
`subcontractor`. Permissions and visible UI vary by type; the data model
does not fork.

A single auth identity can belong to multiple companies — useful for
contractors who service several managing agents. The
`get_my_employee_companies()` RPC returns every company context for the
signed-in user.

## Invitation flow

HR creates a worker with an email. The Flutter app calls the
`invite_worker` Supabase Edge Function, which uses the service-role key
to send a Supabase Auth invitation. On first sign-in the
`link_employee_profile()` RPC links the auth user to the employee row
and marks the invite as accepted.

If the email already has a Supabase Auth account, the function falls
back to a magic-link email so existing users can still log in.

## Reports & BI

Five Postgres views power BI dashboards (Power BI / Metabase / Looker):

- `v_jobs_enriched` — base view: every job with computed SLA timings,
  cost variance, and joined site / unit / category / assignee / reporter
- `v_maintenance_overview` — page 1: monthly counts, priority mix,
  callback / preventive ratio, SLA compliance %
- `v_cost_financial` — page 2: estimated vs actual, jobs over budget,
  cost per site
- `v_contractor_scorecard` — page 3: per-provider response time,
  resolution time, SLA compliance, callback rate
- `v_resident_unit` — page 5: per-unit ticket volume, repeat-issue flag,
  satisfaction score, feedback coverage

Page 4 (compliance & inspections) lands when the asset register module
is built.

For Power BI direct-connect: point its native Postgres connector at
your Supabase database and select the `v_*` views. RLS scopes results
to the calling user's company.

## How to run

```bash
cd timesheets
flutter pub get
flutter run
```

Allow location when prompted (used for sign-in / sign-out place).

Set the Supabase URL and anon key in `lib/main.dart` (or via
`--dart-define`). Email-based invitations require an SMTP provider in
Supabase Auth → Emails → SMTP Settings (the default Supabase sender is
rate-limited to a few emails per hour).

## Database

Schema is managed via versioned migrations in `supabase/migrations/`.
Recent additions:

- `20260428093155_remote_schema.sql` — initial schema baseline
- `20260428120000_employee_email_auth.sql` — email auth + profile linking
- `20260429120000_worker_type_and_invites.sql` — worker types + invite
  tracking + RLS hygiene
- `20260429140000_module_flags_and_property_management.sql` —
  `enabled_modules`, units, residents, issue categories, SLA targets,
  job feedback, plus 16 new columns on `jobs` for SLA / cost tracking
- `20260429160000_reporting_views.sql` — five BI views

Edge Functions live in `supabase/functions/`:

- `invite_worker` — service-role-backed invitation sender

## Project layout

- `lib/theme/` — design tokens (colors, typography, responsive helpers)
- `lib/models/` — Employee, TimePunch, Client, Site, Job, JobCard,
  IncidentReport, InventoryItem/Usage, PaymentApproval, Form templates,
  Unit, Resident, …
- `lib/services/` — `supabase_timesheet_storage.dart` (Supabase access
  layer), `location_service.dart`, `export_service.dart`,
  `app_telemetry.dart`
- `lib/providers/` — `timesheet_provider.dart` (state + module flags),
  `job_provider.dart`
- `lib/screens/` — HR sections (employees, clients, jobs, incidents,
  inventory, payments, scheduling, reports, settings,
  **properties**, **residents**), employee-facing screens (login,
  punch, my jobs, my shifts, incidents, job card)
- `sql/` — ad-hoc schema scripts predating versioned migrations; being
  consolidated

## Release operations

- Release checklist: `docs/release_checklist.md`
- Supabase RPC smoke tests:
  `sql/employee_rpc_smoke_test.sql`,
  `sql/employee_rpc_negative_smoke_test.sql`
- Self-service onboarding SQL: `sql/self_register_company.sql`
- Roadmap & architecture: `docs/kaiflow_vs_ppsp_gap_analysis.md`
