using KaiFlow.Timesheets.Services;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("job_documents")]
public class JobDocument : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("document_name")]
    public string DocumentName { get; set; } = "";

    [Column("document_type")]
    public string DocumentType { get; set; } = "other";

    [Column("file_url")]
    public string FileUrl { get; set; } = "";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public string TypeLabel => ProjectDocumentTypes.LabelFor(DocumentType);
    [JsonIgnore] public string CreatedDisplay => CreatedAt.ToLocalTime().ToString("dd MMM yyyy");
}
