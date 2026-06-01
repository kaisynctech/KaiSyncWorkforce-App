using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("work_teams")]
public class WorkTeam : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("description")]
    public string? Description { get; set; }

    [Column("leader_employee_id")]
    public Guid? LeaderEmployeeId { get; set; }

    [Column("member_ids")]
    public List<Guid> MemberIds { get; set; } = [];

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public int MemberCount => MemberIds.Count;
}
