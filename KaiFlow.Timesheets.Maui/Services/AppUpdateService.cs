using KaiFlow.Timesheets.Models.Production;
using KaiFlow.Timesheets.Services.Production;

namespace KaiFlow.Timesheets.Services;

/// <summary>Legacy wrapper — delegates to <see cref="IVersionService"/> with storage JSON fallback.</summary>
public class AppUpdateService
{
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private readonly IVersionService _versions;

    public AppUpdateService(IVersionService versions) => _versions = versions;

    public async Task<(bool NeedsUpdate, string? StoreUrl)> CheckAsync()
    {
        var result = await _versions.CheckForUpdateAsync();
        if (result.UpdateAvailable)
            return (result.IsMandatory, result.StoreUrl);

        // Legacy public storage config fallback
        try
        {
            var url = $"{Constants.SupabaseConfig.Url}/storage/v1/object/public/config/app-version.json";
            var json = await _http.GetStringAsync(url);
            var config = System.Text.Json.JsonSerializer.Deserialize<LegacyVersionConfig>(json);
            if (config?.MinVersion == null) return (false, null);

            if (!_versions.IsBelowMinimum(_versions.GetInstalledVersion().Version, config.MinVersion))
                return (false, null);

            var storeUrl = DeviceInfo.Platform == DevicePlatform.Android ? config.StoreUrlAndroid
                : DeviceInfo.Platform == DevicePlatform.iOS ? config.StoreUrlIos
                : config.StoreUrlWindows;

            return (true, storeUrl);
        }
        catch
        {
            return (false, null);
        }
    }

    public Task<UpdateCheckResult> CheckDetailedAsync(CancellationToken ct = default)
        => _versions.CheckForUpdateAsync(ct);

    private record LegacyVersionConfig(
        [property: System.Text.Json.Serialization.JsonPropertyName("min_version")] string? MinVersion,
        [property: System.Text.Json.Serialization.JsonPropertyName("store_url_android")] string? StoreUrlAndroid,
        [property: System.Text.Json.Serialization.JsonPropertyName("store_url_ios")] string? StoreUrlIos,
        [property: System.Text.Json.Serialization.JsonPropertyName("store_url_windows")] string? StoreUrlWindows);
}
