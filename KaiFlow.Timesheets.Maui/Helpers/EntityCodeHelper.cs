namespace KaiFlow.Timesheets.Helpers;

/// <summary>Company-scoped codes: C28xxxx clients, P28xxxx projects, J28xxxx jobs.</summary>
public static class EntityCodeHelper
{
    public static string ClientPrefix(string companyCode) => BuildPrefix(companyCode, "C");
    public static string ProjectPrefix(string companyCode) => BuildPrefix(companyCode, "P");
    public static string JobPrefix(string companyCode) => BuildPrefix(companyCode, "J");
    public static string ContractorPrefix(string companyCode) => BuildPrefix(companyCode, "CT");

    public static string BuildPrefix(string companyCode, string letter)
    {
        var normalized = new string(companyCode
            .Trim()
            .ToUpperInvariant()
            .Where(char.IsLetterOrDigit)
            .ToArray());
        return string.IsNullOrEmpty(normalized) ? letter : $"{letter}{normalized}";
    }

    public static string NextCode(string prefix, IEnumerable<string?> existingCodes)
    {
        var max = 0;
        foreach (var code in existingCodes)
        {
            if (string.IsNullOrWhiteSpace(code)) continue;
            var trimmed = code.Trim().ToUpperInvariant();
            if (!trimmed.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
            var suffix = trimmed[prefix.Length..];
            if (int.TryParse(suffix, out var n) && n > max)
                max = n;
        }

        return $"{prefix}{max + 1:D4}";
    }
}
