# Platform administration & SaaS billing

> **Migration:** `20260529330000_platform_saas_admin_billing.sql` · **Status:** Deployed · **Owner seed:** `kaisynctech@gmail.com`

## Purpose

Production-grade SaaS administration infrastructure for KaiFlow staff — separate from tenant HR. Covers platform KPIs, company management, subscription billing snapshots, customer feedback, health scoring, and platform reporting. Does **not** add new workforce modules.

## Access model

Platform admins are rows in `platform_admins` keyed by `auth_user_id` (Supabase Auth). All cross-tenant RPCs call `platform_is_admin()` and raise if the caller is not staff.

The migration seeds the owner account when `kaisynctech@gmail.com` exists in `auth.users`. Sign in once with that email, then re-run the seed INSERT if the row was missing at deploy time.

## Database

| Table | Purpose |
|-------|---------|
| `company_subscriptions` | Billing snapshot per company (plan, employee count, monthly charge) |
| `platform_feedback` | Tenant feedback, bugs, feature requests |

### KaiFlow Standard pricing

| Component | Value |
|-----------|-------|
| Base plan | R2,500/month |
| Included employees | 25 |
| Additional employees | R99/month each |

Examples:

- 25 employees → R2,500
- 30 employees → R2,500 + (5 × R99) = R2,995
- 100 employees → R2,500 + (75 × R99) = R9,925

SQL function `kaiflow_calculate_monthly_charge()` mirrors the client `BillingCalculationService`.

## Key RPCs

| RPC | Purpose |
|-----|---------|
| `platform_admin_dashboard()` | KPIs + 6-month trend series (companies, revenue, MAU, errors) |
| `platform_search_companies(query, limit, offset)` | Company list with subscription + usage summary |
| `platform_refresh_company_subscription(company_id)` | Recalculate billing snapshot from live employee count |
| `platform_customer_health(company_id)` | Health score (Healthy / At Risk / Inactive) |
| `platform_feedback_stats()` | Backlog counts + top feature requests |

## Client services

| Service | Role |
|---------|------|
| `BillingCalculationService` | `CalculateMonthlyCharge`, `CalculateEmployeeOverage`, `GenerateMonthlyInvoice`, `RefreshCompanySubscriptionAsync` |
| `FeedbackService` | Submit, list, update status, stats |
| `PlatformReportingService` | Snapshot + Excel/PDF export |
| `PlatformSupportService` | Customer health (prefers `platform_customer_health` RPC) |

Storage: `SupabaseStorageService.Platform.cs` — dashboard, search, health, billing refresh, feedback CRUD.

## UI surfaces

### Platform Console (`PlatformDashboardPage`)

Visible from HR sidebar when `ShowPlatformAdminNav` is true (user in `platform_admins`).

Tabs: **Overview** (KPIs + charts), **Companies** (search, suspend/reactivate, refresh billing), **Subscriptions**, **Feedback** (backlog, status updates, release links), **Health**, **Reports** (Excel/PDF export), **Support**, **Audit**.

### Tenant feedback (`SendFeedbackPage`)

Settings → **Send Feedback**. Categories: Bug, Suggestion, Feature Request, Support. Statuses managed by platform admins: New, In Review, Planned, Completed, Closed.

## Customer health scoring

`platform_customer_health` aggregates:

- Last login (from `app_events`)
- Active users (30-day window)
- Attendance, payroll, finance usage signals
- Error count (`application_errors`)
- Feedback count (`platform_feedback`)

Returns `CustomerHealthScore` with status **Healthy**, **At Risk**, or **Inactive**.

## Telemetry (`AppTelemetry`)

| Event | When |
|-------|------|
| `feedback_submitted` | Tenant submits feedback |
| `feedback_status_updated` | Admin changes feedback status |
| `subscription_created` | First billing snapshot for a company |
| `subscription_updated` | Billing snapshot refreshed |
| `billing_calculated` | Monthly invoice generated |
| `company_suspended` | Platform admin suspends tenant |
| `company_reactivated` | Platform admin reactivates tenant |

## Related docs

- `architecture/07-saas-platform.md` — entitlements, plans, tenant onboarding
- `architecture/08-production-operations.md` — versioning, errors, backups
- `backend/03-migrations.md` — full migration index

## Out of scope (intentional)

- Payment provider integration (Stripe / PayFast)
- Per-company feature voting UI
- New workforce domain modules
