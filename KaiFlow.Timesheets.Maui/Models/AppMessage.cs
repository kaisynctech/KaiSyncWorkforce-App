using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("app_messages")]
public class AppMessage : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("thread_id")]
    public Guid ThreadId { get; set; }

    [Column("sender_id")]
    public Guid SenderId { get; set; }

    [Column("body")]
    public string Body { get; set; } = "";

    [Column("attachment_urls")]
    public List<string> AttachmentUrls { get; set; } = [];

    [Column("read_by_ids")]
    public List<Guid> ReadByIds { get; set; } = [];

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("sender_contractor_id")]
    public Guid? SenderContractorId { get; set; }

    [Column("sender_client_id")]
    public Guid? SenderClientId { get; set; }

    [Column("sender_display_name")]
    public string? SenderDisplayName { get; set; }

    [JsonIgnore] public bool IsFromClient => SenderClientId.HasValue;

    public bool IsReadBy(Guid userId) => ReadByIds.Contains(userId);

    [JsonIgnore] public string TimeDisplay => PortalDateHelper.FormatTime(CreatedAt);
    [JsonIgnore] public string CreatedAtDisplay => PortalDateHelper.FormatDateTime(CreatedAt);
}
