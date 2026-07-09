using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using Op = Supabase.Postgrest.Constants.Operator;
using Ord = Supabase.Postgrest.Constants.Ordering;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Finance module data access (Phase 4). HR / JWT users transact via PostgREST
/// under company-scoped RLS. Totals are recomputed with the deterministic
/// KaiFlow.Finance engine so persisted values are always auditable.
/// </summary>
public partial class SupabaseStorageService
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");

    // ════════════════════════════════════════════════════════════════════════
    // Client invoices
    // ════════════════════════════════════════════════════════════════════════
    public async Task<List<FinanceInvoice>> GetFinanceInvoicesAsync(Guid companyId, string? status = null, Guid? clientId = null)
    {
        var query = _supabase.From<FinanceInvoice>()
            .Filter("company_id", Op.Equals, companyId.ToString());
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Filter("status", Op.Equals, status);
        if (clientId.HasValue)
            query = query.Filter("client_id", Op.Equals, clientId.Value.ToString());

        var result = await query.Order("issue_date", Ord.Descending).Get();
        return result.Models;
    }

    public async Task<FinanceInvoice?> GetFinanceInvoiceAsync(Guid invoiceId)
    {
        var result = await _supabase.From<FinanceInvoice>()
            .Filter("id", Op.Equals, invoiceId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task<FinanceInvoice> CreateFinanceInvoiceAsync(FinanceInvoice invoice)
    {
        if (invoice.Id == Guid.Empty) invoice.Id = Guid.NewGuid();
        if (invoice.IssueDate == default) invoice.IssueDate = DateOnly.FromDateTime(DateTime.UtcNow);
        if (invoice.CreatedAt == default) invoice.CreatedAt = DateTime.UtcNow;
        invoice.UpdatedAt = DateTime.UtcNow;
        var result = await _supabase.From<FinanceInvoice>().Insert(invoice);
        return result.Models.First();
    }

    public async Task<FinanceInvoice> UpdateFinanceInvoiceAsync(FinanceInvoice invoice)
    {
        invoice.UpdatedAt = DateTime.UtcNow;
        var result = await _supabase.From<FinanceInvoice>().Update(invoice);
        return result.Models.First();
    }

    public async Task DeleteFinanceInvoiceAsync(Guid invoiceId)
        => await _supabase.From<FinanceInvoice>().Filter("id", Op.Equals, invoiceId.ToString()).Delete();

    public async Task<List<FinanceInvoiceLine>> GetFinanceInvoiceLinesAsync(Guid invoiceId)
    {
        var result = await _supabase.From<FinanceInvoiceLine>()
            .Filter("invoice_id", Op.Equals, invoiceId.ToString())
            .Order("line_no", Ord.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<FinanceInvoiceLine> AddFinanceInvoiceLineAsync(FinanceInvoiceLine line)
    {
        if (line.Id == Guid.Empty) line.Id = Guid.NewGuid();
        if (line.CreatedAt == default) line.CreatedAt = DateTime.UtcNow;

        // Recompute the line deterministically from inputs.
        var calc = FinanceCalculationHelper.CalculateLine(
            line.Quantity, line.UnitPrice, line.VatRate, line.IsVatInclusive,
            line.TaxType, line.DiscountAmount, line.DiscountPercent);
        line.Subtotal = calc.Subtotal;
        line.VatAmount = calc.VatAmount;
        line.TotalAmount = calc.TotalAmount;
        line.VatRate = calc.VatRate;

        var result = await _supabase.From<FinanceInvoiceLine>().Insert(line);
        var saved = result.Models.First();
        await SyncFinanceInvoiceTotalsAsync(line.InvoiceId);
        return saved;
    }

    public async Task DeleteFinanceInvoiceLineAsync(Guid lineId)
    {
        var existing = await _supabase.From<FinanceInvoiceLine>()
            .Filter("id", Op.Equals, lineId.ToString()).Get();
        var line = existing.Models.FirstOrDefault();
        await _supabase.From<FinanceInvoiceLine>().Filter("id", Op.Equals, lineId.ToString()).Delete();
        if (line != null) await SyncFinanceInvoiceTotalsAsync(line.InvoiceId);
    }

    public async Task<FinanceInvoice> SyncFinanceInvoiceTotalsAsync(Guid invoiceId)
    {
        var invoice = await GetFinanceInvoiceAsync(invoiceId)
            ?? throw new InvalidOperationException("Invoice not found.");
        var lines = await GetFinanceInvoiceLinesAsync(invoiceId);

        var subtotal = VatCalculator.RoundFinancialValues(lines.Sum(l => l.Subtotal) - invoice.DiscountAmount);
        if (subtotal < 0) subtotal = 0;
        var vat = VatCalculator.RoundFinancialValues(lines.Sum(l => l.VatAmount));
        var total = VatCalculator.RoundFinancialValues(subtotal + vat);

        invoice.Subtotal = subtotal;
        invoice.VatAmount = vat;
        invoice.TotalAmount = total;
        invoice.BalanceDue = FinanceCalculationHelper.BalanceDue(total, invoice.AmountPaid);

        // Auto-advance settlement status without overriding manual draft/cancelled states.
        if (invoice.StatusRaw is not ("draft" or "cancelled"))
        {
            var state = FinanceCalculationHelper.ResolvePaymentState(total, invoice.AmountPaid, invoice.DueDate);
            invoice.StatusRaw = state switch
            {
                PaymentState.Paid => "paid",
                PaymentState.PartiallyPaid => "partially_paid",
                PaymentState.Overdue => "overdue",
                _ => invoice.StatusRaw is "overdue" or "partially_paid" or "paid" ? "sent" : invoice.StatusRaw
            };
            if (invoice.StatusRaw == "paid" && invoice.PaidDate is null)
                invoice.PaidDate = DateOnly.FromDateTime(DateTime.UtcNow);
        }

        return await UpdateFinanceInvoiceAsync(invoice);
    }

    public async Task<FinanceInvoice> RecordInvoicePaymentAsync(Guid invoiceId, decimal amount, string? method = null, string? reference = null)
    {
        var invoice = await GetFinanceInvoiceAsync(invoiceId)
            ?? throw new InvalidOperationException("Invoice not found.");
        invoice.AmountPaid = VatCalculator.RoundFinancialValues(invoice.AmountPaid + amount);

        await AddFinanceTransactionAsync(new FinanceTransaction
        {
            CompanyId = invoice.CompanyId,
            TransactionTypeRaw = "invoice",
            DirectionRaw = "incoming",
            SourceTable = "finance_invoices",
            SourceId = invoice.Id,
            ReferenceNumber = reference ?? invoice.InvoiceNumber,
            Amount = amount,
            TotalAmount = amount,
            TransactionDate = DateOnly.FromDateTime(DateTime.UtcNow),
            PaymentMethod = method
        });

        await UpdateFinanceInvoiceAsync(invoice);
        return await SyncFinanceInvoiceTotalsAsync(invoiceId);
    }

    public async Task<string> GenerateNextInvoiceNumberAsync(Guid companyId)
    {
        var existing = await GetFinanceInvoicesAsync(companyId);
        var year = DateTime.UtcNow.Year;
        var prefix = $"INV-{year}-";
        var maxSeq = existing
            .Select(i => i.InvoiceNumber)
            .Where(n => !string.IsNullOrWhiteSpace(n) && n!.StartsWith(prefix))
            .Select(n => int.TryParse(n!.Substring(prefix.Length), out var s) ? s : 0)
            .DefaultIfEmpty(0)
            .Max();
        return $"{prefix}{(maxSeq + 1):D4}";
    }

    // ════════════════════════════════════════════════════════════════════════
    // Supplier invoices (payables)
    // ════════════════════════════════════════════════════════════════════════
    public async Task<List<SupplierInvoice>> GetSupplierInvoicesAsync(Guid companyId, string? status = null, Guid? supplierId = null)
    {
        var query = _supabase.From<SupplierInvoice>()
            .Filter("company_id", Op.Equals, companyId.ToString());
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Filter("status", Op.Equals, status);
        if (supplierId.HasValue)
            query = query.Filter("supplier_id", Op.Equals, supplierId.Value.ToString());

        var result = await query.Order("created_at", Ord.Descending).Get();
        return result.Models;
    }

    public async Task<SupplierInvoice> CreateSupplierInvoiceAsync(SupplierInvoice invoice)
    {
        if (invoice.Id == Guid.Empty) invoice.Id = Guid.NewGuid();
        if (invoice.CreatedAt == default) invoice.CreatedAt = DateTime.UtcNow;
        invoice.UpdatedAt = DateTime.UtcNow;
        invoice.BalanceDue = FinanceCalculationHelper.BalanceDue(invoice.TotalAmount, invoice.AmountPaid);
        var result = await _supabase.From<SupplierInvoice>().Insert(invoice);
        return result.Models.First();
    }

    public async Task<SupplierInvoice> UpdateSupplierInvoiceAsync(SupplierInvoice invoice)
    {
        invoice.UpdatedAt = DateTime.UtcNow;
        invoice.BalanceDue = FinanceCalculationHelper.BalanceDue(invoice.TotalAmount, invoice.AmountPaid);
        var result = await _supabase.From<SupplierInvoice>().Update(invoice);
        return result.Models.First();
    }

    public async Task DeleteSupplierInvoiceAsync(Guid invoiceId)
        => await _supabase.From<SupplierInvoice>().Filter("id", Op.Equals, invoiceId.ToString()).Delete();

    // ════════════════════════════════════════════════════════════════════════
    // Contractor payouts
    // ════════════════════════════════════════════════════════════════════════
    public async Task<List<ContractorPayout>> GetContractorPayoutsAsync(Guid companyId, string? payoutStatus = null, Guid? contractorId = null)
    {
        var query = _supabase.From<ContractorPayout>()
            .Filter("company_id", Op.Equals, companyId.ToString());
        if (!string.IsNullOrWhiteSpace(payoutStatus))
            query = query.Filter("payout_status", Op.Equals, payoutStatus);
        if (contractorId.HasValue)
            query = query.Filter("contractor_id", Op.Equals, contractorId.Value.ToString());

        var result = await query.Order("created_at", Ord.Descending).Get();
        return result.Models;
    }

    public async Task<ContractorPayout> CreateContractorPayoutAsync(ContractorPayout payout)
    {
        if (payout.Id == Guid.Empty) payout.Id = Guid.NewGuid();
        if (payout.CreatedAt == default) payout.CreatedAt = DateTime.UtcNow;
        payout.UpdatedAt = DateTime.UtcNow;
        var result = await _supabase.From<ContractorPayout>().Insert(payout);
        return result.Models.First();
    }

    public async Task<ContractorPayout> UpdateContractorPayoutAsync(ContractorPayout payout)
    {
        payout.UpdatedAt = DateTime.UtcNow;
        var result = await _supabase.From<ContractorPayout>().Update(payout);
        return result.Models.First();
    }

    public async Task DeleteContractorPayoutAsync(Guid payoutId)
        => await _supabase.From<ContractorPayout>().Filter("id", Op.Equals, payoutId.ToString()).Delete();

    // ════════════════════════════════════════════════════════════════════════
    // Universal ledger & VAT periods
    // ════════════════════════════════════════════════════════════════════════
    public async Task<List<FinanceTransaction>> GetFinanceTransactionsAsync(Guid companyId, DateOnly? from = null, DateOnly? to = null, string? direction = null)
    {
        var query = _supabase.From<FinanceTransaction>()
            .Filter("company_id", Op.Equals, companyId.ToString());
        if (from.HasValue) query = query.Filter("transaction_date", Op.GreaterThanOrEqual, D(from.Value));
        if (to.HasValue) query = query.Filter("transaction_date", Op.LessThanOrEqual, D(to.Value));
        if (!string.IsNullOrWhiteSpace(direction)) query = query.Filter("direction", Op.Equals, direction);

        var result = await query.Order("transaction_date", Ord.Descending).Get();
        return result.Models;
    }

    public async Task<FinanceTransaction> AddFinanceTransactionAsync(FinanceTransaction transaction)
    {
        if (transaction.Id == Guid.Empty) transaction.Id = Guid.NewGuid();
        if (transaction.TransactionDate == default) transaction.TransactionDate = DateOnly.FromDateTime(DateTime.UtcNow);
        if (transaction.CreatedAt == default) transaction.CreatedAt = DateTime.UtcNow;
        if (transaction.TotalAmount == 0) transaction.TotalAmount = transaction.Amount;
        var result = await _supabase.From<FinanceTransaction>().Insert(transaction);
        return result.Models.First();
    }

    public async Task<List<FinanceVatPeriod>> GetVatPeriodsAsync(Guid companyId)
    {
        var result = await _supabase.From<FinanceVatPeriod>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Order("start_date", Ord.Descending)
            .Get();
        return result.Models;
    }

    public async Task<FinanceVatPeriod> UpsertVatPeriodAsync(FinanceVatPeriod period)
    {
        period.VatDue = VatCalculator.RoundFinancialValues(period.OutputVat - period.InputVat);
        if (period.Id == Guid.Empty)
        {
            period.Id = Guid.NewGuid();
            if (period.CreatedAt == default) period.CreatedAt = DateTime.UtcNow;
            var inserted = await _supabase.From<FinanceVatPeriod>().Insert(period);
            return inserted.Models.First();
        }
        var updated = await _supabase.From<FinanceVatPeriod>().Update(period);
        return updated.Models.First();
    }

    // ════════════════════════════════════════════════════════════════════════
    // Dashboard aggregation
    // ════════════════════════════════════════════════════════════════════════
    public async Task<FinanceDashboardSnapshot> GetFinanceDashboardSnapshotAsync(Guid companyId, DateOnly periodStart, DateOnly periodEnd)
    {
        var invoices = await GetFinanceInvoicesAsync(companyId);
        var supplierInvoices = await GetSupplierInvoicesAsync(companyId);
        var payouts = await GetContractorPayoutsAsync(companyId);
        var transactions = await GetFinanceTransactionsAsync(companyId, periodStart, periodEnd);
        var payrollCosts = await GetPayrollCostsAsync(companyId, periodStart, periodEnd);

        bool InWindow(DateOnly d) => d >= periodStart && d <= periodEnd;

        var windowInvoices = invoices.Where(i => InWindow(i.IssueDate) && i.StatusRaw != "cancelled").ToList();
        var windowSupplier = supplierInvoices.Where(s => s.StatusRaw != "cancelled"
            && s.DueDate.HasValue && InWindow(s.DueDate.Value)).ToList();

        var snapshot = new FinanceDashboardSnapshot
        {
            PeriodStart = periodStart,
            PeriodEnd = periodEnd,
            RevenueThisPeriod = VatCalculator.RoundFinancialValues(windowInvoices.Where(i => i.StatusRaw != "draft").Sum(i => i.Subtotal)),
            OutstandingInvoices = VatCalculator.RoundFinancialValues(invoices.Where(i => i.IsOutstanding).Sum(i => i.BalanceDue)),
            OutstandingInvoiceCount = invoices.Count(i => i.IsOutstanding),
            SupplierPayables = VatCalculator.RoundFinancialValues(supplierInvoices.Where(s => s.IsOutstanding).Sum(s => s.BalanceDue)),
            ContractorPayables = VatCalculator.RoundFinancialValues(payouts.Where(p => p.PayoutStatusRaw is "pending" or "approved").Sum(p => p.NetPayable)),
            PayrollCosts = payrollCosts,
            OutputVat = VatCalculator.RoundFinancialValues(windowInvoices.Where(i => i.StatusRaw != "draft").Sum(i => i.VatAmount)),
            InputVat = VatCalculator.RoundFinancialValues(windowSupplier.Sum(s => s.VatAmount)),
            MoneyIn = VatCalculator.RoundFinancialValues(transactions.Where(t => t.IsIncoming).Sum(t => t.TotalAmount)),
            MoneyOut = VatCalculator.RoundFinancialValues(transactions.Where(t => !t.IsIncoming).Sum(t => t.TotalAmount)),
        };
        snapshot.VatDue = VatCalculator.RoundFinancialValues(snapshot.OutputVat - snapshot.InputVat);

        var windowExpenses = VatCalculator.RoundFinancialValues(
            windowSupplier.Sum(s => s.Subtotal)
            + payouts.Where(p => p.PayoutDate.HasValue && InWindow(p.PayoutDate.Value)).Sum(p => p.Subtotal)
            + payrollCosts);
        snapshot.ProfitEstimate = VatCalculator.RoundFinancialValues(snapshot.RevenueThisPeriod - windowExpenses);

        // ── Monthly trend buckets across the window ──
        var months = MonthBuckets(periodStart, periodEnd);
        foreach (var (label, mStart, mEnd) in months)
        {
            bool Within(DateOnly d) => d >= mStart && d <= mEnd;
            var rev = invoices.Where(i => i.StatusRaw != "draft" && i.StatusRaw != "cancelled" && Within(i.IssueDate)).Sum(i => i.Subtotal);
            var exp = supplierInvoices.Where(s => s.DueDate.HasValue && Within(s.DueDate.Value)).Sum(s => s.Subtotal);
            var inMoney = transactions.Where(t => t.IsIncoming && Within(t.TransactionDate)).Sum(t => t.TotalAmount);
            var outMoney = transactions.Where(t => !t.IsIncoming && Within(t.TransactionDate)).Sum(t => t.TotalAmount);
            var outVat = invoices.Where(i => i.StatusRaw != "draft" && Within(i.IssueDate)).Sum(i => i.VatAmount);
            var inVat = supplierInvoices.Where(s => s.DueDate.HasValue && Within(s.DueDate.Value)).Sum(s => s.VatAmount);

            snapshot.RevenueTrend.Add(new FinanceTrendPoint { Label = label, Value = VatCalculator.RoundFinancialValues(rev) });
            snapshot.ExpenseTrend.Add(new FinanceTrendPoint { Label = label, Value = VatCalculator.RoundFinancialValues(exp) });
            snapshot.CashflowTrend.Add(new FinanceTrendPoint { Label = label, Value = VatCalculator.RoundFinancialValues(inMoney), SecondaryValue = VatCalculator.RoundFinancialValues(outMoney) });
            snapshot.VatTrend.Add(new FinanceTrendPoint { Label = label, Value = VatCalculator.RoundFinancialValues(outVat - inVat) });
        }

        // ── Expense categories (outgoing transactions grouped by type) ──
        var palette = new[] { "#3B82F6", "#F59E0B", "#8B5CF6", "#EF4444", "#10B981", "#6B7280" };
        var grouped = transactions.Where(t => !t.IsIncoming)
            .GroupBy(t => t.TypeLabel)
            .Select(g => new { g.Key, Sum = g.Sum(x => x.TotalAmount) })
            .OrderByDescending(g => g.Sum)
            .ToList();
        for (var idx = 0; idx < grouped.Count; idx++)
            snapshot.ExpenseCategories.Add(new FinanceCategorySlice
            {
                Label = grouped[idx].Key,
                Value = VatCalculator.RoundFinancialValues(grouped[idx].Sum),
                Color = palette[idx % palette.Length]
            });

        // ── Top debtors (largest outstanding balances) ──
        snapshot.TopDebtors = invoices.Where(i => i.IsOutstanding)
            .OrderByDescending(i => i.BalanceDue)
            .Take(6)
            .Select((i, idx) => new FinanceCategorySlice
            {
                Label = i.NumberDisplay,
                Value = i.BalanceDue,
                Color = palette[idx % palette.Length]
            })
            .ToList();

        return snapshot;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Portal read RPCs (code-login; no JWT → security-definer functions)
    // ════════════════════════════════════════════════════════════════════════
    public async Task<List<FinanceInvoice>> GetClientPortalInvoicesAsync(string companyCode, string clientCode)
    {
        var rows = await _supabase.Rpc("client_portal_list_invoices", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant()
        });
        return ParsePortalInvoices(rows?.Content);
    }

    public async Task<List<ContractorPayout>> GetContractorPortalPayoutsAsync(string companyCode, string contractorCode)
    {
        var rows = await _supabase.Rpc("contractor_portal_list_payouts", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant()
        });
        return ParsePortalPayouts(rows?.Content);
    }

    private static List<FinanceInvoice> ParsePortalInvoices(string? content)
    {
        var list = new List<FinanceInvoice>();
        if (string.IsNullOrWhiteSpace(content) || content == "null") return list;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array) return list;
            foreach (var r in doc.RootElement.EnumerateArray())
            {
                list.Add(new FinanceInvoice
                {
                    Id = PGuid(r, "id"),
                    CompanyId = PGuid(r, "company_id"),
                    ClientId = PGuidN(r, "client_id"),
                    InvoiceNumber = PStr(r, "invoice_number"),
                    StatusRaw = PStr(r, "status") ?? "sent",
                    Currency = PStr(r, "currency") ?? "ZAR",
                    Subtotal = PDec(r, "subtotal"),
                    VatRate = PDec(r, "vat_rate"),
                    VatAmount = PDec(r, "vat_amount"),
                    TotalAmount = PDec(r, "total_amount"),
                    AmountPaid = PDec(r, "amount_paid"),
                    BalanceDue = PDec(r, "balance_due"),
                    IssueDate = PDate(r, "issue_date") ?? default,
                    DueDate = PDateN(r, "due_date"),
                    Notes = PStr(r, "notes")
                });
            }
        }
        catch { /* tolerate malformed payloads */ }
        return list;
    }

    private static List<ContractorPayout> ParsePortalPayouts(string? content)
    {
        var list = new List<ContractorPayout>();
        if (string.IsNullOrWhiteSpace(content) || content == "null") return list;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array) return list;
            foreach (var r in doc.RootElement.EnumerateArray())
            {
                list.Add(new ContractorPayout
                {
                    Id                = PGuid(r, "id"),
                    CompanyId         = PGuid(r, "company_id"),
                    ContractorId      = PGuidN(r, "contractor_id"),
                    JobId             = PGuidN(r, "job_id"),
                    JobContractorId   = PGuidN(r, "job_contractor_id"),
                    Subtotal          = PDec(r, "subtotal"),
                    VatRate           = PDec(r, "vat_rate"),
                    VatAmount         = PDec(r, "vat_amount"),
                    TotalAmount       = PDec(r, "total_amount"),
                    RetentionAmount   = PDec(r, "retention_amount"),
                    PayoutStatusRaw   = PStr(r, "payout_status") ?? "pending",
                    ApprovalStatusRaw = PStr(r, "approval_status") ?? "pending",
                    RejectionReason   = PStr(r, "rejection_reason"),
                    Notes             = PStr(r, "notes"),
                    PayoutDate        = PDateN(r, "payout_date"),
                    ApprovedAt        = PDateTimeN(r, "approved_at"),
                    PaidAt            = PDateTimeN(r, "paid_at"),
                    CreatedAt         = PDateTimeVal(r, "created_at"),
                    PortalJobTitle    = PStr(r, "job_title") ?? "",
                    PortalJobCode     = PStr(r, "job_code") ?? "",
                });
            }
        }
        catch { /* tolerate malformed payloads */ }
        return list;
    }

    private static string? PStr(System.Text.Json.JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
    private static decimal PDec(System.Text.Json.JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number && v.TryGetDecimal(out var d) ? d : 0m;
    private static Guid PGuid(System.Text.Json.JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && Guid.TryParse(v.GetString(), out var g) ? g : Guid.Empty;
    private static Guid? PGuidN(System.Text.Json.JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && Guid.TryParse(v.GetString(), out var g) ? g : null;
    private static DateOnly? PDate(System.Text.Json.JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String && DateOnly.TryParse(v.GetString(), out var d) ? d : null;
    private static DateOnly? PDateN(System.Text.Json.JsonElement e, string name) => PDate(e, name);
    private static DateTime? PDateTimeN(System.Text.Json.JsonElement e, string name)
    {
        if (!e.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == System.Text.Json.JsonValueKind.Null) return null;
        if (v.ValueKind == System.Text.Json.JsonValueKind.String
            && DateTime.TryParse(v.GetString(),
                   System.Globalization.CultureInfo.InvariantCulture,
                   System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
            return dt;
        return null;
    }
    private static DateTime PDateTimeVal(System.Text.Json.JsonElement e, string name)
        => PDateTimeN(e, name) ?? default;

    private async Task<decimal> GetPayrollCostsAsync(Guid companyId, DateOnly periodStart, DateOnly periodEnd)
    {
        try
        {
            var result = await _supabase.From<PaymentApproval>()
                .Filter("company_id", Op.Equals, companyId.ToString())
                .Filter("period_end", Op.GreaterThanOrEqual, D(periodStart))
                .Filter("period_start", Op.LessThanOrEqual, D(periodEnd))
                .Get();
            var total = result.Models
                .Where(p => p.StatusRaw is "approved" or "paid")
                .Sum(p => (decimal)p.NetPay);
            return VatCalculator.RoundFinancialValues(total);
        }
        catch
        {
            return 0m;
        }
    }

    private static List<(string Label, DateOnly Start, DateOnly End)> MonthBuckets(DateOnly start, DateOnly end)
    {
        var buckets = new List<(string, DateOnly, DateOnly)>();
        var cursor = new DateOnly(start.Year, start.Month, 1);
        while (cursor <= end)
        {
            var mStart = cursor;
            var mEnd = cursor.AddMonths(1).AddDays(-1);
            buckets.Add((cursor.ToString("MMM"), mStart, mEnd));
            cursor = cursor.AddMonths(1);
        }
        return buckets;
    }
}
