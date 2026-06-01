using System.Text.Json;

namespace KaiFlow.Timesheets.Helpers;

/// <summary>Parses job photo URL arrays from Supabase RPC/JSON responses.</summary>
public static class JobPhotoUrlParser
{
    public static (List<string> Before, List<string> After) Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return ([], []);

        try
        {
            using var doc = JsonDocument.Parse(json);
            return (ParseArray(doc.RootElement, "photo_urls_before"),
                ParseArray(doc.RootElement, "photo_urls_after"));
        }
        catch
        {
            return ([], []);
        }
    }

    public static List<string> ParseArray(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var arr))
            return [];

        if (arr.ValueKind == JsonValueKind.String)
        {
            var s = arr.GetString();
            return string.IsNullOrWhiteSpace(s) ? [] : [s];
        }

        if (arr.ValueKind != JsonValueKind.Array)
            return [];

        var list = new List<string>();
        foreach (var el in arr.EnumerateArray())
        {
            if (el.ValueKind == JsonValueKind.String)
            {
                var url = el.GetString();
                if (!string.IsNullOrWhiteSpace(url))
                    list.Add(url);
            }
        }

        return list;
    }
}
