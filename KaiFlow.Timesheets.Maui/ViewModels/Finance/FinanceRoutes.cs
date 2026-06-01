namespace KaiFlow.Timesheets.ViewModels.Finance;

/// <summary>
/// Shell route names for the Finance module. Kept as constants so ViewModels can
/// navigate before the page types are referenced, and so Phase 6 registers the
/// exact same route strings.
/// </summary>
public static class FinanceRoutes
{
    public const string Dashboard = "FinanceDashboardPage";
    public const string Invoices = "FinanceInvoicesPage";
    public const string InvoiceDetail = "FinanceInvoiceDetailPage";
    public const string SupplierInvoices = "SupplierInvoicesPage";
    public const string ContractorPayouts = "ContractorPayoutsPage";
    public const string Vat = "FinanceVatPage";
    public const string Cashflow = "FinanceCashflowPage";
    public const string Reports = "FinanceReportsPage";
    public const string Approvals = "FinanceApprovalsPage";
}
