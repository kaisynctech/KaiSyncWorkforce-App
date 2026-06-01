namespace KaiFlow.Timesheets.Constants;

/// <summary>
/// Supabase connection settings. Prefer environment-specific overrides at build/deploy time.
/// Production values remain in <see cref="SupabaseConfig"/> until multi-env pipeline is wired.
/// </summary>
public static class SupabaseEnvironment
{
    /// <summary>Override via MAUI environment variable SUPABASE_URL at build if set.</summary>
    public static string Url =>
        Environment.GetEnvironmentVariable("SUPABASE_URL") ?? SupabaseConfig.Url;

    /// <summary>Override via MAUI environment variable SUPABASE_ANON_KEY at build if set.</summary>
    public static string AnonKey =>
        Environment.GetEnvironmentVariable("SUPABASE_ANON_KEY") ?? SupabaseConfig.AnonKey;

    public static bool IsProduction =>
        Url.Contains("vcivtjwreybaxgtdhtou", StringComparison.OrdinalIgnoreCase);
}
