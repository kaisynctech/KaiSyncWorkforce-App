using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Models;

public class AppNotification
{
    [JsonProperty("id")]
    public long Id { get; set; }

    [JsonProperty("company_id")]
    public Guid? CompanyId { get; set; }

    [JsonProperty("type")]
    public string Type { get; set; } = "";

    [JsonProperty("title")]
    public string Title { get; set; } = "";

    [JsonProperty("body")]
    public string Body { get; set; } = "";

    [JsonProperty("ref_type")]
    public string? RefType { get; set; }

    [JsonProperty("ref_id")]
    public string? RefId { get; set; }

    [JsonProperty("data")]
    public Dictionary<string, object>? Data { get; set; }

    [JsonProperty("is_read")]
    public bool IsRead { get; set; }

    [JsonProperty("read_at")]
    public DateTime? ReadAt { get; set; }

    [JsonProperty("created_at")]
    public DateTime CreatedAt { get; set; }

    public string Color => Type switch
    {
        "registration_approved" => "#22C55E",
        "registration_rejected" => "#EF4444",
        "client_portal_message" => "#6C63FF",
        _ => "#3B82F6"
    };

    public string When => PortalDateHelper.FormatDateTime(CreatedAt);
}
