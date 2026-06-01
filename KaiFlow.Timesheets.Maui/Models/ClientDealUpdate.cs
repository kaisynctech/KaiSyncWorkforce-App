using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("client_deal_updates")]
public class ClientDealUpdate : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("deal_id")]
    public Guid DealId { get; set; }

    [Column("body")]
    public string Body { get; set; } = "";

    [Column("status_from")]
    public string? StatusFrom { get; set; }

    [Column("status_to")]
    public string? StatusTo { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore]
    public string CreatedDisplay => PortalDateHelper.FormatDateTime(CreatedAt);

    [JsonIgnore]
    public string StatusChangeDisplay
    {
        get
        {
            if (string.IsNullOrEmpty(StatusFrom) && string.IsNullOrEmpty(StatusTo)) return "";
            if (StatusFrom == StatusTo) return "";
            return $"{Helpers.ProjectPipeline.LabelFor(StatusFrom)} → {Helpers.ProjectPipeline.LabelFor(StatusTo)}";
        }
    }
}
