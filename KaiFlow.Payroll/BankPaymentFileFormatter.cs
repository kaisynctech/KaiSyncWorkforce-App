namespace KaiFlow.Payroll;

public record BankPaymentRow(
    string EmployeeName,
    string BankName,
    string BranchCode,
    string AccountNumber,
    double NetPay,
    string Reference,
    string? IdNumber);

public static class BankPaymentFileFormatter
{
    public static IReadOnlyList<string[]> ToGenericCsv(IEnumerable<BankPaymentRow> rows) =>
        rows.Select(r => new[]
        {
            r.EmployeeName, r.BankName, r.BranchCode, r.AccountNumber,
            r.NetPay.ToString("F2"), r.Reference
        }).ToList();

    /// <summary>FNB-style bulk payment CSV (simplified).</summary>
    public static IReadOnlyList<string[]> ToFnbCsv(IEnumerable<BankPaymentRow> rows) =>
        rows.Select(r => new[]
        {
            r.AccountNumber,
            r.BranchCode,
            " ",
            r.NetPay.ToString("F2"),
            r.EmployeeName,
            r.Reference,
            "Salary"
        }).ToList();

    /// <summary>ABSA-style CSV (simplified).</summary>
    public static IReadOnlyList<string[]> ToAbsaCsv(IEnumerable<BankPaymentRow> rows) =>
        rows.Select(r => new[]
        {
            r.AccountNumber,
            r.BranchCode,
            r.EmployeeName,
            r.NetPay.ToString("F2"),
            r.Reference
        }).ToList();

    /// <summary>Standard Bank CSV (simplified).</summary>
    public static IReadOnlyList<string[]> ToStandardBankCsv(IEnumerable<BankPaymentRow> rows) =>
        rows.Select(r => new[]
        {
            r.EmployeeName,
            r.AccountNumber,
            r.BranchCode,
            r.NetPay.ToString("F2"),
            r.Reference,
            "C"
        }).ToList();

    public static (string[] Headers, IReadOnlyList<string[]> Rows) Format(
        string format,
        IEnumerable<BankPaymentRow> rows)
    {
        var list = rows.ToList();
        return format.ToLowerInvariant() switch
        {
            "fnb" => (["Account", "Branch", "Type", "Amount", "Name", "Reference", "Description"], ToFnbCsv(list)),
            "absa" => (["Account", "Branch", "Name", "Amount", "Reference"], ToAbsaCsv(list)),
            "standard_bank" or "std" => (["Name", "Account", "Branch", "Amount", "Reference", "Type"], ToStandardBankCsv(list)),
            _ => (["Employee", "Bank", "Branch Code", "Account", "Net Pay", "Reference"], ToGenericCsv(list))
        };
    }
}
