# Module — Reports

> **Module key:** `reports` · **Permissions:** `reports.view_operational`, `reports.view_financial` · **Maturity:** **Enterprise analytics centre**

## Purpose

Reports is the centralized **enterprise analytics and export hub** for HR users. It aggregates cross-module KPIs, native MAUI charts, telemetry dashboards, export queue/history, and operational CSV exports in one tabbed surface.

## ViewModel & screen

`HrReportsViewModel` → `Views/Hr/HrReportsPage.xaml`

### Category structure

| Tab | Content |
|-----|---------|
| **Executive** | Financial, workforce, operations, and system-health KPIs + revenue/attendance charts |
| **Financial** | Finance dashboard KPIs, P&amp;L/cashflow/VAT/aging via `BuildFinanceReportAsync`, supplier spend |
| **Payroll** | Gross/net/OT cost, payroll trend |
| **Workforce** | Attendance, lateness, leave, absenteeism, shift utilization, workload |
| **Operational** | Job completion, SLA breaches, jobs by status, project progress |
| **Incidents** | Open/closed, resolution time, severity breakdown |
| **Inventory** | Stock value, consumption, top items |
| **Contractors** | Active contractors, payouts, performance |
| **Property** | Sites, units, residents, assets, occupancy |
| **Telemetry** | `app_events` adoption, errors, module usage, login trend |
| **Exports** | Export queue, device history, operational CSV export |

## Analytics services (modular)

| Service | Responsibility |
|---------|----------------|
| `ExecutiveAnalyticsService` | Cross-module executive snapshot |
| `FinancialAnalyticsService` | Finance reports + spend charts |
| `WorkforceAnalyticsService` | Attendance / leave / OT analytics |
| `OperationalAnalyticsService` | Jobs, incidents, inventory usage, projects |
| `TelemetryAnalyticsService` | `app_events` dashboards |
| `DomainAnalyticsService` | Payroll, incidents, inventory, contractors, property |
| `ReportFilterService` | Date presets, saved filters (Preferences) |
| `ExportQueueService` | Device-local export queue (scheduled-export ready) |

Aggregations run on background threads via `Task.Run` to avoid blocking the UI.

## Filtering engine

`ReportFilterCriteria` supports date range, branch, department, employee, project, contractor, status, finance category, and site. Built-in presets: 7d, 30d, month, year. Saved presets persist locally.

## Chart infrastructure

Native `GraphicsView` drawables in `Controls/KaiFlowCharts.cs` and `Controls/FinanceCharts.cs`:

- Line, area, bar, stacked bar, donut, sparkline
- Heatmap, timeline (new)
- Dark-mode friendly explicit colours

## Export centre

- `IExportHistoryService` — completed exports on device
- `IExportQueueService` — queued/processing exports
- QuestPDF / ClosedXML via Finance tab P&amp;L export; CSV via Exports tab

## Accounting integration

Finance sync uses `KaiFlow.Accounting` — see `architecture/06-accounting-integration.md`. Finance UI is not coupled to providers.

## Permissions / gating

`reports.view_operational` OR `reports.view_financial` for nav; module gate `CompanyModules.Reports`.

## Related docs

- `reporting/01-reporting-and-telemetry.md`
- `architecture/05-design-system.md`
- `architecture/06-accounting-integration.md`
