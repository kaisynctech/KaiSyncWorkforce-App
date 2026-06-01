using System.Text.Json;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

public static class NotificationDisplay
{
    public static string? GetDataString(Dictionary<string, object>? data, string key)
    {
        if (data == null || !data.TryGetValue(key, out var val))
            return null;
        return val switch
        {
            string s => s,
            JsonElement el when el.ValueKind == JsonValueKind.String => el.GetString(),
            _ => val?.ToString()
        };
    }

    public static string ClientPortalThreadTitle(AppNotification n)
    {
        var client = GetDataString(n.Data, "client_name") ?? "Client";
        var project = n.Title.StartsWith("Client message: ", StringComparison.OrdinalIgnoreCase)
            ? n.Title["Client message: ".Length..].Trim()
            : (GetDataString(n.Data, "deal_title") ?? "Project");
        return MessageThreadDisplay.DealThreadTitle(client, project);
    }
}
