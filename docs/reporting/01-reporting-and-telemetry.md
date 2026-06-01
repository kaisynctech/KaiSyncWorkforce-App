# 08 — Reporting, Analytics & Telemetry

This document covers (a) the **telemetry pipeline** that is already production-grade, (b) **current reporting capabilities** across modules, (c) **KPI/data sources**, and (d) the **enterprise reporting direction** (Reports is a designated expansion area).

## Telemetry architecture (production)

`Services/AppTelemetry.cs` is a singleton structured-telemetry sink with a debug channel and a **durable Supabase `app_events` sink** (created by the `app_events_telemetry` migration).

### API

| Method | Level | Use |
|--------|-------|-----|
| `LogEvent(name, props)` | `info` | Domain events (e.g. `my_jobs_query`, `realtime_subscribed`, `offline_punch_replay`) |
| `LogSuccess(action, ctx, props)` | `info` | Successful operations |
| `LogWarning(message, ctx, props)` | `warning` | Recoverable problems (e.g. realtime subscribe failed) |
| `LogError(ex, ctx, props)` | `error` | Exceptions |
| `LogPageView(pageName)` | `info` | Screen views |

Payloads are `Dictionary<string,string>` serialized into a JSON `meta` column.

### Dual persistence path (illustrates the platform's auth model)

`AppTelemetry.PersistAsync` chooses the write path based on **who is signed in** — the same principle that governs all data access:

```88:118:KaiFlow.Timesheets.Maui/Services/AppTelemetry.cs
            if (string.IsNullOrEmpty(authUserId) && companyId.HasValue && employeeId.HasValue)
            {
                await _supabase.Rpc("employee_log_app_event", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ...
                });
                return;
            }
            ...
            await _supabase.From<AppEvent>().Insert(row);
```

- **Code-login workers** (no `auth.uid`) write via the **`employee_log_app_event` security-definer RPC**.
- **HR/JWT users** write via an authenticated PostgREST insert into `app_events` (`Models/AppEvent.cs`).

This means telemetry is captured for *all four audiences* under one schema, and is a textbook example of the RPC-routing strategy described in `security/01-authentication.md`.

### `app_events` schema (sink)

`Models/AppEvent.cs` maps the table: `company_id`, `auth_user_id` (or employee-scoped via RPC), `screen`, `action`, `level`, `error_text`, `meta` (JSON), `app_version`, timestamp. This is the **single source of truth for product analytics, error monitoring, and audit-style event history**.

### Representative event names

`offline_punch_enqueued`, `offline_punch_replay`, `offline_incident_enqueued`, `offline_incident_replay`, `realtime_connected`, `realtime_subscribed`, `realtime_unsubscribed`, `realtime_account_subscribed`, `my_jobs_query`, page views, plus module-specific events. Search `LogEvent(` / `LogSuccess(` for the full set.

## Current reporting capabilities

Reporting is **centralized in the Reports module** (`HrReportsPage`) with eleven category tabs:

| Tab | Capability |
|-----|------------|
| Executive | Cross-module financial, workforce, operations, system-health KPIs |
| Financial | P&amp;L, cashflow, VAT, AR/AP aging, supplier/contractor spend |
| Payroll | Gross/net/OT analytics |
| Workforce | Attendance, lateness, leave, absenteeism, utilization |
| Operational | Job completion, SLA, projects, site activity |
| Incidents | Severity, resolution, trends |
| Inventory | Stock value, consumption |
| Contractors | Payouts, performance |
| Property | Sites, units, residents, occupancy |
| Telemetry | `app_events` adoption, errors, module usage |
| Exports | Export queue, history, operational CSV |

Modular aggregation services in `Services/Reporting/` run off the UI thread. See `modules/reports.md`.

Distributed KPIs also remain on module dashboards (HR Overview, Finance, Payroll).

### Export infrastructure

`Services/ExportService.cs` (`IExportService`) provides document/data export:
- **PDF** via **QuestPDF** (payslips, formatted reports).
- **Excel** via **ClosedXML**.
- **Bank payment files** and **IRP5** via the `KaiFlow.Payroll` formatters.

## KPI sources

KPIs are derived live from domain tables (scoped by `company_id`) and from `app_events`:

| KPI family | Source |
|------------|--------|
| Attendance / hours / lateness | `time_punches` + sessions |
| Payroll cost / net pay / statutory | payroll results (`KaiFlow.Payroll`) |
| Job/project throughput & status | `jobs`, `projects` |
| Incident volume / resolution time | `incident_reports`, `incident_status_history` |
| Leave liability / pending approvals | `leave_requests` |
| Engagement / errors / adoption | `app_events` telemetry |

## Graph / chart infrastructure

Native MAUI charts via `GraphicsView` + `IDrawable` drawables in `Controls/KaiFlowCharts.cs` and `Controls/FinanceCharts.cs` (no third-party chart library). Includes line, area, bar, stacked, donut, sparkline, heatmap, and timeline drawables. Used on Reports (all analytics tabs) and the Finance dashboard.

## Enterprise reporting direction

The Reports module now implements the **enterprise analytics centre** foundation:

1. ✅ Centralized cross-module Reports hub with category tabs
2. ✅ Native MAUI chart infrastructure (GraphicsView drawables)
3. ✅ Filter presets + saved filters (`ReportFilterService`)
4. ✅ Export centre with queue + history
5. ✅ Accounting sync foundation (`KaiFlow.Accounting`) — see `architecture/06-accounting-integration.md`

**Remaining:**

- Server-side reporting views / RPC aggregations for very large datasets
- Scheduled/emailed reports
- Durable accounting sync queue in Supabase
- Live Xero / Sage / QuickBooks providers

## Report generation flow (target)

```
Filters (date / scope / module)
        │
        ▼
IStorageService aggregation (RPC for code-login / PostgREST for HR)
        │
        ▼
HrReportsViewModel builds KPI + series view-models
        │
        ├──► MAUI native charts / KPI tiles (on screen)
        └──► ExportService → QuestPDF (PDF) / ClosedXML (Excel)
```

## Gaps / risks

- Aggregations are **client-side** — large tenants may need server-side reporting views.
- **No scheduled/emailed reports** yet (export queue architecture is in place locally).
- Telemetry is **fire-and-forget**; `app_events` is best-effort, not guaranteed-delivery.
- Accounting providers (Xero/Sage/QuickBooks) are **not implemented** — only `ManualAccountingProvider`.
