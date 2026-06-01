using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("job_site_visits")]
public class JobSiteVisit : BaseModel
{
    [PrimaryKey("id")]
    [JsonProperty("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    [JsonProperty("company_id")]
    public Guid CompanyId { get; set; }

    [Column("job_id")]
    [JsonProperty("job_id")]
    public Guid JobId { get; set; }

    [Column("party_type")]
    [JsonProperty("party_type")]
    public string PartyType { get; set; } = "employee";

    [Column("employee_id")]
    [JsonProperty("employee_id")]
    public Guid? EmployeeId { get; set; }

    [Column("contractor_id")]
    [JsonProperty("contractor_id")]
    public Guid? ContractorId { get; set; }

    [Column("sign_in_at")]
    [JsonProperty("sign_in_at")]
    public DateTime SignInAt { get; set; }

    [Column("sign_out_at")]
    [JsonProperty("sign_out_at")]
    public DateTime? SignOutAt { get; set; }

    [Column("sign_in_latitude")]
    public double? SignInLatitude { get; set; }

    [Column("sign_in_longitude")]
    public double? SignInLongitude { get; set; }

    [Column("sign_in_address")]
    public string? SignInAddress { get; set; }

    [Column("sign_out_latitude")]
    public double? SignOutLatitude { get; set; }

    [Column("sign_out_longitude")]
    public double? SignOutLongitude { get; set; }

    [Column("sign_out_address")]
    public string? SignOutAddress { get; set; }

    [Column("reported_by_name")]
    [JsonProperty("reported_by_name")]
    public string? ReportedByName { get; set; }

    [Column("notes")]
    [JsonProperty("notes")]
    public string? Notes { get; set; }

    [Column("created_at")]
    [JsonProperty("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public bool IsOpen => !SignOutAt.HasValue;
    [JsonIgnore] public bool IsEmployee => PartyType == "employee";
    [JsonIgnore] public bool IsContractor => PartyType == "contractor";

    public string? EmployeeName { get; set; }
    public string? ContractorName { get; set; }

    [JsonIgnore] public string PartyDisplay =>
        IsEmployee ? (EmployeeName ?? "Employee") : (ContractorName ?? "Contractor");

    [JsonIgnore] public string ReporterDisplay =>
        string.IsNullOrWhiteSpace(ReportedByName) ? PartyDisplay : ReportedByName!;
}
