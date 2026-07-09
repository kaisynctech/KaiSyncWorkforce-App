namespace KaiFlow.Timesheets.Services;

/// <summary>Client portal session — portal codes stored in SecureStorage.</summary>
public static class ClientPortalSessionStore
{
    private const string SigningOutKey = "client_portal_signing_out";
    private const string ClientIdKey = "client_portal_client_id";
    private const string CompanyIdKey = "client_portal_company_id";
    private const string ClientNameKey = "client_portal_client_name";
    private const string CompanyCodeKey = "client_portal_company_code";
    private const string ClientCodeKey = "client_portal_client_code";
    private const string LegacyMigratedKey = "client_portal_secure_migrated";

    public static async Task SaveAsync(Guid clientId, Guid companyId, string clientName, string companyCode, string clientCode)
    {
        await PersistAsync(clientId, companyId, clientName, companyCode, clientCode);
    }

    public static void Clear()
    {
        SecureStorage.Remove(ClientIdKey);
        SecureStorage.Remove(CompanyIdKey);
        SecureStorage.Remove(ClientNameKey);
        SecureStorage.Remove(CompanyCodeKey);
        SecureStorage.Remove(ClientCodeKey);
        ClearLegacyPrefs();
        Preferences.Remove(LegacyMigratedKey);
    }

    public static void ClearForSignOut()
    {
        Preferences.Set(SigningOutKey, true);
        Clear();
        Preferences.Set("client_portal_skip_auto_restore", true);
    }

    public static bool IsSigningOut => Preferences.Get(SigningOutKey, false);

    public static void CompleteSignOut() => Preferences.Remove(SigningOutKey);

    public static bool ConsumeSkipAutoRestore()
    {
        if (!Preferences.Get("client_portal_skip_auto_restore", false))
            return false;
        Preferences.Remove("client_portal_skip_auto_restore");
        return true;
    }

    public static bool HasSession
    {
        get
        {
            MigrateLegacyIfNeeded();
            return Guid.TryParse(ReadSecure(ClientIdKey), out _)
                && Guid.TryParse(ReadSecure(CompanyIdKey), out _);
        }
    }

    private static string ReadKey(Guid dealId) => $"client_portal_msg_read_{dealId}";

    public static DateTime? GetDealMessagesReadAtUtc(Guid dealId)
    {
        var ticks = Preferences.Get(ReadKey(dealId), 0L);
        return ticks > 0 ? new DateTime(ticks, DateTimeKind.Utc) : null;
    }

    public static void MarkDealMessagesRead(Guid dealId, DateTime? atUtc = null)
    {
        var utc = atUtc ?? DateTime.UtcNow;
        Preferences.Set(ReadKey(dealId), utc.Ticks);
    }

    public static (Guid ClientId, Guid CompanyId, string ClientName, string CompanyCode, string ClientCode)? Get()
    {
        MigrateLegacyIfNeeded();
        if (!Guid.TryParse(ReadSecure(ClientIdKey), out var clientId)) return null;
        if (!Guid.TryParse(ReadSecure(CompanyIdKey), out var companyId)) return null;
        return (
            clientId,
            companyId,
            ReadSecure(ClientNameKey) ?? "",
            ReadSecure(CompanyCodeKey) ?? "",
            ReadSecure(ClientCodeKey) ?? "");
    }

    private static async Task PersistAsync(
        Guid clientId, Guid companyId, string clientName, string companyCode, string clientCode)
    {
        try
        {
            await SecureStorage.SetAsync(ClientIdKey, clientId.ToString());
            await SecureStorage.SetAsync(CompanyIdKey, companyId.ToString());
            await SecureStorage.SetAsync(ClientNameKey, clientName);
            await SecureStorage.SetAsync(CompanyCodeKey, companyCode);
            await SecureStorage.SetAsync(ClientCodeKey, clientCode);
            Preferences.Set(LegacyMigratedKey, true);
            ClearLegacyPrefs();
        }
        catch
        {
            AppTelemetrySink.LogSecureStorageFailure("client_portal_session");
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
        var clientId = Preferences.Get(ClientIdKey, "");
        if (string.IsNullOrWhiteSpace(clientId)) { Preferences.Set(LegacyMigratedKey, true); return; }
        try
        {
            foreach (var (k, v) in new (string, string)[]
            {
                (ClientIdKey, Preferences.Get(ClientIdKey, "")),
                (CompanyIdKey, Preferences.Get(CompanyIdKey, "")),
                (ClientNameKey, Preferences.Get(ClientNameKey, "")),
                (CompanyCodeKey, Preferences.Get(CompanyCodeKey, "")),
                (ClientCodeKey, Preferences.Get(ClientCodeKey, "")),
            })
            {
                if (!string.IsNullOrWhiteSpace(v))
                    Task.Run(() => SecureStorage.SetAsync(k, v)).GetAwaiter().GetResult();
            }
            ClearLegacyPrefs();
            Preferences.Set(LegacyMigratedKey, true);
            AppTelemetrySink.LogTokenRestored("client_portal_legacy_migration");
        }
        catch { AppTelemetrySink.LogSecureStorageFailure("client_portal_migration"); }
    }

    private static void ClearLegacyPrefs()
    {
        Preferences.Remove(ClientIdKey);
        Preferences.Remove(CompanyIdKey);
        Preferences.Remove(ClientNameKey);
        Preferences.Remove(CompanyCodeKey);
        Preferences.Remove(ClientCodeKey);
    }
}
