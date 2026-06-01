using Microsoft.Extensions.DependencyInjection;

namespace KaiFlow.Timesheets.Services;

/// <summary>Safe Shell navigation — normalizes ShellContent to /// routes and catches failures.</summary>
public static class ShellNavigation
{
    public static Task GoBackOrDashboardAsync()
    {
        if (Shell.Current?.Navigation?.NavigationStack is { Count: > 1 })
            return GoToAsync("..");

        return GoToMainDashboardAsync();
    }

    public static Task GoToMainDashboardAsync()
    {
        var state = Application.Current?.Handler?.MauiContext?.Services.GetService<TimesheetStateService>();
        if (state?.CurrentEmployee?.UsesCompanyDashboard == true)
            return GoToAsync(AppRoutes.HrDashboard);
        return GoToAsync(AppRoutes.EmployeeDashboard);
    }

    public static Task GoToAsync(string route)
        => GoToInner(AppRoutes.Normalize(route));

    public static Task GoToAsync(string route, IReadOnlyDictionary<string, object>? parameters)
    {
        if (parameters is not { Count: > 0 })
            return GoToAsync(route);

        var queryParts = new List<string>();
        foreach (var kv in parameters)
        {
            if (TryFormatQueryValue(kv.Value, out var encoded))
                queryParts.Add($"{Uri.EscapeDataString(kv.Key)}={encoded}");
            else
            {
                NavigationParameterBag.Set(parameters);
                return GoToInner(AppRoutes.Normalize(route));
            }
        }

        var sep = route.Contains('?') ? "&" : "?";
        return GoToInner(AppRoutes.Normalize($"{route}{sep}{string.Join("&", queryParts)}"));
    }

    private static bool TryFormatQueryValue(object? value, out string encoded)
    {
        encoded = "";
        if (value == null) return false;
        switch (value)
        {
            case string s:
                encoded = Uri.EscapeDataString(s);
                return true;
            case Guid g:
                encoded = g.ToString();
                return true;
            case bool b:
                encoded = b ? "true" : "false";
                return true;
            case int or long or double or decimal or float:
                encoded = Uri.EscapeDataString(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? "");
                return true;
            default:
                return false;
        }
    }

    private static async Task GoToInner(string normalized)
    {
        if (Shell.Current == null)
            return;

        await MainThread.InvokeOnMainThreadAsync(async () =>
        {
            await Task.Yield();
            try
            {
                await Shell.Current.GoToAsync(normalized);
                NavigationParameterBag.Clear();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Navigation failed: {normalized}: {ex}");
                try
                {
                    await Shell.Current.DisplayAlert(
                        "Could not open page",
                        $"{ex.Message}\n\nRoute: {normalized}",
                        "OK");
                }
                catch
                {
                    /* UI may be torn down */
                }
            }
        });
    }
}
