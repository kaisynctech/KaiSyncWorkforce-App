using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("residents")]
public class Resident : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("site_id")]
    public Guid SiteId { get; set; }

    [Column("unit_id")]
    public Guid? UnitId { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("surname")]
    public string Surname { get; set; } = "";

    [Column("phone")]
    public string? Phone { get; set; }

    [Column("email")]
    public string? Email { get; set; }

    [Column("move_in_date")]
    public DateOnly? MoveInDate { get; set; }

    [Column("move_out_date")]
    public DateOnly? MoveOutDate { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public string FullName => $"{Name} {Surname}".Trim();
    public bool IsCurrentResident => !MoveOutDate.HasValue || MoveOutDate.Value >= DateOnly.FromDateTime(DateTime.Today);
}
