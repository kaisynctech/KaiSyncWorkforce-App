using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("employee_documents")]
public class EmployeeDocument : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("document_type")]
    [JsonProperty("document_type")]
    public string DocumentType { get; set; } = "";

    [Column("document_name")]
    [JsonProperty("document_name")]
    public string DocumentName { get; set; } = "";

    [Column("file_url")]
    [JsonProperty("file_url")]
    public string FileUrl { get; set; } = "";

    [Column("uploaded_by_role")]
    [JsonProperty("uploaded_by_role")]
    public string UploadedByRole { get; set; } = "hr";

    [Column("created_at")]
    [JsonProperty("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore]
    public string UploadedByLabel => UploadedByRole == "employee" ? "Self-submitted" : "HR uploaded";

    [JsonIgnore]
    public string UploadedDateDisplay =>
        CreatedAt.Year < 2000 ? "—" : CreatedAt.ToLocalTime().ToString("dd MMM yyyy");

    [JsonIgnore]
    public string TypeLabel => DocumentType switch
    {
        "national_id"          => "National ID",
        "passport"             => "Passport",
        "contract"             => "Employment Contract",
        "tax_certificate"      => "Tax Certificate",
        "bank_details"         => "Bank Details",
        "medical_certificate"  => "Medical Certificate",
        "other"                => "Other",
        _                      => DocumentType
    };

    [JsonIgnore]
    public string TypeIcon => DocumentType switch
    {
        "national_id"          => "🪪",
        "passport"             => "🛂",
        "contract"             => "📋",
        "tax_certificate"      => "🧾",
        "bank_details"         => "🏦",
        "medical_certificate"  => "🏥",
        _                      => "📄"
    };
}
