using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("message_threads")]
public class MessageThread : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("subject")]
    public string? Subject { get; set; }

    [Column("participant_ids")]
    public List<Guid> ParticipantIds { get; set; } = [];

    [Column("last_message_at")]
    public DateTime? LastMessageAt { get; set; }

    [Column("last_message_preview")]
    public string? LastMessagePreview { get; set; }

    [Column("is_archived")]
    public bool IsArchived { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("type_raw")]
    public string TypeRaw { get; set; } = "direct";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore]
    public bool IsCompanyFeed => TypeRaw == "company_feed";

    /// <summary>Friendly title for UI (client name / job title); <see cref="Subject"/> stays as DB key.</summary>
    [JsonIgnore] public string DisplaySubject { get; set; } = "";

    [JsonIgnore] public string ListTitle =>
        !string.IsNullOrWhiteSpace(DisplaySubject) ? DisplaySubject
        : !string.IsNullOrWhiteSpace(Subject) ? Subject!
        : "Conversation";

    [JsonIgnore] public string LastMessageAtDisplay => PortalDateHelper.FormatShortDate(LastMessageAt);
}
