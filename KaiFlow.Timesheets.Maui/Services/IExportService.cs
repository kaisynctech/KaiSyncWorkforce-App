using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public interface IExportService
{
    /// <summary>true = save to Downloads, false = share/email, null = cancelled.</summary>
    Task<bool?> AskExportDeliveryAsync(string title);

    Task ExportToCsvAsync(string fileName, IEnumerable<string> headers, IEnumerable<IEnumerable<string>> rows, string source = "export");
    Task ExportToExcelAsync(string fileName, string sheetTitle, IEnumerable<string> headers, IEnumerable<IEnumerable<string>> rows, bool downloadToDevice = false);
    Task ExportToPdfAsync(string fileName, string title, IEnumerable<string> headers, IEnumerable<IEnumerable<string>> rows, bool downloadToDevice = false);
    Task ExportPayslipPdfAsync(PaymentApproval payment, string employeeName, string companyName, bool downloadToDevice = false);
    Task ExportQuotationPdfAsync(Client? client, ClientDeal deal, IEnumerable<ProjectQuotationLine> lines, string? companyName, bool downloadToDevice = false);
    Task ExportContractorRemittancePdfAsync(ContractorPayout payout, string contractorName, string companyName, bool downloadToDevice = false);
    Task DeliverRemoteFileAsync(string url, string suggestedFileName);
    Task ExportEmployeeImportTemplateAsync(IReadOnlyList<EmployeeShiftTemplate> templates);
    Task<EmployeeImportParseResult> ParseEmployeeImportFileAsync(
        string filePath,
        Guid companyId,
        IReadOnlySet<string> existingLoginIdentifiers,
        EmployeeImportContext? templateContext = null);
}
