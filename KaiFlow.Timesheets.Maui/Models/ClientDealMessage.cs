using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("client_deal_messages")]
public class ClientDealMessage : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("deal_id")]
    public Guid DealId { get; set; }

    [Column("author")]
    public string Author { get; set; } = "client";

    [Column("body")]
    public string Body { get; set; } = "";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public bool IsFromClient => Author == "client";
    [JsonIgnore] public bool IsFromHr => Author == "hr";
    [JsonIgnore] public string AuthorLabel => IsFromClient ? "You" : "Your contractor";

    public static ClientDealMessage FromAppMessage(AppMessage m) => new()
    {
        Id = m.Id,
        CompanyId = m.CompanyId,
        DealId = Guid.Empty,
        Author = m.IsFromClient ? "client" : "hr",
        Body = m.Body,
        CreatedAt = m.CreatedAt
    };
    [JsonIgnore] public string CreatedDisplay => PortalDateHelper.FormatDateTime(CreatedAt);
    [JsonIgnore] public string TimeDisplay => PortalDateHelper.FormatTime(CreatedAt);
}
