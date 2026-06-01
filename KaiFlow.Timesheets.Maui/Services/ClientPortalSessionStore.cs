namespace KaiFlow.Timesheets.Services;

public static class ClientPortalSessionStore
{
    private const string SigningOutKey = "client_portal_signing_out";
    private const string ClientIdKey = "client_portal_client_id";
    private const string CompanyIdKey = "client_portal_company_id";
    private const string ClientNameKey = "client_portal_client_name";
    private const string CompanyCodeKey = "client_portal_company_code";
    private const string ClientCodeKey = "client_portal_client_code";

    public static void Save(Guid clientId, Guid companyId, string clientName, string companyCode, string clientCode)
    {
        Preferences.Set(ClientIdKey, clientId.ToString());
        Preferences.Set(CompanyIdKey, companyId.ToString());
        Preferences.Set(ClientNameKey, clientName);
        Preferences.Set(CompanyCodeKey, companyCode);
        Preferences.Set(ClientCodeKey, clientCode);
    }

    public static void Clear()
    {
        Preferences.Remove(ClientIdKey);
        Preferences.Remove(CompanyIdKey);
        Preferences.Remove(ClientNameKey);
        Preferences.Remove(CompanyCodeKey);
        Preferences.Remove(ClientCodeKey);
    }

    /// <summary>Clears portal session when user signs out; blocks re-entrant navigation while shell transitions.</summary>
    public static void ClearForSignOut()
    {
        Preferences.Set(SigningOutKey, true);
        Clear();
        Preferences.Set("client_portal_skip_auto_restore", true);
    }

    public static bool IsSigningOut => Preferences.Get(SigningOutKey, false);

    public static void CompleteSignOut()
    {
        Preferences.Remove(SigningOutKey);
    }

    public static bool ConsumeSkipAutoRestore()
    {
        if (!Preferences.Get("client_portal_skip_auto_restore", false))
            return false;
        Preferences.Remove("client_portal_skip_auto_restore");
        return true;
    }

    public static bool HasSession =>
        Guid.TryParse(Preferences.Get(ClientIdKey, ""), out _) &&
        Guid.TryParse(Preferences.Get(CompanyIdKey, ""), out _);

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
        if (!Guid.TryParse(Preferences.Get(ClientIdKey, ""), out var clientId)) return null;
        if (!Guid.TryParse(Preferences.Get(CompanyIdKey, ""), out var companyId)) return null;
        return (
            clientId,
            companyId,
            Preferences.Get(ClientNameKey, ""),
            Preferences.Get(CompanyCodeKey, ""),
            Preferences.Get(ClientCodeKey, ""));
    }
}
