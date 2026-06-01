using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("contractor_member_links")]
public class ContractorMemberLink : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("contractor_id")]
    public Guid ContractorId { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("role")]
    public string? Role { get; set; }

    [Column("is_primary")]
    public bool IsPrimary { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}
