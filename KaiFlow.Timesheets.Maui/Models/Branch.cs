using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("branches")]
public class Branch : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("address")]
    public string? Address { get; set; }

    [Column("latitude")]
    public double? Latitude { get; set; }

    [Column("longitude")]
    public double? Longitude { get; set; }

    [Column("radius_meters")]
    public double RadiusMeters { get; set; } = 200;

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Newtonsoft.Json.JsonIgnore]
    public bool HasGeofenceLocation => Latitude.HasValue && Longitude.HasValue;

    [Newtonsoft.Json.JsonIgnore]
    public string LocationStatusDisplay => HasGeofenceLocation
        ? (Address ?? "Location set")
        : "No location — sign-in anywhere";
}
