# KaiFlow — Architecture & Roadmap

**Reference benchmark:** PPSP Maintenance Report Strategic Proposal (April 2026)
**Goal:** One field-operations platform that serves *both* full-stack
customers (KaiFlow runs everything) *and* customers like PPSP who already
have ticketing + Power BI and want KaiFlow to plug in alongside.
**Date:** April 2026

---

## 1. Guiding Architectural Principles

Three principles drive every decision below.

### Principle 1 — Modules, not verticals
Property management is *not* a separate product. It is a **module** that any
company can enable. A small lawn-care company and a large estate-managing
agent run the same codebase, the same database, and see different
navigation because their company has different `enabled_modules`.

### Principle 2 — Unified worker model
Every person doing work — whether a salaried employee or an external
contractor — is a **Worker**. One auth identity, one invitation flow, one
login. A `worker_type` column distinguishes employee / contractor /
subcontractor. UI and permissions vary by type; the data model does not
fork.

### Principle 3 — Integrate, don't replace
Some customers already own a ticketing system, a payroll system, or a BI
tool. KaiFlow exposes inbound webhooks, outbound exports, and read-only
SQL views so it slots into whatever stack a customer already has. Customers
who don't have those systems can use KaiFlow's first-party tools.

---

## 2. Where KaiFlow Stands Today

The README undersells what's already built. The codebase and live Supabase
database show KaiFlow is a multi-tenant field operations platform with 39
production tables.

**Already in production schema (RLS enabled on 38/39):**

- Tenancy — `companies`, `hr_users`, `company_branches`,
  `employee_profiles`, `company_employee_types`
- Workforce — `employees`, `punches`, `shifts`, `shift_templates`,
  `shift_assignments`, `shift_events`, `employee_job_requests`
- Operations — `jobs`, `job_cards`, `incidents`, `inventory`,
  `inventory_items`, `job_inventory_usage`, `payment_approvals`
- Customer/CRM — `clients`, `client_deals`, `client_payments`,
  `client_notes`, `client_files`, `sites`
- Paperless — `form_templates`, `form_submissions`, `form_approvals`,
  `document_files`, `handover_packs`
- Compliance — `compliance_requirements`, `employee_compliance_records`
- Automation & integrations — `automation_rules`, `notification_events`,
  `notification_queue`, `scheduled_exports`, `integration_endpoints`,
  `submission_recipients`, `app_release_config`

**Strong foundations to leverage rather than rebuild:**

1. Multi-tenant by `company_id` everywhere.
2. Job → Job Card pattern (planned vs actual, with photos & signatures) —
   exactly the field-execution model maintenance work needs.
3. Form template engine with JSON schema and signature requirements — the
   skeleton for resident feedback forms is already built.
4. `notification_queue` and `automation_rules` — the plumbing for SLA
   alerts and feedback follow-up is already there.
5. `scheduled_exports` and `integration_endpoints` — the plumbing for
   Power BI exports and inbound webhooks is already there.
6. Multi-company-per-worker is already real. `get_my_employee_companies()`
   returns *all* companies a signed-in user works for. Contractors who
   service multiple property managers fit naturally.

---

## 3. The Two Customer Profiles We Must Serve

### Profile A — Full-stack customer (e.g. small services company)
- Has no ticketing system. Wants KaiFlow to do everything.
- Adds *employees*. Pays them. Schedules them. Tracks their compliance.
- Reports inside KaiFlow. No Power BI.
- Modules enabled: ticketing, scheduling, payroll, paperless, compliance,
  reporting. Most things on.

### Profile B — Partial-stack customer (e.g. PPSP)
- Already has a ticketing system and Power BI.
- Adds *contractors* (and a few internal employees). Doesn't run payroll
  for contractors.
- Wants KaiFlow to: onboard and manage contractors, execute work in the
  field (photos, signatures, materials, SLA proof), capture resident
  feedback, manage building compliance & assets, and feed BI.
- Modules enabled: contractors, property_management, asset_compliance,
  paperless. Modules disabled: ticketing (their system is upstream),
  payroll (they pay contractors via invoice).
- KaiFlow ingests tickets via webhook from their ticketing system, and
  exposes read-only SQL views for Power BI.

A single worker can belong to both kinds of company at once — the same
plumber may be a contractor for PPSP and a contractor for another estate
agent — and the existing schema supports that.

---

## 4. The Worker Model

Today everyone is in `employees`. We extend rather than rename.

**Add to `employees`:**

| Column | Purpose |
| --- | --- |
| `worker_type` | enum: `employee`, `contractor`, `subcontractor`. Defaults to `employee` for backwards compatibility. |
| `invited_at` | timestamptz — when HR sent the invite. |
| `invite_status` | enum: `not_sent`, `sent`, `accepted`, `expired`. |
| `invite_token` | short token used in the invite URL (Supabase Auth handles this internally; mirror it for status display). |

**Permissions vary by `worker_type`, not by table:**

- `employee` — sees timesheet, payslip, schedule, compliance.
- `contractor` — sees assigned jobs, invoices, scorecard. No payslip.
- `subcontractor` — sees only the jobs an assigning contractor delegates.

The HR side has a unified "Workers" screen with a type filter (today's
`hr_employees_section.dart` is renamed; underlying table stays
`employees`).

---

## 5. The Invitation Flow (today vs target)

### Today — broken / friction-heavy
1. HR opens "Create employee," types name, surname, email, etc.
2. Row is inserted into `employees` with the email.
3. **No invitation email is sent.**
4. The new hire has to find the app on their own, hit "Sign up," and use
   the matching email + a self-chosen password.
5. After sign-up, `link_employee_profile()` matches them by email and
   links `employees.profile_id` → `auth.users.id`.

### Target — proper invite
1. HR creates worker with email and worker_type.
2. App calls a Supabase **Edge Function** (`invite_worker`) with the
   email, name, company_id.
3. Edge Function uses the service_role key to call
   `supabase.auth.admin.inviteUserByEmail(...)` — Supabase sends the
   invite email with a magic link.
4. New hire clicks the link, lands on a "Set your password" screen,
   confirms.
5. On first sign-in, the existing `link_employee_profile()` RPC runs.
   `employees.profile_id` is populated and they enter their dashboard
   already linked to the company.
6. `employees.invite_status` updates to `accepted`.

A "Resend invite" button on the employee row covers re-sends and expiry.

---

## 6. Module Flags

**Add to `companies`:**

```
enabled_modules jsonb NOT NULL DEFAULT '{
  "ticketing":          true,
  "scheduling":         true,
  "payroll":            true,
  "paperless":          true,
  "compliance":         true,
  "contractors":        false,
  "property_management":false,
  "asset_compliance":   false,
  "reporting_external": false
}'
```

**Behaviour:**

- HR sidebar reads this and renders only enabled sections.
- Onboarding asks 3-4 questions to set sensible defaults (e.g., "Do you
  manage residential complexes?" → flips on property_management +
  asset_compliance + contractors).
- Toggling a module never destroys data. Disabling just hides UI.

---

## 7. Property-Management Module (when enabled)

Concepts that did not exist before:

| New table | Purpose |
| --- | --- |
| `units` | Sub-property within a `site`. `unit_number`, `label`, `occupancy_status`. |
| `residents` | End-user living in a `unit`. Distinct from `clients` (the paying body corporate). |
| `assets` | Physical things: geysers, lifts, electrical boards, fire equipment. Linked to `site` or `unit`. |
| `asset_certificates` | Per-asset certs with `issued_at`, `expires_at`. Drives expiry alerts. |
| `inspection_schedules` | Recurring inspections per asset. Drives compliance calendar. |
| `asset_inspections` | Completed inspections — technician, date, result, photos. |
| `issue_categories` | Per-company taxonomy: plumbing, electrical, geyser, fire, etc. |
| `sla_targets` | Per-priority response & resolution targets per company. |
| `job_feedback` | Post-closure rating + comments from resident. |

**Extend `jobs` with:**

`priority`, `issue_category_id`, `unit_id`, `reporter_id` (resident or
client contact), `opened_at`, `first_response_at`, `closed_at`,
`estimated_cost`, `actual_cost`, `assignee_employee_id` (single owner),
`contractor_id`, `is_callback`, `is_preventive`, `parent_job_id`,
`sla_target_id`.

The two cost columns alone unlock the cost-variance KPI. The four
timestamp columns plus `sla_target_id` unlock the SLA KPIs PPSP currently
cannot measure.

---

## 8. Integration Layer (for partial-stack customers)

### Inbound — ticketing webhooks
- Extend `integration_endpoints` to support `direction = 'inbound'`,
  `provider`, `secret`.
- Edge Function `webhook_ticket_event` validates HMAC, maps payload to a
  `jobs` row (creating, assigning, or closing).
- Each `jobs` row gets `external_ref` (already in mind) so we can
  round-trip updates.

### Outbound — Power BI direct connection
- Create a dedicated Postgres role `bi_reader`.
- Grant `SELECT` only on a curated set of views (Section 9).
- PPSP's analyst points Power BI's native Postgres connector at the views.
- No ETL middleware required.

### Outbound — scheduled exports (fallback)
- `scheduled_exports` already exists. Extend with `format` (csv/parquet),
  `destination` (s3/azure_blob), and a cron schedule. Edge Function runs
  per row.

---

## 9. Reporting Views (the SQL contract for Power BI)

Five views, one per PPSP dashboard page:

1. `v_maintenance_overview` — open vs closed, by category, by complex,
   by priority, 6-month trend.
2. `v_cost_financial` — estimated vs actual, jobs over budget by 20%+,
   monthly spend trend, cost per complex/unit.
3. `v_contractor_scorecard` — jobs per contractor, avg response time, avg
   completion vs SLA, SLA compliance %, callback rate, composite score.
4. `v_compliance_calendar` — inspections scheduled vs completed, overdue
   alerts, certificate expiry per complex.
5. `v_resident_unit` — most active units, issue type by unit matrix,
   satisfaction per complex, repeat-complaint flags.

Each view is `company_id`-scoped via the `bi_reader` role's RLS bypass
limited to those views.

---

## 10. Compressed 4-Day Plan

This is aggressive. Where trade-offs need to be made, smaller scope is
preferred over rushed quality.

### Day 1 — Invite flow + Worker types + Module flags
- Migration: `worker_type`, `invite_status`, `invited_at`, `invite_token`
  on `employees`.
- Migration: `enabled_modules jsonb` on `companies` (with defaults).
- Edge Function `invite_worker` using service_role to send Supabase Auth
  invites.
- Update `hr_create_employee_screen` to call the Edge Function and to
  collect `worker_type`.
- Add "Resend invite" action on employee rows.
- Smoke test: HR creates a worker, email arrives, click → set password →
  land on dashboard.

### Day 2 — Property management schema + Sidebar gating
- Migration: `units`, `residents`, `issue_categories`, `sla_targets`,
  `job_feedback`. Extend `jobs` with priority, four timestamp columns,
  cost columns, single-owner column, callback/preventive/parent flags.
- Update `Job` model and `supabase_timesheet_storage.dart`.
- Update HR sidebar to read `enabled_modules` and conditionally render
  navigation.
- Update `hr_create_job_screen` and `hr_job_details_screen` to capture
  the new fields when property_management is on.

### Day 3 — Asset register, certificates, inspections, feedback flow
- Migration: `assets`, `asset_certificates`, `inspection_schedules`,
  `asset_inspections`.
- Asset register UI inside the property_management module.
- Certificate vault per site/unit with N-day expiry alerts via
  `notification_queue`.
- Auto-feedback flow: closing a job pushes a notification that links to
  a feedback `form_submission`.
- Repeat-issue detector (SQL function): same unit + same category within
  90 days → flag.

### Day 4 — Reporting + integration + verification
- Five reporting views.
- `bi_reader` Postgres role + grants.
- Inbound webhook Edge Function (skeleton + HMAC validation; one provider
  shape supported as proof).
- Update README to match reality.
- Run existing employee-RPC smoke tests + new manual end-to-end smoke.

### Honest trade-offs in 4 days
What probably **does** ship:
- Invite email flow.
- Worker types + module flags.
- Property-management schema and core CRUD screens.
- Asset register + certificate expiry.
- Auto-feedback flow.
- Five reporting views with Power BI direct-connect.
- Inbound webhook skeleton.

What probably **does not** fully ship in 4 days, and is fine to defer:
- Offline-first sync.
- AI triage / voice-to-ticket.
- White-label trustee portal.
- Predictive maintenance.
- Geofenced auto-clock.
- Multi-language resident flows.

These are differentiators (Section 11) — push them to a v2 sprint.

---

## 11. "Best in Class" Differentiators (post-4-day)

Real features that make this best-in-class beyond satisfying PPSP:

1. **Offline-first sync** — Field workers lose signal in basements and
   rural sites. Layer Drift or Isar locally on top of `supabase_flutter`.
2. **AI triage on ticket open** — Use description + photo to suggest
   priority, category, and pre-fill estimated cost from past similar
   jobs.
3. **Voice-to-ticket** — Resident records an issue; transcript +
   auto-categorization create the job.
4. **Strict before/after photo enforcement with EXIF GPS check** —
   verify photo coordinates match `sites.latitude/longitude`.
5. **Live SLA countdown widgets** — Visible timers so technicians and HR
   see breach risk in real time.
6. **White-label trustee portal** — Read-only branded dashboard scoped
   to a complex; replaces Power BI for customers who don't already have
   it.
7. **Predictive maintenance** — After 6 months of data, flag asset
   failure windows (e.g., coastal geysers older than 8 years).
8. **Geofenced auto-clock** — Auto punch in/out using
   `sites.latitude/longitude`.
9. **Multi-language resident reporting** — isiZulu, Afrikaans, Sesotho
   for the South African market.
10. **Hardware integrations** — Smart geyser sensors, lift telemetry,
    fire panel events streamed via `integration_endpoints`.

---

## 12. Codebase Hygiene (fix while in the area)

- `public.inventory` has RLS disabled while every other table has it on.
  Enable it during Day 1.
- `supabase/migrations/` only has 2 files; `sql/` has 26 ad-hoc scripts.
  Migration history should be the source of truth — fold the foundations
  into proper migrations after the 4-day push.
- `windows_old/` is dead — delete.
- Refresh `README.md` once Day 4 is done; current README still says "JSON
  file, no external database," which is wildly out of date.
