# Module — Finance

> **Module key:** `payments` (Finance surfaces are gated alongside the existing Payments/Payroll nav) · **Permissions:** `payments.view_payroll`, `payments.approve` (finance approvals reuse the payments approval gate) · **Maturity:** Production (financially sensitive — change with care)

## 1. Overview

Finance is a **first-class enterprise module** that expands the old payroll-centric *Payments* area into a full financial-operations system. Where the original surface only generated and released payslips, Finance now covers the company's **operational money-in / money-out**: client invoicing, supplier bills, contractor payouts, VAT, cashflow, AR/AP, profitability, financial approvals, and financial reporting.

### Separation of concerns

KaiFlow keeps two financial engines deliberately isolated:

| Library | Responsibility | Posture |
|---------|----------------|---------|
| **`KaiFlow.Payroll`** | Statutory salary engine — PAYE/UIF, payslips, IRP5, bank files | Order-sensitive, never refactor without calculation tests |
| **`KaiFlow.Finance`** | Operational/accounting finance — VAT, invoice/bill totals, payouts, period summaries | Pure, deterministic, unit-tested in isolation |

Payroll computes **what a worker is paid**; Finance computes **what the business invoices, owes, collects, and remits**. The two never share calculation code — Finance has no knowledge of statutory tax tables, and Payroll has no knowledge of VAT or AR/AP. They meet only at the reporting layer (payroll cost is one input to a P&L), never in the math.

### Supported domains

- **Client invoicing** — multi-line invoices with per-line VAT, discounts, partial payments, overdue detection.
- **Supplier invoices** — accounts-payable bills with approval and payment.
- **Contractor payouts** — subcontractor settlements with retention and approval.
- **VAT** — inclusive/exclusive/reverse calculation, configurable per company, zero-rated/exempt support, VAT periods.
- **Cashflow** — a universal `finance_transactions` ledger of every money movement.
- **AR / AP** — receivable aging and payable obligations.
- **Profitability** — revenue vs expense (incl. payroll cost) over a period.
- **Finance approvals** — supplier-payment, payout, and refund approval workflows with an immutable audit trail.
- **Finance reporting** — P&L, VAT summary, AR aging, AP, cashflow, revenue/expense trend, spend analysis — exportable to PDF/Excel.

---

## 2. Architecture

Finance follows the same layering as Payroll: a **pure calculation library** plus MAUI-side ViewModels/pages and a partial-class extension of the existing storage service.

### `KaiFlow.Finance` calculation library

A standalone project (`KaiFlow.Finance/KaiFlow.Finance.csproj`), referenced by the MAUI app, holding all money math. It is pure (no UI, no Supabase) and unit-tested by `KaiFlow.Finance.Tests`.

| File | Responsibility |
|------|----------------|
| `VatCalculator.cs` | Static, pure VAT math — exclusive/inclusive/reverse + deterministic rounding |
| `FinanceCalculationHelper.cs` | Higher-level helpers (invoice totals, discounts, partial-payment state) on top of `VatCalculator` |
| `TaxCalculationService.cs` | DI-friendly service holding the **per-company default VAT rate** |
| `VatConstants.cs` | `DefaultSouthAfricaVatRate` (0.15), `MoneyDecimals`, default currency |
| `TaxType.cs` | `standard` / `zero_rated` / `exempt` / `no_vat` enum + `AppliesVat()` extension |
| `VatCalculationResult.cs` | Immutable result records (`VatCalculationResult`, `InvoiceTotals`, `VatPeriodSummary`, `PaymentState`) |

**Deterministic `decimal` calculations.** Unlike the legacy `double`-based codepaths, Finance uses `decimal` end-to-end in C# and `numeric(14,2)` / `numeric(6,4)` in PostgreSQL. All rounding is **half-away-from-zero** to a fixed precision, so results are stable and auditable across runs:

```38:53:KaiFlow.Finance/VatCalculator.cs
    public static VatCalculationResult CalculateVatExclusive(decimal subtotal, decimal vatRate, TaxType taxType = TaxType.Standard)
    {
        var rate = EffectiveRate(vatRate, taxType);
        var sub = RoundFinancialValues(subtotal);
        var vat = RoundFinancialValues(sub * rate);
        var total = RoundFinancialValues(sub + vat);
        return new VatCalculationResult
        {
            Subtotal = sub,
            VatRate = rate,
            VatAmount = vat,
            TotalAmount = total,
            IsVatInclusive = false,
            TaxType = taxType
        };
    }
```

`TaxCalculationService` is registered as a **singleton** in `MauiProgram.cs`; the seven Finance ViewModels and pages are registered **transient**.

### MAUI layer

| Layer | Files | Role |
|-------|-------|------|
| Models | `Models/Finance/*` (`FinanceInvoice`, `FinanceInvoiceLine`, `SupplierInvoice`, `ContractorPayout`, `FinanceTransaction`, `FinanceVatPeriod`, `FinanceAuditEntry`, `FinanceReport`, `FinanceDtos`) | Postgrest-mapped entities + display helpers |
| Storage | `Services/SupabaseStorageService.Finance.cs`, `.FinanceReports.cs`, `.FinanceApprovals.cs` (partial classes) | CRUD, totals sync, payments, dashboard aggregation, reports, approvals |
| ViewModels | `ViewModels/Finance/*` (Dashboard, Invoices, InvoiceDetail, SupplierInvoices, ContractorPayouts, Vat, Cashflow, Reports, Approvals) | MVVM with live VAT recalculation (`InvoiceLineEditor`) |
| Pages | `Views/Finance/*` | Enterprise UI — KPI cards, data tables, charts |
| Charts | `Controls/FinanceCharts.cs` (`BarSeriesDrawable`, `CategoryBarsDrawable`) | Native `GraphicsView` drawables (no third-party chart dependency) |
| Routes | `ViewModels/Finance/FinanceRoutes.cs` + `AppShell.xaml.cs` | Shell route registration |

The storage service is intentionally **split into finance partial-class files** rather than growing the existing ~5,500-line monolith further (see risk M1).

### Export & telemetry integration

- **Export** reuses the existing `IExportService` — **PDF via QuestPDF**, **Excel via ClosedXML** — so finance reports share the same save/share UX as payroll.
- **Telemetry** reuses `AppTelemetry` → `app_events`; every finance mutation emits a structured event (see §9).

---

## 3. Database Tables

All Finance tables follow the platform's **UUID strategy** (`uuid` PKs `default gen_random_uuid()`), are **company-scoped** (`company_id uuid not null references companies(id)`), and are **RLS-enabled** with the standard authenticated policy (`company_id in (select public.user_company_ids())`). Legacy bigint `business_quotes` / `business_invoices` tables are **left untouched** — Finance is a clean UUID-native set.

Created by migration `supabase/migrations/20260529200000_finance_module_foundation.sql` (tables) and `..._20260529210000_finance_approvals_audit.sql` (audit + approval columns).

| Table | Purpose | Key fields | Statuses |
|-------|---------|-----------|----------|
| `finance_invoices` | Client (AR) invoice header | `invoice_number`, `subtotal`, `vat_rate`, `vat_amount`, `total_amount`, `amount_paid`, `balance_due`, `is_vat_inclusive`, `tax_type`, `discount_amount`, `issue_date`, `due_date`, `paid_date` | `draft`, `sent`, `viewed`, `partially_paid`, `paid`, `overdue`, `cancelled` |
| `finance_invoice_lines` | Per-line items of an invoice | `invoice_id` (FK), `description`, `quantity`, `unit_price`, `vat_rate`, `vat_amount`, `line_total`, `tax_type` | — |
| `supplier_invoices` | Supplier (AP) bill | `supplier_id`, `subtotal`/`vat`/`total`, `approval_status`, `approved_by`, `approved_at`, `paid_at`, `attachment_urls`, `notes` | `pending` → `approved`/`rejected` → paid |
| `contractor_payouts` | Subcontractor settlement | `contractor_id`, `job_id`, `subtotal`/`vat`/`total`, `retention_amount`, `payout_status`, `approval_status`, `approved_by`, `approved_at`, `paid_at`, `payout_date` | `pending`, `approved`, `paid`, `cancelled` |
| `finance_transactions` | **Universal ledger** — one row per money movement | `direction` (in/out), `amount`, `category`, `source_type`, `source_id`, `occurred_at`, `reference` | — |
| `finance_vat_periods` | VAT reporting period | `period_start`, `period_end`, `output_vat`, `input_vat`, `net_vat`, `status` | open / filed |
| `finance_audit_log` | **Immutable** finance action history | `entity_type`, `entity_id`, `action`, `actor_id`, `actor_name`, `old_values`, `new_values`, `created_at` | insert-only |

### Relationships

```
companies ──1:n── finance_invoices ──1:n── finance_invoice_lines
    │                  │
    │                  └─ client_id ─► clients          (AR side)
    │
    ├──1:n── supplier_invoices ── supplier_id ─► contractors (partner_kind supplier/both)
    ├──1:n── contractor_payouts ── contractor_id ─► contractors ── job_id ─► jobs
    ├──1:n── finance_transactions (source_type/source_id loosely reference any of the above)
    ├──1:n── finance_vat_periods
    └──1:n── finance_audit_log (insert-only)

companies.is_vat_registered / vat_number / default_vat_rate / finance_vat_inclusive_default
contractors.is_vat_registered / vat_number / default_vat_rate   (Phase 3 columns)
```

### Critical schema notes

- **`finance_transactions` is the cashflow source of truth.** Invoice payments, supplier payments, payouts, and refunds all write a ledger row so cashflow/VAT reporting reads one table rather than reconciling four.
- **`finance_audit_log` is insert-only** by RLS policy (no update/delete grant) — see §8.
- **Balances are server-recomputable**: `balance_due` / `amount_paid` are maintained by the storage layer through `KaiFlow.Finance` so the math is identical to the UI preview.

---

## 4. VAT System

VAT is centralised in `VatCalculator`. The default rate is **South Africa 15%** (`VatConstants.DefaultSouthAfricaVatRate`), but the **effective rate is configurable per company** (`companies.default_vat_rate`, surfaced through `TaxCalculationService`) and per partner (`contractors.default_vat_rate`).

| Mode | Method | Behaviour |
|------|--------|-----------|
| **Exclusive** | `CalculateVatExclusive(subtotal, rate)` | VAT added on top of a net subtotal |
| **Inclusive** | `CalculateVatInclusive(total, rate)` | VAT extracted from a gross total |
| **Reverse** | `ReverseCalculateVat(totalInclusive, rate)` | Returns only the embedded VAT portion |
| **Zero-rated / Exempt** | `EffectiveRate(rate, taxType)` | Resolves to **0** when `taxType` is `zero_rated`, `exempt`, or `no_vat` |

### Worked examples (15%)

| Input | Mode | Subtotal | VAT | Total |
|-------|------|---------:|----:|------:|
| R1 000 net | Exclusive | 1 000.00 | 150.00 | 1 150.00 |
| R1 150 gross | Inclusive | 1 000.00 | 150.00 | 1 150.00 |
| R1 150 gross | Reverse VAT | — | 150.00 | — |
| R1 000 net, zero-rated | Exclusive | 1 000.00 | 0.00 | 1 000.00 |

Rates are **normalised** so callers may pass either a fraction (`0.15`) or a percentage (`15`) — `NormalizeRate` always returns the fraction form. All outputs are rounded half-away-from-zero to 2 decimals.

---

## 5. Invoice Lifecycle

`finance_invoices.status` transitions:

```
 draft ──issue──► sent ──client opens──► viewed
   │                │                      │
   │                └──────────┬───────────┘
   │                           │
   │                    record payment
   │                           ▼
   │                  partially_paid ──balance hits 0──► paid
   │                           │
   │                  (due_date passed, balance>0)
   │                           ▼
   │                        overdue
   └───────────────────────► cancelled  (terminal)
```

- **Partial payments**: each payment reduces `balance_due` and increases `amount_paid`; status becomes `partially_paid` while `0 < balance_due < total_amount`, then `paid` when `balance_due` reaches 0 (`paid_date` stamped).
- **`balance_due`** is derived as `total_amount − amount_paid` and kept in sync by the storage layer using `KaiFlow.Finance`, never hand-edited.
- **Overdue detection**: an outstanding invoice past `due_date` is treated as `overdue` (reflected in status colour and AR aging).
- **Client visibility rules**: clients only ever see invoices that are **not `draft` and not `cancelled`** (enforced server-side in the portal RPC — see §6). Drafts are an internal building state.

---

## 6. Portal Finance Access

Code-login portals carry **no Supabase JWT**, so they run as the **anon** role and cannot satisfy `auth.uid()`-based RLS. Finance read access for portals is therefore exposed through **`SECURITY DEFINER` RPCs**, mirroring the existing `client_portal_*` / `contractor_portal_*` pattern. Created by `supabase/migrations/20260529220000_finance_portal_rpcs.sql`.

| RPC | Audience | Resolution | Returns |
|-----|----------|-----------|---------|
| `client_portal_list_invoices(p_company_code, p_client_code)` | Client portal | `companies.code` + `clients.client_code` (upper/trim) | The client's invoices |
| `contractor_portal_list_payouts(p_company_code, p_contractor_code)` | Contractor portal | `companies.code` + `contractors.contractor_code` + `is_active` | The contractor's payouts |

### Why RPC routing exists

- Portal users are **anon** → no `auth.uid()` → **no RLS table access** is possible.
- A `SECURITY DEFINER` function runs with definer privileges (`row_security off`) and **validates identity internally** via the shared-secret company + entity codes.
- Both functions are granted `EXECUTE` to `anon, authenticated` — exactly the contract every other portal RPC uses.

### Filtering & status restrictions

- **Client invoices**: `status not in ('draft','cancelled')` — clients never see internal drafts or voided documents.
- **Contractor payouts**: `payout_status <> 'cancelled'` and the contractor must be `is_active = true`.
- **Company-code validation**: both join through `companies.code` with `upper(trim(...))` matching, identical to `client_portal_list_projects` / `contractor_portal_list_jobs`, so a wrong/again-expired code simply returns an empty set.

### Client/storage wiring

`IStorageService.GetClientPortalInvoicesAsync` / `GetContractorPortalPayoutsAsync` (implemented in `SupabaseStorageService.Finance.cs`) call the RPCs and parse the snake_case JSON with tolerant `System.Text.Json` parsers — the same approach as `ParseClientPortalDeals`. The **client portal** gains an *Invoices* tab (number, status, total, balance, issued/due + outstanding summary); the **contractor portal** gains a *Payouts* tab (net payable, gross, status, retention + outstanding summary).

---

## 7. Dashboard & Reporting

### Finance dashboard (`FinanceDashboardPage` + `FinanceDashboardViewModel`)

- **KPI cards** — revenue, expenses, net cashflow, AR outstanding, AP outstanding, VAT position, for a selected period.
- **Charts** — revenue/expense bars + top-debtor category bars, drawn natively via `Controls/FinanceCharts.cs` (`BarSeriesDrawable`, `CategoryBarsDrawable`) on a MAUI `GraphicsView`. No charting library is introduced (consistent with the reporting direction in `reporting/01-reporting-and-telemetry.md` and the custom My PA calendar).
- **Navigation tiles** to Invoices, Supplier invoices, Payouts, VAT, Cashflow, Reports, Approvals.

### Finance reports (`FinanceReportsPage` + `SupabaseStorageService.FinanceReports.cs`)

| Report | Builder |
|--------|---------|
| Profit & Loss | `BuildProfitAndLossReportAsync` (revenue − expenses incl. payroll cost) |
| VAT Summary | `BuildVatReportAsync` (output − input → net VAT) |
| AR Aging | `BuildArAgingReportAsync` (debtor buckets) |
| Accounts Payable | `BuildApReportAsync` |
| Cashflow | `BuildCashflowReportAsync` (from `finance_transactions`) |
| Revenue/Expense Trend | `BuildRevenueExpenseReportAsync` |
| Spend Analysis | `BuildSpendReportAsync` |

All reports build a generic `FinanceReport` DTO (`FinanceReportLine` rows) that renders to a preview table and exports via `IExportService`:

```
Report type + date range
        │
        ▼
SupabaseStorageService.BuildFinanceReportAsync(companyId, reportKey, start, end)
        │
        ├──► FinanceReportsViewModel → preview table (on screen)
        └──► IExportService → QuestPDF (PDF) / ClosedXML (Excel)
```

---

## 8. Approvals & Audit

Finance approvals **reuse the payments approval gate** (`payments.approve`) rather than introducing a new permission. Implemented in `SupabaseStorageService.FinanceApprovals.cs` with a unified `FinanceApprovalItem` queue surfaced by `FinanceApprovalsPage`.

| Flow | Methods |
|------|---------|
| Supplier payment | `ApproveSupplierInvoiceAsync`, `RejectSupplierInvoiceAsync`, `MarkSupplierInvoicePaidAsync` |
| Contractor payout | `ApproveContractorPayoutAsync`, `RejectContractorPayoutAsync`, `MarkContractorPayoutPaidAsync` |
| Refund | `IssueRefundAsync` |

Each action: updates status + `approved_by`/`approved_at`/`paid_at`, writes a **`finance_transactions` ledger row** where money moves, recomputes balances/status via `KaiFlow.Finance`, **writes a `finance_audit_log` row**, and **emits an `AppTelemetry` event**.

### Immutable audit history

`finance_audit_log` is **insert-only** (RLS grants insert + select to the company, never update/delete). Each row captures `entity_type`, `entity_id`, `action`, `actor_id`/`actor_name`, and JSON **`old_values` / `new_values`** so the before/after of every approval, rejection, payment, and refund is preserved for audit. The approvals page renders a live audit trail of recent finance activity.

---

## 9. Telemetry

Finance reuses the production `AppTelemetry` → `app_events` pipeline (see `reporting/01-reporting-and-telemetry.md`). Because finance actions are taken by HR/JWT users, events flow through the authenticated `app_events` insert path. Representative event names:

| Event | Raised when |
|-------|-------------|
| `finance_invoice_created` | A client invoice is created |
| `finance_invoice_paid` | An invoice payment settles the balance |
| `supplier_invoice_added` | A supplier bill is captured |
| `contractor_payout_processed` | A payout is approved/paid |
| `vat_report_generated` | A VAT report is built |
| `finance_exported` | A finance report is exported to PDF/Excel |
| `finance_<entity>_<action>` | Approval-trail events (e.g. `finance_supplier_invoice_approved`) |

Each event carries `company_id` plus action-specific `meta` (entity id, amount, actor). As with all telemetry, persistence is **fire-and-forget** (risk M5) — events are best-effort, not guaranteed-delivery.

---

## 10. Risks & Future Roadmap

### Current limitations (honest)

1. **No external accounting integration yet** — Finance is self-contained; there is no sync to Xero/Sage/QuickBooks.
2. **No bank reconciliation** — `finance_transactions` is an internal ledger; it is not matched against bank statement imports.
3. **No payment-gateway capture** — invoice payments are recorded manually; there is no Stripe/PayFast/Ozow online collection.
4. **No scheduled/emailed reports** — reports are generated on demand (shares risk M4/M5 with platform reporting).
5. **No forecasting** — cashflow is historical/current; predictive forecasting is not implemented.
6. **Telemetry is best-effort** (M5) — finance events can be lost on app kill.
7. **Migrations must be applied** — `20260529200000`, `20260529210000`, `20260529220000` must be pushed to Supabase before finance screens return live data.

### Roadmap direction

- **Accounting integration layer** — an adapter interface (`IAccountingConnector`) with Xero/Sage/QuickBooks implementations, syncing invoices, bills, payments, and the VAT period; designed so the `finance_transactions` ledger is the export boundary.
- **Bank reconciliation** — statement import (CSV/OFX) matched against `finance_transactions` with a reconciliation status column.
- **Payment gateways** — online invoice payment (PayFast/Stripe/Ozow) writing back into the invoice payment + ledger flow.
- **Scheduled reports** — server-side report snapshots emailed on a cadence (depends on the platform reporting expansion).
- **Cashflow forecasting** — projecting AR/AP due dates + recurring obligations forward.
- **Reconciliation of payroll cost** into P&L as a first-class expense category rather than a derived input.

---

## 11. End-to-End Finance Flows

Traced ViewModel → `IStorageService` → RPC/PostgREST → table → ledger/telemetry, matching `workflows/01-core-workflows.md`. **VM** = ViewModel, **RPC** = security-definer function, **PG** = direct PostgREST.

### A. Client invoice creation

```
FinanceInvoiceDetailViewModel (builder)
  → pick client / project, add InvoiceLineEditor rows
  → live recalc: VatCalculator.CalculateVatExclusive/Inclusive per line
        (subtotal, vat, total, discount, balance_due update on every keystroke)
  → SaveInvoiceAsync
        ├─ PG insert finance_invoices (status=draft) + finance_invoice_lines
        └─ totals synced from KaiFlow.Finance (server math == UI preview)
  → IssueAsync → status=sent, invoice_number assigned
  → AppTelemetry.LogEvent("finance_invoice_created")
```

### B. Supplier invoice approval

```
SupplierInvoicesViewModel (quick-add: subtotal, vat toggle, supplier)
  → CreateSupplierInvoiceAsync → supplier_invoices (approval_status=pending)
HR (payments.approve):
  FinanceApprovalsViewModel
    → ApproveSupplierInvoiceAsync(invoiceId, actor)
         ├─ approval_status=approved, approved_by/at stamped
         ├─ finance_audit_log insert (old/new values)
         └─ AppTelemetry "finance_supplier_invoice_approved"
    → MarkSupplierInvoicePaidAsync
         ├─ paid_at stamped
         ├─ finance_transactions insert (direction=out)
         └─ audit + telemetry
```

### C. Contractor payout

```
ContractorPayoutsViewModel (quick-add: subtotal, vat, retention, contractor)
  → CreateContractorPayoutAsync → contractor_payouts (pending)
HR → ApproveContractorPayoutAsync → MarkContractorPayoutPaidAsync
        ├─ net payable = total_amount − retention_amount
        ├─ finance_transactions insert (direction=out)
        └─ finance_audit_log + AppTelemetry "contractor_payout_processed"
Contractor portal → contractor_portal_list_payouts → sees status + net payable
```

### D. VAT calculation

```
Any financial entity total
  → TaxCalculationService (company default rate)
  → VatCalculator.EffectiveRate(rate, taxType)
        ├─ standard  → NormalizeRate(rate)
        └─ zero/exempt → 0
  → CalculateVatExclusive | CalculateVatInclusive | ReverseCalculateVat
  → RoundFinancialValues (half-away-from-zero, 2dp)
VAT period:
  FinanceVatViewModel → output_vat (sales) − input_vat (purchases) → net VAT due
```

### E. Portal invoice viewing (anon)

```
Client portal (code-login, no JWT → anon)
  → GetClientPortalInvoicesAsync(companyCode, clientCode)
  → RPC client_portal_list_invoices  [SECURITY DEFINER]
        WHERE company.code = :code AND client.client_code = :code
          AND status NOT IN ('draft','cancelled')
  → Invoices tab: number, status, total, balance, due + outstanding total
```

### F. Export generation

```
FinanceReportsViewModel (report type + date range)
  → BuildFinanceReportAsync(companyId, reportKey, start, end)
        → SupabaseStorageService.FinanceReports builder (P&L / VAT / AR / AP / cashflow / trend / spend)
        → FinanceReport DTO (FinanceReportLine rows)
  → preview table
  → ExportService → QuestPDF (PDF) | ClosedXML (Excel)
  → AppTelemetry.LogEvent("finance_exported")
```

---

_This module reuses the platform's auth model (`security/01-authentication.md`), telemetry pipeline (`reporting/01-reporting-and-telemetry.md`), and export infrastructure. It is the operational-finance counterpart to the statutory `payroll.md` engine. Risks are tracked in `roadmap/01-risks-and-technical-debt.md`._
