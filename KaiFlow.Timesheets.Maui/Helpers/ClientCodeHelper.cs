namespace KaiFlow.Timesheets.Helpers;

public static class ClientCodeHelper
{
    public static string BuildPrefix(string companyCode) => EntityCodeHelper.ClientPrefix(companyCode);
    public static string NextCode(string prefix, IEnumerable<string?> existingCodes) =>
        EntityCodeHelper.NextCode(prefix, existingCodes);

    public static string PortalLoginHint(string companyCode, string clientCode) =>
        $"KaiFlow client portal\n" +
        $"1. Open the app → Client portal sign-in\n" +
        $"2. Company code: {companyCode.Trim().ToUpperInvariant()}\n" +
        $"3. Client code: {clientCode.Trim().ToUpperInvariant()}";
}
