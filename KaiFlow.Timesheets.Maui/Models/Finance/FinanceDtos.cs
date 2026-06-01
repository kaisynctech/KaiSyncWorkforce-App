namespace KaiFlow.Timesheets.Models;

/// <summary>A single point on a finance trend chart (one period bucket).</summary>
public class FinanceTrendPoint
{
    public string Label { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public decimal SecondaryValue { get; set; }
}

/// <summary>A slice of a categorical breakdown (e.g. expense categories / debtors).</summary>
public class FinanceCategorySlice
{
    public string Label { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public string Color { get; set; } = "#3B82F6";

    public string ValueDisplay => $"R{Value:N2}";
}

/// <summary>
/// Aggregated, ready-to-bind KPIs + chart series for the Finance dashboard.
/// Built server-side-style in the storage layer so the ViewModel stays thin.
/// </summary>
public class FinanceDashboardSnapshot
{
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }

    // KPI scalars
    public decimal RevenueThisPeriod { get; set; }
    public decimal OutstandingInvoices { get; set; }
    public int OutstandingInvoiceCount { get; set; }
    public decimal SupplierPayables { get; set; }
    public decimal ContractorPayables { get; set; }
    public decimal PayrollCosts { get; set; }
    public decimal OutputVat { get; set; }
    public decimal InputVat { get; set; }
    public decimal VatDue { get; set; }
    public decimal MoneyIn { get; set; }
    public decimal MoneyOut { get; set; }
    public decimal ProfitEstimate { get; set; }

    public decimal NetCashflow => MoneyIn - MoneyOut;
    public decimal TotalPayables => SupplierPayables + ContractorPayables;

    // Chart series
    public List<FinanceTrendPoint> RevenueTrend { get; set; } = new();
    public List<FinanceTrendPoint> ExpenseTrend { get; set; } = new();
    public List<FinanceTrendPoint> CashflowTrend { get; set; } = new();
    public List<FinanceTrendPoint> VatTrend { get; set; } = new();
    public List<FinanceCategorySlice> ExpenseCategories { get; set; } = new();
    public List<FinanceCategorySlice> TopDebtors { get; set; } = new();

    // Display helpers
    public string RevenueDisplay => $"R{RevenueThisPeriod:N2}";
    public string OutstandingDisplay => $"R{OutstandingInvoices:N2}";
    public string SupplierPayablesDisplay => $"R{SupplierPayables:N2}";
    public string ContractorPayablesDisplay => $"R{ContractorPayables:N2}";
    public string PayrollDisplay => $"R{PayrollCosts:N2}";
    public string VatDueDisplay => $"R{VatDue:N2}";
    public string NetCashflowDisplay => $"{(NetCashflow < 0 ? "-" : "")}R{Math.Abs(NetCashflow):N2}";
    public string ProfitDisplay => $"{(ProfitEstimate < 0 ? "-" : "")}R{Math.Abs(ProfitEstimate):N2}";
    public string NetCashflowColor => NetCashflow < 0 ? "#DC2626" : "#16A34A";
    public string ProfitColor => ProfitEstimate < 0 ? "#DC2626" : "#16A34A";
    public string PeriodLabel => $"{PeriodStart:dd MMM} – {PeriodEnd:dd MMM yyyy}";
}
