namespace KaiFlow.Timesheets.Helpers;

public static class ContractorCodeHelper
{
    public static string BuildPrefix(string companyCode) => EntityCodeHelper.ContractorPrefix(companyCode);
    public static string NextCode(string prefix, IEnumerable<string?> existingCodes) =>
        EntityCodeHelper.NextCode(prefix, existingCodes);

    public static string PortalLoginHint(string companyCode, string contractorCode) =>
        $"KaiFlow contractor portal\n" +
        $"1. Open the app → Contractor portal sign-in\n" +
        $"2. Company code: {companyCode.Trim().ToUpperInvariant()}\n" +
        $"3. Contractor code: {contractorCode.Trim().ToUpperInvariant()}";
}
