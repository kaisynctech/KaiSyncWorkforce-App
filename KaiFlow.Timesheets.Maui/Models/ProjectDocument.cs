using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("project_documents")]
public class ProjectDocument : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("deal_id")]
    public Guid DealId { get; set; }

    [Column("document_name")]
    public string DocumentName { get; set; } = "";

    [Column("document_type")]
    public string DocumentType { get; set; } = "contract";

    [Column("file_url")]
    public string FileUrl { get; set; } = "";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore]
    public string TypeLabel => KaiFlow.Timesheets.Services.ProjectDocumentTypes.LabelFor(DocumentType);

    [JsonIgnore]
    public string CreatedDisplay => CreatedAt.ToLocalTime().ToString("dd MMM yyyy");
}
