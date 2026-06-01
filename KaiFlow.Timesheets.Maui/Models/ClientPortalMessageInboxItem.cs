using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Models;

public class ClientPortalMessageInboxItem
{
    public Guid DealId { get; set; }
    public string ProjectTitle { get; set; } = "";
    public string? ProjectCode { get; set; }
    public DateTime? LastMessageAt { get; set; }
    public string? LastMessagePreview { get; set; }
    public bool LastFromHr { get; set; }

    [JsonIgnore] public bool HasUnread { get; set; }

    [JsonIgnore] public string ProjectLabel =>
        string.IsNullOrWhiteSpace(ProjectCode) ? ProjectTitle : $"{ProjectCode} — {ProjectTitle}";

    [JsonIgnore] public string LastMessageAtDisplay => PortalDateHelper.FormatDateTime(LastMessageAt);

    [JsonIgnore] public string PreviewDisplay =>
        string.IsNullOrWhiteSpace(LastMessagePreview) ? "No messages yet" : LastMessagePreview!;
}
