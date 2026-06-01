using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum PunchType { In, Out }

[Table("time_punches")]
public class TimePunch : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("type")]
    public string TypeRaw { get; set; } = "in";

    [Column("date_time")]
    public DateTime DateTime { get; set; }

    [Column("latitude")]
    public double? Latitude { get; set; }

    [Column("longitude")]
    public double? Longitude { get; set; }

    [Column("address")]
    public string? Address { get; set; }

    [Column("job_id")]
    public Guid? JobId { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("punched_by_manager_id")]
    [JsonProperty("punched_by_manager_id")]
    public Guid? PunchedByManagerId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Client-generated idempotency key. Set once when a punch is first attempted and
    /// preserved through the offline queue so that a replay of a punch that actually
    /// committed server-side is de-duplicated rather than inserted twice.
    /// </summary>
    [Column("idempotency_key")]
    public Guid? IdempotencyKey { get; set; }

    [JsonIgnore] public PunchType PunchType  => TypeRaw == "out" ? PunchType.Out : PunchType.In;
    [JsonIgnore] public bool IsClockIn       => PunchType == PunchType.In;
    [JsonIgnore] public bool HasLocation     => Latitude.HasValue && Longitude.HasValue;
    [JsonIgnore] public bool HasAddress      => !string.IsNullOrEmpty(Address);
    [JsonIgnore] public bool HasNotes        => !string.IsNullOrEmpty(Notes);
    [JsonIgnore] public DateTime LocalDateTime => DateTime.ToLocalTime();
}
