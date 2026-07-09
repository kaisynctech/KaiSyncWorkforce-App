namespace KaiFlow.Timesheets.Services;

/// <summary>Contractor portal session — portal codes stored in SecureStorage.</summary>
public static class ContractorPortalSessionStore
{
    private const string ContractorIdKey = "contractor_portal_contractor_id";
    private const string CompanyIdKey = "contractor_portal_company_id";
    private const string ContractorNameKey = "contractor_portal_contractor_name";
    private const string CompanyCodeKey = "contractor_portal_company_code";
    private const string ContractorCodeKey = "contractor_portal_contractor_code";
    private const string LegacyMigratedKey = "contractor_portal_secure_migrated";
    private const string SigningOutKey = "contractor_portal_signing_out";

    public static void ClearForSignOut()
    {
        Preferences.Set(SigningOutKey, true);
        Clear();
        Preferences.Set("contractor_portal_skip_auto_restore", true);
    }

    public static bool IsSigningOut => Preferences.Get(SigningOutKey, false);

    public static void CompleteSignOut() => Preferences.Remove(SigningOutKey);

    public static bool ConsumeSkipAutoRestore()
    {
        if (!Preferences.Get("contractor_portal_skip_auto_restore", false))
            return false;
        Preferences.Remove("contractor_portal_skip_auto_restore");
        return true;
    }

    public static async Task SaveAsync(Guid contractorId, Guid companyId, string contractorName, string companyCode, string contractorCode)
    {
        await PersistAsync(contractorId, companyId, contractorName, companyCode, contractorCode);
    }

    public static void Clear()
    {
        SecureStorage.Remove(ContractorIdKey);
        SecureStorage.Remove(CompanyIdKey);
        SecureStorage.Remove(ContractorNameKey);
        SecureStorage.Remove(CompanyCodeKey);
        SecureStorage.Remove(ContractorCodeKey);
        ClearLegacyPrefs();
        Preferences.Remove(LegacyMigratedKey);
    }

    public static bool HasSession
    {
        get
        {
            MigrateLegacyIfNeeded();
            return Guid.TryParse(ReadSecure(ContractorIdKey), out _)
                && Guid.TryParse(ReadSecure(CompanyIdKey), out _);
        }
    }

    public static (Guid ContractorId, Guid CompanyId, string ContractorName, string CompanyCode, string ContractorCode)? Get()
    {
        MigrateLegacyIfNeeded();
        if (!Guid.TryParse(ReadSecure(ContractorIdKey), out var contractorId)) return null;
        if (!Guid.TryParse(ReadSecure(CompanyIdKey), out var companyId)) return null;
        return (
            contractorId,
            companyId,
            ReadSecure(ContractorNameKey) ?? "",
            ReadSecure(CompanyCodeKey) ?? "",
            ReadSecure(ContractorCodeKey) ?? "");
    }

    private static async Task PersistAsync(
        Guid contractorId, Guid companyId, string contractorName, string companyCode, string contractorCode)
    {
        try
        {
            await SecureStorage.SetAsync(ContractorIdKey, contractorId.ToString());
            await SecureStorage.SetAsync(CompanyIdKey, companyId.ToString());
            await SecureStorage.SetAsync(ContractorNameKey, contractorName);
            await SecureStorage.SetAsync(CompanyCodeKey, companyCode);
            await SecureStorage.SetAsync(ContractorCodeKey, contractorCode);
            Preferences.Set(LegacyMigratedKey, true);
            ClearLegacyPrefs();
        }
        catch
        {
            AppTelemetrySink.LogSecureStorageFailure("contractor_portal_session");
            throw;
        }
    }

    private static string? ReadSecure(string key)
    {
        try { return Task.Run(() => SecureStorage.GetAsync(key)).GetAwaiter().GetResult(); }
        catch { AppTelemetrySink.LogSecureStorageFailure(key); return null; }
    }

    private static void MigrateLegacyIfNeeded()
    {
        if (Preferences.Get(LegacyMigratedKey, false)) return;
        var contractorId = Preferences.Get(ContractorIdKey, "");
        if (string.IsNullOrWhiteSpace(contractorId)) { Preferences.Set(LegacyMigratedKey, true); return; }
        try
        {
            foreach (var (k, v) in new (string, string)[]
            {
                (ContractorIdKey, Preferences.Get(ContractorIdKey, "")),
                (CompanyIdKey, Preferences.Get(CompanyIdKey, "")),
                (ContractorNameKey, Preferences.Get(ContractorNameKey, "")),
                (CompanyCodeKey, Preferences.Get(CompanyCodeKey, "")),
                (ContractorCodeKey, Preferences.Get(ContractorCodeKey, "")),
            })
            {
                if (!string.IsNullOrWhiteSpace(v))
                    Task.Run(() => SecureStorage.SetAsync(k, v)).GetAwaiter().GetResult();
            }
            ClearLegacyPrefs();
            Preferences.Set(LegacyMigratedKey, true);
            AppTelemetrySink.LogTokenRestored("contractor_portal_legacy_migration");
        }
        catch { AppTelemetrySink.LogSecureStorageFailure("contractor_portal_migration"); }
    }

    private static void ClearLegacyPrefs()
    {
        Preferences.Remove(ContractorIdKey);
        Preferences.Remove(CompanyIdKey);
        Preferences.Remove(ContractorNameKey);
        Preferences.Remove(CompanyCodeKey);
        Preferences.Remove(ContractorCodeKey);
    }
}
