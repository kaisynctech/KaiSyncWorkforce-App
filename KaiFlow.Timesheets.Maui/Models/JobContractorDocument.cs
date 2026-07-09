using KaiFlow.Timesheets.Services;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Phase D — document tied to a specific contractor's assignment on a job.
/// Stored in public.job_contractor_documents.
/// </summary>
[Table("job_contractor_documents")]
public class JobContractorDocument : BaseModel
{
    [PrimaryKey("id")]             public Guid    Id               { get; set; }
    [Column("company_id")]         public Guid    CompanyId        { get; set; }
    [Column("job_id")]             public Guid    JobId            { get; set; }
    [Column("contractor_id")]      public Guid    ContractorId     { get; set; }
    [Column("job_contractor_id")]  public Guid    JobContractorId  { get; set; }
    [Column("document_type")]      public string  DocumentType     { get; set; } = "other";
    [Column("document_name")]      public string  DocumentName     { get; set; } = "";
    [Column("file_url")]           public string  FileUrl          { get; set; } = "";
    [Column("storage_path")]       public string? StoragePath      { get; set; }
    [Column("notes")]              public string? Notes            { get; set; }
    [Column("created_by")]         public Guid?   CreatedBy        { get; set; }
    [Column("created_at")]         public DateTime CreatedAt       { get; set; }
    [Column("updated_at")]         public DateTime UpdatedAt       { get; set; }

    [JsonIgnore] public string TypeLabel      => JobContractorDocumentTypes.LabelFor(DocumentType);
    [JsonIgnore] public string TypeIcon       => JobContractorDocumentTypes.IconFor(DocumentType);
    [JsonIgnore] public string CreatedDisplay => CreatedAt.ToLocalTime().ToString("dd MMM yyyy");
}
