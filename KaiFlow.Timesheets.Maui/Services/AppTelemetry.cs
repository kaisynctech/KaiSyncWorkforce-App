using KaiFlow.Timesheets.Models;
using Microsoft.Extensions.DependencyInjection;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Structured telemetry: debug output + durable Supabase app_events sink.
/// Code-login workers use employee_log_app_event RPC; HR JWT uses authenticated insert.
/// </summary>
public class AppTelemetry
{
    private readonly Supabase.Client _supabase;
    private readonly TimesheetStateService _state;
    private readonly IServiceProvider _services;

    // Resolve IStorageService lazily from IServiceProvider to avoid a DI circular
    // dependency: AppTelemetry -> IStorageService(SupabaseStorageService) -> RealtimeService -> AppTelemetry.
    public AppTelemetry(Supabase.Client supabase, TimesheetStateService state, IServiceProvider services)
    {
        _supabase = supabase;
        _state = state;
        _services = services;
    }

    public void LogError(Exception ex, string? context = null, Dictionary<string, string>? properties = null)
    {
        var detail = FormatProperties(properties);
        System.Diagnostics.Debug.WriteLine(
            $"[ERROR] {context}: {ex.Message}{(detail.Length > 0 ? " | " + detail : "")}\n{ex.StackTrace}");
        Persist("error", context ?? "exception", "error", ex.Message, properties);
        _ = PersistApplicationErrorAsync(context, ex, properties);
    }

    public void LogWarning(string message, string? context = null, Dictionary<string, string>? properties = null)
    {
        var detail = FormatProperties(properties);
        System.Diagnostics.Debug.WriteLine(
            $"[WARN] {context}: {message}{(detail.Length > 0 ? " | " + detail : "")}");
        Persist(context ?? "warning", message, "warning", message, properties);
    }

    public void LogEvent(string eventName, Dictionary<string, string>? properties = null)
    {
        System.Diagnostics.Debug.WriteLine(
            $"[EVENT] {eventName}: {FormatProperties(properties)}");
        Persist("event", eventName, "info", null, properties);
    }

    public void LogSuccess(string action, string? context = null, Dictionary<string, string>? properties = null)
    {
        System.Diagnostics.Debug.WriteLine(
            $"[OK] {context}: {action} | {FormatProperties(properties)}");
        Persist(context ?? "success", action, "info", null, properties);
    }

    public void LogPageView(string pageName)
    {
        System.Diagnostics.Debug.WriteLine($"[PAGE] {pageName}");
        Persist(pageName, "page_view", "info");
    }

    private static string FormatProperties(Dictionary<string, string>? properties)
        => properties is { Count: > 0 }
            ? string.Join(", ", properties.Select(kv => $"{kv.Key}={kv.Value}"))
            : "";

    private void Persist(
        string screen,
        string action,
        string level,
        string? errorText = null,
        Dictionary<string, string>? properties = null)
    {
        _ = PersistAsync(screen, action, level, errorText, properties);
    }

    private async Task PersistAsync(
        string screen,
        string action,
        string level,
        string? errorText,
        Dictionary<string, string>? properties)
    {
        try
        {
            var companyId = _state.CurrentEmployee?.CompanyId ?? _state.CurrentCompany?.Id;
            var employeeId = _state.CurrentEmployee?.Id;
            var authUserId = _supabase.Auth.CurrentSession?.User?.Id;
            var meta = properties is { Count: > 0 }
                ? properties.ToDictionary(kv => kv.Key, kv => (object)kv.Value)
                : null;
            var appVersion = AppInfo.Current.VersionString;

            if (string.IsNullOrEmpty(authUserId) && companyId.HasValue && employeeId.HasValue)
            {
                var args = new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_screen"] = screen,
                    ["p_action"] = action,
                    ["p_level"] = level,
                    ["p_error_text"] = errorText ?? null!,
                    ["p_meta"] = meta != null ? Newtonsoft.Json.JsonConvert.SerializeObject(meta) : null!,
                    ["p_app_version"] = appVersion,
                };
                var token = CodeSessionStore.GetSessionToken();
                if (string.IsNullOrWhiteSpace(token))
                    return; // No active worker session — skip telemetry RPC (non-critical).
                args["p_session_token"] = token;
                await _supabase.Rpc("employee_log_app_event", args);
                return;
            }

            if (string.IsNullOrEmpty(authUserId))
                return;

            var row = new AppEvent
            {
                CompanyId = companyId,
                AuthUserId = Guid.TryParse(authUserId, out var uid) ? uid : null,
                Screen = screen,
                Action = action,
                Level = level,
                ErrorText = errorText,
                Meta = meta,
                AppVersion = appVersion,
            };
            await _supabase.From<AppEvent>().Insert(row);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TELEMETRY] persist failed: {ex.Message}");
        }
    }

    private async Task PersistApplicationErrorAsync(string? context, Exception ex, Dictionary<string, string>? properties)
    {
        try
        {
            var companyId = _state.CurrentEmployee?.CompanyId ?? _state.CurrentCompany?.Id;
            var employeeId = _state.CurrentEmployee?.Id;
            try
            {
                var storage = _services.GetService<IStorageService>();
                if (storage != null)
                {
                    await storage.LogApplicationErrorAsync(
                        module: properties?.GetValueOrDefault("module"),
                        page: context,
                        ex: ex,
                        companyId: companyId,
                        employeeId: employeeId,
                        metadata: properties);
                }
            }
            catch { /* non-critical */ }
        }
        catch { /* non-critical */ }
    }
}
