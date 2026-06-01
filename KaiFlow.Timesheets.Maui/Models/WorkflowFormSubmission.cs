using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("workflow_form_submissions")]
public class WorkflowFormSubmission : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("template_id")]
    public Guid TemplateId { get; set; }

    [Column("submitted_by")]
    public Guid SubmittedBy { get; set; }

    [Column("job_id")]
    public Guid? JobId { get; set; }

    [Column("site_id")]
    public Guid? SiteId { get; set; }

    [Column("data")]
    public Dictionary<string, object> Data { get; set; } = [];

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("submitted_at")]
    public DateTime SubmittedAt { get; set; }
}
