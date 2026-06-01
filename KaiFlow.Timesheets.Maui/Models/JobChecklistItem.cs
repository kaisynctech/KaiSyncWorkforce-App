using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("job_checklist_items")]
public class JobChecklistItem : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("description")]
    public string Description { get; set; } = "";

    [Column("is_checked")]
    public bool IsChecked { get; set; }

    [Column("sort_order")]
    public int SortOrder { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }
}
