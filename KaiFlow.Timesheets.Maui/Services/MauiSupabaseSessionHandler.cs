using Supabase.Gotrue.Interfaces;
using Supabase.Gotrue;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Persists Supabase JWT sessions to MAUI SecureStorage (Preferences used only for one-time migration).
/// </summary>
public class MauiSupabaseSessionHandler : IGotrueSessionPersistence<Session>
{
    private const string SessionKey = "supabase_session";
    private const string LegacyMigratedKey = "supabase_session_secure_migrated";

    public void SaveSession(Session session)
    {
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(session);
        Preferences.Remove(SessionKey);
        _ = Task.Run(async () =>
        {
            try
            {
                await SecureStorage.SetAsync(SessionKey, json);
                Preferences.Set(LegacyMigratedKey, true);
            }
            catch
            {
                AppTelemetrySink.LogSecureStorageFailure(SessionKey);
            }
        });
    }

    public void DestroySession()
    {
        SecureStorage.Remove(SessionKey);
        Preferences.Remove(SessionKey);
        Preferences.Remove(LegacyMigratedKey);
    }

    public Session? LoadSession()
    {
        MigrateLegacyIfNeeded();
        try
        {
            // Task.Run offloads to the thread pool so the SynchronizationContext is not
            // captured. Without this, GetAwaiter().GetResult() deadlocks on WinUI because
            // SecureStorage dispatches its completion back to the UI thread, which is
            // already blocked waiting for GetResult().
            var json = Task.Run(() => SecureStorage.GetAsync(SessionKey)).GetAwaiter().GetResult();
            if (string.IsNullOrEmpty(json))
            {
                AppTelemetrySink.LogTokenMissing("supabase_jwt");
                return null;
            }

            AppTelemetrySink.LogTokenRestored("supabase_jwt");
            return Newtonsoft.Json.JsonConvert.DeserializeObject<Session>(json);
        }
        catch
        {
            AppTelemetrySink.LogSecureStorageFailure(SessionKey);
            return null;
        }
    }

    private static void MigrateLegacyIfNeeded()
    {
        if (Preferences.Get(LegacyMigratedKey, false))
            return;

        var json = Preferences.Get(SessionKey, null as string);
        if (string.IsNullOrEmpty(json))
        {
            Preferences.Set(LegacyMigratedKey, true);
            return;
        }

        try
        {
            Task.Run(() => SecureStorage.SetAsync(SessionKey, json)).GetAwaiter().GetResult();
            Preferences.Remove(SessionKey);
            Preferences.Set(LegacyMigratedKey, true);
            AppTelemetrySink.LogTokenRestored("supabase_jwt_legacy_migration");
        }
        catch
        {
            AppTelemetrySink.LogSecureStorageFailure("supabase_jwt_migration");
        }
    }
}
