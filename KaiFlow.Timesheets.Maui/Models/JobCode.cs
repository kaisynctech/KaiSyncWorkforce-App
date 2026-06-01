using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("job_codes")]
public class JobCode : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("code")]
    public string Code { get; set; } = "";

    [Column("description")]
    public string? Description { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public string DisplayName => string.IsNullOrEmpty(Description)
        ? Code
        : $"{Code} â€“ {Description}";
}
