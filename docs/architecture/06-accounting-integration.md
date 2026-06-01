# Accounting integration foundation

> **Library:** `KaiFlow.Accounting` · **Status:** Architecture foundation (no live Xero/Sage/QuickBooks sync)

## Purpose

Provides a provider-agnostic accounting sync layer so the Finance module can enqueue outbound records without coupling to any external ERP. Finance pages and ViewModels must **never** reference provider SDKs directly.

## Components

| Type | Role |
|------|------|
| `IAccountingProvider` | Push batch (outbound) + future pull batch (inbound) |
| `AccountingSyncService` | Enqueue, process batches, reconcile, audit |
| `AccountingExportMapper` | Maps domain DTOs → neutral `AccountingSyncItem` payloads |
| `AccountingSyncQueue` | In-memory retry queue (swap for durable store later) |
| `AccountingSyncAudit` | Append-only audit trail of sync actions |
| `ManualAccountingProvider` | Default no-op until a real provider is registered |

## Sync-ready entity types

- Invoices, payments, VAT returns
- Suppliers, contractors
- Payroll journals, expenses, ledger transactions

## Sync capabilities

- Outbound enqueue + batch processing
- Inbound pull hook (provider must set `SupportsInbound`)
- Reconciliation summary (matched / unmatched / conflicts)
- Retry via queue status + attempt count
- Idempotency keys on mapped items

## Provider registration (MauiProgram)

```csharp
builder.Services.AddSingleton<AccountingSyncQueue>();
builder.Services.AddSingleton<AccountingSyncAudit>();
builder.Services.AddSingleton<IAccountingExportMapper, AccountingExportMapper>();
builder.Services.AddSingleton<IAccountingProvider, ManualAccountingProvider>();
// Future: builder.Services.AddSingleton<IAccountingProvider, XeroAccountingProvider>();
builder.Services.AddSingleton<AccountingSyncService>();
```

## Next steps (not implemented)

1. Durable sync queue table + RLS in Supabase
2. Xero / Sage / QuickBooks provider implementations
3. HR settings UI for provider credentials (OAuth)
4. Scheduled sync worker

## Related

- `modules/finance.md` — Finance module
- `reporting/01-reporting-and-telemetry.md` — export telemetry
