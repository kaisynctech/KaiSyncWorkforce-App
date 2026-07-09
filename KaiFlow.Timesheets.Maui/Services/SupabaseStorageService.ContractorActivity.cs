using KaiFlow.Timesheets.Models;
using System.Text.Json;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Contractor Activity Feed — read and write support (Phase 2C).
///
/// Read:  get_contractor_activity_feed RPC → List&lt;ContractorActivityEntry&gt;
/// Write: direct app_events INSERT for HR-sourced actions (authenticated JWT).
///        Portal-sourced events are already written by the existing RPCs.
///        All writes are fire-and-forget (non-fatal if they fail).
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Read ─────────────────────────────────────────────────────────────────

    public async Task<List<ContractorActivityEntry>> GetContractorActivityFeedAsync(
        Guid companyId, Guid contractorId)
    {
        var result = await _supabase.Rpc("get_contractor_activity_feed",
            new Dictionary<string, object>
            {
                ["p_company_id"]    = companyId.ToString(),
                ["p_contractor_id"] = contractorId.ToString(),
            });

        return ParseActivityFeed(result?.Content);
    }

    // ─── Write (HR-sourced events) ────────────────────────────────────────────

    /// <summary>
    /// Records a contractor-related activity event to app_events.
    /// Used by HR actions: approve/reject document, hold changes, pack changes.
    /// Fire-and-forget internally — failure never blocks the primary operation.
    /// </summary>
    public Task RecordContractorEventAsync(
        Guid companyId,
        Guid contractorId,
        string action,
        string screen = "HrContractorDetails",
        Dictionary<string, object>? meta = null)
    {
        _ = WriteContractorEventAsync(companyId, contractorId, screen, action, meta ?? []);
        return Task.CompletedTask;
    }

    // ─── Internal write helper ────────────────────────────────────────────────

    internal async Task WriteContractorEventAsync(
        Guid companyId,
        Guid contractorId,
        string screen,
        string action,
        Dictionary<string, object> meta)
    {
        try
        {
            var fullMeta = new Dictionary<string, object>(meta)
            {
                ["contractor_id"] = contractorId.ToString()
            };

            var authUserId = _supabase.Auth.CurrentSession?.User?.Id;

            var row = new AppEvent
            {
                CompanyId  = companyId,
                AuthUserId = Guid.TryParse(authUserId, out var uid) ? uid : null,
                Screen     = screen,
                Action     = action,
                Level      = "info",
                Meta       = fullMeta,
                CreatedAt  = DateTime.UtcNow,
            };

            await _supabase.From<AppEvent>().Insert(row);
        }
        catch
        {
            // Non-fatal: activity logging must never break the primary HR action.
        }
    }

    // ─── JSON parser ──────────────────────────────────────────────────────────

    private static List<ContractorActivityEntry> ParseActivityFeed(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content is "null" or "[]")
            return [];

        var list = new List<ContractorActivityEntry>();
        try
        {
            using var doc = JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;

            foreach (var el in doc.RootElement.EnumerateArray())
            {
                var id        = el.TryGetProperty("id",         out var idEl)         && idEl.TryGetInt64(out var i64) ? i64 : 0;
                var screen    = CAStr(el, "screen")    ?? "";
                var action    = CAStr(el, "action")    ?? "";
                var createdAt = el.TryGetProperty("created_at", out var catEl)
                                && DateTime.TryParse(catEl.GetString(), out var dt) ? dt : DateTime.UtcNow;

                Dictionary<string, object>? meta = null;
                if (el.TryGetProperty("meta", out var metaEl)
                    && metaEl.ValueKind == JsonValueKind.Object)
                {
                    meta = ParseMetaObject(metaEl);
                }

                list.Add(new ContractorActivityEntry
                {
                    Id        = id,
                    CreatedAt = createdAt,
                    Action    = action,
                    Screen    = screen,
                    Meta      = meta,
                });
            }
        }
        catch { /* tolerate malformed payload */ }

        return list;
    }

    private static Dictionary<string, object> ParseMetaObject(JsonElement el)
    {
        var dict = new Dictionary<string, object>();
        foreach (var prop in el.EnumerateObject())
        {
            dict[prop.Name] = prop.Value.ValueKind switch
            {
                JsonValueKind.String  => (object)(prop.Value.GetString() ?? ""),
                JsonValueKind.Number  => prop.Value.TryGetDouble(out var d) ? d : 0.0,
                JsonValueKind.True    => true,
                JsonValueKind.False   => false,
                // Arrays may contain strings (old changes[]) or objects (new field_changes[])
                JsonValueKind.Array   => prop.Value.EnumerateArray()
                                             .Select(e => e.ValueKind switch
                                             {
                                                 JsonValueKind.String => (object)(e.GetString() ?? ""),
                                                 JsonValueKind.Object => (object)ParseMetaObject(e),
                                                 _ => (object)e.GetRawText()
                                             })
                                             .ToList(),
                JsonValueKind.Object  => (object)ParseMetaObject(prop.Value),
                _                    => prop.Value.GetRawText()
            };
        }
        return dict;
    }

    // CA = ContractorActivity helpers (avoid collision with portal helpers)
    private static string? CAStr(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
           ? v.GetString() : null;
}
