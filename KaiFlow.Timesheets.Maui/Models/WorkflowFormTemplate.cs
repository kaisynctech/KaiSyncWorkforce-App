using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("workflow_form_templates")]
public class WorkflowFormTemplate : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("description")]
    public string? Description { get; set; }

    [Column("fields")]
    public List<FormField> Fields { get; set; } = [];

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}

public class FormField
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string FieldType { get; set; } = "text"; // text, number, date, select, checkbox, signature, photo
    public bool IsRequired { get; set; }
    public List<string> Options { get; set; } = [];
}
