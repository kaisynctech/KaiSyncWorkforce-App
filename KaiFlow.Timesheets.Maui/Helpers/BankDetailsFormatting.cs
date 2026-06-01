namespace KaiFlow.Timesheets.Helpers;

public static class BankDetailsFormatting
{
    public static string MaskAccount(string? account)
    {
        if (string.IsNullOrWhiteSpace(account)) return "—";
        var trimmed = account.Trim();
        if (trimmed.Length <= 4) return new string('*', trimmed.Length);
        return new string('*', trimmed.Length - 4) + trimmed[^4..];
    }

    public static string UpdatedByLabel(string? updatedBy) => updatedBy switch
    {
        "hr" => "HR",
        "employee" => "Employee",
        _ => "Unknown"
    };
}
