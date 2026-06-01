using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("pa_task_templates")]
public class PaTaskTemplate : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("title")]
    public string Title { get; set; } = "";

    [Column("description")]
    public string? Description { get; set; }

    [Column("default_priority")]
    public string DefaultPriority { get; set; } = "medium";

    [Column("recurrence_rule")]
    public string? RecurrenceRule { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}
