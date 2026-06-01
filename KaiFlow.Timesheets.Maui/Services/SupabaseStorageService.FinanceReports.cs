using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Finance reporting (Phase 7). Builds structured <see cref="FinanceReport"/>
/// datasets from the finance ledger, invoices, payables and payroll. The same
/// dataset drives the on-screen preview and the QuestPDF / ClosedXML exports.
/// </summary>
public partial class SupabaseStorageService
{
    private static string M(decimal v) => $"R{v:N2}";

    public async Task<FinanceReport> BuildFinanceReportAsync(Guid companyId, string reportKey, DateOnly start, DateOnly end)
    {
        var periodLabel = $"{start:dd MMM yyyy} – {end:dd MMM yyyy}";
        return reportKey switch
        {
            "vat" => await BuildVatReportAsync(companyId, start, end, periodLabel),
            "ar_aging" => await BuildArAgingReportAsync(companyId, end, periodLabel),
            "ap" => await BuildApReportAsync(companyId, periodLabel),
            "cashflow" => await BuildCashflowReportAsync(companyId, start, end, periodLabel),
            "revenue_expense" => await BuildRevenueExpenseReportAsync(companyId, start, end, periodLabel),
            "spend" => await BuildSpendReportAsync(companyId, start, end, periodLabel),
            _ => await BuildProfitAndLossReportAsync(companyId, start, end, periodLabel),
        };
    }

    private async Task<FinanceReport> BuildProfitAndLossReportAsync(Guid companyId, DateOnly start, DateOnly end, string periodLabel)
    {
        var invoices = await GetFinanceInvoicesAsync(companyId);
        var supplier = await GetSupplierInvoicesAsync(companyId);
        var payouts = await GetContractorPayoutsAsync(companyId);
        var payroll = await GetPayrollCostsAsync(companyId, start, end);

        bool In(DateOnly d) => d >= start && d <= end;

        var revenue = VatCalculator.RoundFinancialValues(
            invoices.Where(i => i.StatusRaw is not ("draft" or "cancelled") && In(i.IssueDate)).Sum(i => i.Subtotal));
        var supplierCost = VatCalculator.RoundFinancialValues(
            supplier.Where(s => s.StatusRaw != "cancelled" && s.DueDate.HasValue && In(s.DueDate.Value)).Sum(s => s.Subtotal));
        var contractorCost = VatCalculator.RoundFinancialValues(
            payouts.Where(p => p.PayoutStatusRaw != "cancelled" && p.PayoutDate.HasValue && In(p.PayoutDate.Value)).Sum(p => p.Subtotal));
        var totalExpenses = VatCalculator.RoundFinancialValues(supplierCost + contractorCost + payroll);
        var netProfit = VatCalculator.RoundFinancialValues(revenue - totalExpenses);

        var report = new FinanceReport
        {
            Title = "Profit & Loss",
            PeriodLabel = periodLabel,
            FileBaseName = "profit-and-loss",
            ColumnCount = 2,
            H1 = "Item",
            H2 = "Amount",
        };
        report.Lines.Add(new FinanceReportLine { C1 = "INCOME", IsHeader = true });
        report.Lines.Add(new FinanceReportLine { C1 = "Sales revenue (excl. VAT)", C2 = M(revenue) });
        report.Lines.Add(new FinanceReportLine { C1 = "Total income", C2 = M(revenue), IsTotal = true });
        report.Lines.Add(new FinanceReportLine { C1 = "EXPENSES", IsHeader = true });
        report.Lines.Add(new FinanceReportLine { C1 = "Supplier costs", C2 = M(supplierCost) });
        report.Lines.Add(new FinanceReportLine { C1 = "Contractor costs", C2 = M(contractorCost) });
        report.Lines.Add(new FinanceReportLine { C1 = "Payroll", C2 = M(payroll) });
        report.Lines.Add(new FinanceReportLine { C1 = "Total expenses", C2 = M(totalExpenses), IsTotal = true });
        report.Lines.Add(new FinanceReportLine { C1 = netProfit < 0 ? "Net loss" : "Net profit", C2 = M(netProfit), IsTotal = true });
        return report;
    }

    private async Task<FinanceReport> BuildVatReportAsync(Guid companyId, DateOnly start, DateOnly end, string periodLabel)
    {
        var invoices = await GetFinanceInvoicesAsync(companyId);
        var supplier = await GetSupplierInvoicesAsync(companyId);
        bool In(DateOnly d) => d >= start && d <= end;

        var outputVat = VatCalculator.RoundFinancialValues(
            invoices.Where(i => i.StatusRaw is not ("draft" or "cancelled") && In(i.IssueDate)).Sum(i => i.VatAmount));
        var inputVat = VatCalculator.RoundFinancialValues(
            supplier.Where(s => s.StatusRaw != "cancelled" && s.DueDate.HasValue && In(s.DueDate.Value)).Sum(s => s.VatAmount));
        var net = VatCalculator.RoundFinancialValues(outputVat - inputVat);

        var report = new FinanceReport
        {
            Title = "VAT Summary",
            PeriodLabel = periodLabel,
            FileBaseName = "vat-summary",
            ColumnCount = 2,
            H1 = "Item",
            H2 = "Amount",
        };
        report.Lines.Add(new FinanceReportLine { C1 = "Output VAT (on sales)", C2 = M(outputVat) });
        report.Lines.Add(new FinanceReportLine { C1 = "Input VAT (on purchases)", C2 = M(inputVat) });
        report.Lines.Add(new FinanceReportLine
        {
            C1 = net < 0 ? "Net VAT refundable" : "Net VAT payable",
            C2 = M(Math.Abs(net)),
            IsTotal = true
        });
        return report;
    }

    private async Task<FinanceReport> BuildArAgingReportAsync(Guid companyId, DateOnly asOf, string periodLabel)
    {
        var invoices = await GetFinanceInvoicesAsync(companyId);
        var outstanding = invoices.Where(i => i.IsOutstanding).OrderByDescending(i => i.BalanceDue).ToList();

        var report = new FinanceReport
        {
            Title = "Client Debt Aging",
            PeriodLabel = periodLabel,
            FileBaseName = "client-debt-aging",
            ColumnCount = 4,
            H1 = "Invoice",
            H2 = "Due",
            H3 = "Balance",
            H4 = "Age",
        };

        static string Bucket(DateOnly? due, DateOnly asOf)
        {
            if (due is null) return "No due date";
            var days = asOf.DayNumber - due.Value.DayNumber;
            return days <= 0 ? "Current"
                : days <= 30 ? "1–30 days"
                : days <= 60 ? "31–60 days"
                : days <= 90 ? "61–90 days"
                : "90+ days";
        }

        foreach (var i in outstanding)
            report.Lines.Add(new FinanceReportLine
            {
                C1 = i.NumberDisplay,
                C2 = i.DueDateDisplay,
                C3 = M(i.BalanceDue),
                C4 = Bucket(i.DueDate, asOf)
            });

        report.Lines.Add(new FinanceReportLine
        {
            C1 = "Total outstanding",
            C3 = M(VatCalculator.RoundFinancialValues(outstanding.Sum(i => i.BalanceDue))),
            IsTotal = true
        });
        return report;
    }

    private async Task<FinanceReport> BuildApReportAsync(Guid companyId, string periodLabel)
    {
        var supplier = await GetSupplierInvoicesAsync(companyId);
        var payouts = await GetContractorPayoutsAsync(companyId);

        var report = new FinanceReport
        {
            Title = "Accounts Payable",
            PeriodLabel = periodLabel,
            FileBaseName = "accounts-payable",
            ColumnCount = 4,
            H1 = "Reference",
            H2 = "Due",
            H3 = "Balance",
            H4 = "Status",
        };

        report.Lines.Add(new FinanceReportLine { C1 = "SUPPLIER INVOICES", IsHeader = true });
        var outSupplier = supplier.Where(s => s.IsOutstanding).OrderByDescending(s => s.BalanceDue).ToList();
        foreach (var s in outSupplier)
            report.Lines.Add(new FinanceReportLine
            {
                C1 = s.InvoiceNumber ?? "(no number)",
                C2 = s.DueDateDisplay,
                C3 = M(s.BalanceDue),
                C4 = s.StatusLabel
            });

        report.Lines.Add(new FinanceReportLine { C1 = "CONTRACTOR PAYOUTS", IsHeader = true });
        var outPayouts = payouts.Where(p => p.PayoutStatusRaw is "pending" or "approved").OrderByDescending(p => p.NetPayable).ToList();
        foreach (var p in outPayouts)
            report.Lines.Add(new FinanceReportLine
            {
                C1 = "Payout",
                C2 = p.PayoutDateDisplay,
                C3 = M(p.NetPayable),
                C4 = p.PayoutStatusLabel
            });

        var total = VatCalculator.RoundFinancialValues(outSupplier.Sum(s => s.BalanceDue) + outPayouts.Sum(p => p.NetPayable));
        report.Lines.Add(new FinanceReportLine { C1 = "Total payable", C3 = M(total), IsTotal = true });
        return report;
    }

    private async Task<FinanceReport> BuildCashflowReportAsync(Guid companyId, DateOnly start, DateOnly end, string periodLabel)
    {
        var transactions = await GetFinanceTransactionsAsync(companyId, start, end);

        var report = new FinanceReport
        {
            Title = "Cashflow Statement",
            PeriodLabel = periodLabel,
            FileBaseName = "cashflow-statement",
            ColumnCount = 4,
            H1 = "Period",
            H2 = "Money In",
            H3 = "Money Out",
            H4 = "Net",
        };

        decimal totalIn = 0, totalOut = 0;
        foreach (var (label, mStart, mEnd) in MonthBuckets(start, end))
        {
            bool In(DateOnly d) => d >= mStart && d <= mEnd;
            var inMoney = VatCalculator.RoundFinancialValues(transactions.Where(t => t.IsIncoming && In(t.TransactionDate)).Sum(t => t.TotalAmount));
            var outMoney = VatCalculator.RoundFinancialValues(transactions.Where(t => !t.IsIncoming && In(t.TransactionDate)).Sum(t => t.TotalAmount));
            totalIn += inMoney;
            totalOut += outMoney;
            report.Lines.Add(new FinanceReportLine
            {
                C1 = label,
                C2 = M(inMoney),
                C3 = M(outMoney),
                C4 = M(VatCalculator.RoundFinancialValues(inMoney - outMoney))
            });
        }

        report.Lines.Add(new FinanceReportLine
        {
            C1 = "Total",
            C2 = M(VatCalculator.RoundFinancialValues(totalIn)),
            C3 = M(VatCalculator.RoundFinancialValues(totalOut)),
            C4 = M(VatCalculator.RoundFinancialValues(totalIn - totalOut)),
            IsTotal = true
        });
        return report;
    }

    private async Task<FinanceReport> BuildRevenueExpenseReportAsync(Guid companyId, DateOnly start, DateOnly end, string periodLabel)
    {
        var invoices = await GetFinanceInvoicesAsync(companyId);
        var supplier = await GetSupplierInvoicesAsync(companyId);

        var report = new FinanceReport
        {
            Title = "Revenue & Expense Trend",
            PeriodLabel = periodLabel,
            FileBaseName = "revenue-expense-trend",
            ColumnCount = 4,
            H1 = "Period",
            H2 = "Revenue",
            H3 = "Expenses",
            H4 = "Profit",
        };

        decimal totalRev = 0, totalExp = 0;
        foreach (var (label, mStart, mEnd) in MonthBuckets(start, end))
        {
            bool In(DateOnly d) => d >= mStart && d <= mEnd;
            var rev = VatCalculator.RoundFinancialValues(
                invoices.Where(i => i.StatusRaw is not ("draft" or "cancelled") && In(i.IssueDate)).Sum(i => i.Subtotal));
            var exp = VatCalculator.RoundFinancialValues(
                supplier.Where(s => s.StatusRaw != "cancelled" && s.DueDate.HasValue && In(s.DueDate.Value)).Sum(s => s.Subtotal));
            totalRev += rev;
            totalExp += exp;
            report.Lines.Add(new FinanceReportLine
            {
                C1 = label,
                C2 = M(rev),
                C3 = M(exp),
                C4 = M(VatCalculator.RoundFinancialValues(rev - exp))
            });
        }

        report.Lines.Add(new FinanceReportLine
        {
            C1 = "Total",
            C2 = M(VatCalculator.RoundFinancialValues(totalRev)),
            C3 = M(VatCalculator.RoundFinancialValues(totalExp)),
            C4 = M(VatCalculator.RoundFinancialValues(totalRev - totalExp)),
            IsTotal = true
        });
        return report;
    }

    private async Task<FinanceReport> BuildSpendReportAsync(Guid companyId, DateOnly start, DateOnly end, string periodLabel)
    {
        var transactions = await GetFinanceTransactionsAsync(companyId, start, end);
        var outgoing = transactions.Where(t => !t.IsIncoming).ToList();
        var total = VatCalculator.RoundFinancialValues(outgoing.Sum(t => t.TotalAmount));

        var report = new FinanceReport
        {
            Title = "Spend Analysis",
            PeriodLabel = periodLabel,
            FileBaseName = "spend-analysis",
            ColumnCount = 3,
            H1 = "Category",
            H2 = "Amount",
            H3 = "% of spend",
        };

        var grouped = outgoing
            .GroupBy(t => t.TypeLabel)
            .Select(g => new { g.Key, Sum = VatCalculator.RoundFinancialValues(g.Sum(x => x.TotalAmount)) })
            .OrderByDescending(g => g.Sum)
            .ToList();

        foreach (var g in grouped)
            report.Lines.Add(new FinanceReportLine
            {
                C1 = g.Key,
                C2 = M(g.Sum),
                C3 = total > 0 ? $"{g.Sum / total * 100:N1}%" : "0.0%"
            });

        report.Lines.Add(new FinanceReportLine { C1 = "Total spend", C2 = M(total), C3 = "100.0%", IsTotal = true });
        return report;
    }
}
