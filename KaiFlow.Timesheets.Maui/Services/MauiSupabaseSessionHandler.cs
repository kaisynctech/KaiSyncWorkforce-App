using Supabase.Gotrue.Interfaces;
using Supabase.Gotrue;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Persists Supabase sessions to MAUI SecureStorage.
/// </summary>
public class MauiSupabaseSessionHandler : IGotrueSessionPersistence<Session>
{
    private const string SessionKey = "supabase_session";

    public void SaveSession(Session session)
    {
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(session);
        Preferences.Set(SessionKey, json);
        _ = Task.Run(async () =>
        {
            try { await SecureStorage.SetAsync(SessionKey, json); }
            catch { /* non-fatal — session will be re-fetched on next sign-in */ }
        });
    }

    public void DestroySession()
    {
        Preferences.Remove(SessionKey);
        SecureStorage.Remove(SessionKey);
    }

    public Session? LoadSession()
    {
        try
        {
            var json = Preferences.Get(SessionKey, null);
            if (string.IsNullOrEmpty(json))
                return null;
            return Newtonsoft.Json.JsonConvert.DeserializeObject<Session>(json);
        }
        catch
        {
            return null;
        }
    }
}
