using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("employee_shift_templates")]
public class EmployeeShiftTemplate : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    [JsonProperty("company_id")]
    public Guid CompanyId { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    // Supabase returns time columns as "HH:mm:ss" strings — stored raw, exposed as TimeOnly
    [Column("start_time")]
    [JsonProperty("start_time")]
    public string StartTimeRaw { get; set; } = "08:00:00";

    [Column("end_time")]
    [JsonProperty("end_time")]
    public string EndTimeRaw { get; set; } = "17:00:00";

    // Total break minutes — kept in sync with the Breaks list on save
    [Column("break_minutes")]
    [JsonProperty("break_minutes")]
    public int BreakMinutes { get; set; }

    // Individual break slots (stored as JSONB)
    [Column("breaks")]
    public List<BreakSlot> Breaks { get; set; } = [];

    [Column("created_at")]
    [JsonProperty("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("is_default")]
    [JsonProperty("is_default")]
    public bool IsDefault { get; set; }

    [JsonIgnore]
    public TimeOnly StartTime
    {
        get => TimeOnly.TryParse(StartTimeRaw, out var t) ? t : new TimeOnly(8, 0);
        set => StartTimeRaw = value.ToString("HH:mm:ss");
    }

    [JsonIgnore]
    public TimeOnly EndTime
    {
        get => TimeOnly.TryParse(EndTimeRaw, out var t) ? t : new TimeOnly(17, 0);
        set => EndTimeRaw = value.ToString("HH:mm:ss");
    }

    [JsonIgnore]
    public int TotalBreakMinutes => Breaks.Count > 0
        ? Breaks.Sum(b => b.Minutes)
        : BreakMinutes;

    [JsonIgnore]
    public double PaidHours
    {
        get
        {
            var span = EndTime > StartTime
                ? EndTime - StartTime
                : (TimeSpan.FromHours(24) - StartTime.ToTimeSpan()) + EndTime.ToTimeSpan();
            return Math.Max(0, span.TotalHours - TotalBreakMinutes / 60.0);
        }
    }

    [JsonIgnore]
    public string Summary
    {
        get
        {
            var breakSummary = Breaks.Count > 0
                ? string.Join(" + ", Breaks.Select(b => $"{b.Label} {b.Minutes}m"))
                : $"{BreakMinutes} min break";
            var defaultTag = IsDefault ? "  ·  default" : "";
            return $"{StartTime:hh\\:mm tt} – {EndTime:hh\\:mm tt}  ·  {breakSummary}  ·  {PaidHours:F1}h paid{defaultTag}";
        }
    }
}
