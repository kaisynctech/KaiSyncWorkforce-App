using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("units")]
public class Unit : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("site_id")]
    public Guid SiteId { get; set; }

    [Column("unit_number")]
    public string UnitNumber { get; set; } = "";

    [Column("address")]
    public string? Address { get; set; }

    [Column("floor")]
    public string? Floor { get; set; }

    [Column("unit_type")]
    public string? UnitType { get; set; }

    [Column("is_occupied")]
    public bool IsOccupied { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public string DisplayName => string.IsNullOrEmpty(Address)
        ? $"Unit {UnitNumber}"
        : $"Unit {UnitNumber} â€“ {Address}";
}
