using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("employee_pa_settings")]
public class EmployeePaSettings : BaseModel
{
    [PrimaryKey("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("briefing_enabled")]
    public bool BriefingEnabled { get; set; } = true;

    [Column("focus_mode_enabled")]
    public bool FocusModeEnabled { get; set; }

    [Column("manager_digest_enabled")]
    public bool ManagerDigestEnabled { get; set; } = true;

    [Column("google_sync_enabled")]
    public bool GoogleSyncEnabled { get; set; }

    [Column("outlook_sync_enabled")]
    public bool OutlookSyncEnabled { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }
}
