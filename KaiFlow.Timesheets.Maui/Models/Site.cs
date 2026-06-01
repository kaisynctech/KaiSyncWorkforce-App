using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("sites")]
public class Site : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("client_id")]
    public Guid? ClientId { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("address")]
    public string? Address { get; set; }

    [Column("latitude")]
    public double? Latitude { get; set; }

    [Column("longitude")]
    public double? Longitude { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("radius_meters")]
    public double RadiusMeters { get; set; } = 200;

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public bool HasCoordinates => Latitude.HasValue && Longitude.HasValue;
}
