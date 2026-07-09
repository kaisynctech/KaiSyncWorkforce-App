namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Stores code-login credentials and Supabase session token in SecureStorage.
/// Legacy Preferences values are migrated once on read.
/// </summary>
public static class CodeSessionStore
{
    // ── Storage keys ────────────────────────────────────────────────────────

    private const string CompanyCodeKey    = "code_login_company_code";
    private const string EmployeeCodeKey   = "code_login_employee_code";
    private const string SessionTokenKey   = "code_login_session_token";
    private const string LegacyMigratedKey = "code_login_secure_migrated";

    // ── Write ─────────────────────────────────────────────────────────────────

    public static async Task SaveAsync(string companyCode, string employeeCode, string sessionToken)
    {
        var company  = companyCode.Trim().ToUpperInvariant();
        var employee = employeeCode.Trim();

        await PersistAsync(company, employee, sessionToken);

        // Remove any legacy plaintext copies only after the secure write succeeds.
        Preferences.Remove(CompanyCodeKey);
        Preferences.Remove(EmployeeCodeKey);
        Preferences.Remove(SessionTokenKey);
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    public static string? GetSessionToken()
    {
        MigrateLegacyIfNeeded();
        return ReadSecure(SessionTokenKey);
    }

    public static (string CompanyCode, string EmployeeCode)? GetCredentials()
    {
        MigrateLegacyIfNeeded();
        var companyCode  = ReadSecure(CompanyCodeKey);
        var employeeCode = ReadSecure(EmployeeCodeKey);
        if (string.IsNullOrWhiteSpace(companyCode) || string.IsNullOrWhiteSpace(employeeCode))
            return null;
        return (companyCode, employeeCode);
    }

    // ── Status checks ─────────────────────────────────────────────────────────

    public static bool HasCodeSession()
        => !string.IsNullOrWhiteSpace(GetSessionToken()) || GetCredentials().HasValue;

    // ── Clear ─────────────────────────────────────────────────────────────────

    public static void Clear()
    {
        SecureStorage.Remove(CompanyCodeKey);
        SecureStorage.Remove(EmployeeCodeKey);
        SecureStorage.Remove(SessionTokenKey);
        Preferences.Remove(CompanyCodeKey);
        Preferences.Remove(EmployeeCodeKey);
        Preferences.Remove(SessionTokenKey);
        Preferences.Remove(LegacyMigratedKey);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static string? ReadSecure(string key)
    {
        try
        {
            // Task.Run offloads to the thread pool so the SynchronizationContext is not
            // captured. Without this, GetAwaiter().GetResult() deadlocks on WinUI because
            // SecureStorage dispatches its completion back to the UI thread, which is
            // already blocked waiting for GetResult().
            return Task.Run(() => SecureStorage.GetAsync(key)).GetAwaiter().GetResult();
        }
        catch
        {
            AppTelemetrySink.LogSecureStorageFailure(key);
            return null;
        }
    }

    private static async Task PersistAsync(string companyCode, string employeeCode, string sessionToken)
    {
        await SecureStorage.SetAsync(CompanyCodeKey,  companyCode);
        await SecureStorage.SetAsync(EmployeeCodeKey, employeeCode);
        await SecureStorage.SetAsync(SessionTokenKey, sessionToken);
        Preferences.Set(LegacyMigratedKey, true);
    }

    private static void MigrateLegacyIfNeeded()
    {
        if (Preferences.Get(LegacyMigratedKey, false))
            return;

        var legacyCompany  = Preferences.Get(CompanyCodeKey,  "");
        var legacyEmployee = Preferences.Get(EmployeeCodeKey, "");
        var legacyToken    = Preferences.Get(SessionTokenKey, null as string);

        if (string.IsNullOrWhiteSpace(legacyCompany)
            && string.IsNullOrWhiteSpace(legacyEmployee)
            && string.IsNullOrWhiteSpace(legacyToken))
        {
            Preferences.Set(LegacyMigratedKey, true);
            return;
        }

        try
        {
            if (!string.IsNullOrWhiteSpace(legacyCompany))
                Task.Run(() => SecureStorage.SetAsync(CompanyCodeKey, legacyCompany)).GetAwaiter().GetResult();
            if (!string.IsNullOrWhiteSpace(legacyEmployee))
                Task.Run(() => SecureStorage.SetAsync(EmployeeCodeKey, legacyEmployee)).GetAwaiter().GetResult();
            if (!string.IsNullOrWhiteSpace(legacyToken))
            {
                Task.Run(() => SecureStorage.SetAsync(SessionTokenKey, legacyToken)).GetAwaiter().GetResult();
                AppTelemetrySink.LogTokenRestored("code_session_legacy_migration");
            }

            Preferences.Remove(CompanyCodeKey);
            Preferences.Remove(EmployeeCodeKey);
            Preferences.Remove(SessionTokenKey);
            Preferences.Set(LegacyMigratedKey, true);
        }
        catch
        {
            AppTelemetrySink.LogSecureStorageFailure("code_session_migration");
        }
    }
}

/// <summary>Lightweight telemetry sink for static session stores (no DI).</summary>
internal static class AppTelemetrySink
{
    public static event Action<string, Dictionary<string, string>?>? EventRaised;

    public static void LogTokenRestored(string source)
        => EventRaised?.Invoke("token_restored", new Dictionary<string, string> { ["source"] = source });

    public static void LogTokenMissing(string source)
        => EventRaised?.Invoke("token_missing", new Dictionary<string, string> { ["source"] = source });

    public static void LogSecureStorageFailure(string key)
        => EventRaised?.Invoke("secure_storage_failure", new Dictionary<string, string> { ["key"] = key });
}
