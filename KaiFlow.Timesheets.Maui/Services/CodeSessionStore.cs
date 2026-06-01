namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Stores code-login credentials and Supabase session token only.
/// Company/employee data always comes from Supabase RPCs.
/// </summary>
public static class CodeSessionStore
{
    private const string CompanyCodeKey = "code_login_company_code";
    private const string EmployeeCodeKey = "code_login_employee_code";
    private const string SessionTokenKey = "code_login_session_token";

    public static void Save(string companyCode, string employeeCode, string sessionToken)
    {
        Preferences.Set(CompanyCodeKey, companyCode.Trim().ToUpperInvariant());
        Preferences.Set(EmployeeCodeKey, employeeCode.Trim());
        Preferences.Set(SessionTokenKey, sessionToken);
    }

    public static void Clear()
    {
        Preferences.Remove(CompanyCodeKey);
        Preferences.Remove(EmployeeCodeKey);
        Preferences.Remove(SessionTokenKey);
    }

    public static (string CompanyCode, string EmployeeCode)? GetCredentials()
    {
        var companyCode = Preferences.Get(CompanyCodeKey, "");
        var employeeCode = Preferences.Get(EmployeeCodeKey, "");
        if (string.IsNullOrWhiteSpace(companyCode) || string.IsNullOrWhiteSpace(employeeCode))
            return null;
        return (companyCode, employeeCode);
    }

    public static string? GetSessionToken()
        => Preferences.Get(SessionTokenKey, null);

    public static bool HasCodeSession()
        => !string.IsNullOrWhiteSpace(GetSessionToken()) || GetCredentials().HasValue;
}
