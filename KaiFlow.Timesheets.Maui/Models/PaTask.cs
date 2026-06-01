using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum PaTaskStatus { Todo, InProgress, Done, Snoozed, Cancelled, Open, Completed }

public enum PaTaskPriority { Low, Medium, High, Urgent }

[Table("pa_tasks")]
public class PaTask : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("title")]
    public string Title { get; set; } = "";

    [Column("description")]
    public string? Description { get; set; }

    [Column("status")]
    public string StatusRaw { get; set; } = "todo";

    [Column("priority")]
    public string PriorityRaw { get; set; } = "medium";

    [Column("site_id")]
    public Guid? SiteId { get; set; }

    [Column("unit_id")]
    public Guid? UnitId { get; set; }

    [Column("assigned_employee_id")]
    public Guid? AssignedEmployeeId { get; set; }

    [Column("owner_employee_id")]
    public Guid? OwnerEmployeeId { get; set; }

    [Column("owner_hr_user_id")]
    public Guid? OwnerHrUserId { get; set; }

    [Column("template_id")]
    public Guid? TemplateId { get; set; }

    [Column("due_date")]
    public DateOnly? DueDate { get; set; }

    [Column("due_at")]
    public DateTime? DueAt { get; set; }

    [Column("remind_at")]
    public DateTime? RemindAt { get; set; }

    [Column("snoozed_until")]
    public DateTime? SnoozedUntil { get; set; }

    [Column("linked_type")]
    public string LinkedTypeRaw { get; set; } = "none";

    [Column("linked_id")]
    public string? LinkedId { get; set; }

    [Column("linked_label")]
    public string? LinkedLabel { get; set; }

    [Column("recurrence_pattern")]
    public string RecurrencePattern { get; set; } = "none";

    [Column("source_type")]
    public string? SourceType { get; set; }

    [Column("source_id")]
    public string? SourceId { get; set; }

    [Column("meeting_with")]
    public string? MeetingWith { get; set; }

    [Column("meeting_at")]
    public DateTime? MeetingAt { get; set; }

    [Column("meeting_minutes")]
    public string? MeetingMinutes { get; set; }

    [Column("meeting_follow_up")]
    public string? MeetingFollowUp { get; set; }

    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    [Column("photo_urls")]
    public List<string> PhotoUrls { get; set; } = [];

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("delegated_by_employee_id")]
    public Guid? DelegatedByEmployeeId { get; set; }

    [Column("quick_capture")]
    public string? QuickCapture { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore]
    public DateTime? EffectiveDue
    {
        get
        {
            if (DueAt.HasValue) return DueAt;
            if (DueDate.HasValue) return DueDate.Value.ToDateTime(TimeOnly.MinValue).AddHours(9);
            if (MeetingAt.HasValue) return MeetingAt;
            return null;
        }
    }

    [JsonIgnore]
    public bool IsDone => StatusRaw is "done" or "completed";

    [JsonIgnore]
    public bool IsOpen => !IsDone && StatusRaw != "cancelled";

    [JsonIgnore]
    public bool IsOverdue =>
        EffectiveDue.HasValue && EffectiveDue.Value < DateTime.Now && IsOpen;

    [JsonIgnore]
    public bool IsDueToday
    {
        get
        {
            if (!EffectiveDue.HasValue || IsDone) return false;
            var d = EffectiveDue.Value.Date;
            return d == DateTime.Today;
        }
    }

    [JsonIgnore]
    public string SourceBadge => SourceType switch
    {
        "job_assignment" => "Job assigned",
        "project_assignment" => "Project due",
        "deal_followup" => "Project follow-up",
        "job_sla_risk" => "Job SLA",
        "job_followup" => "Job follow-up",
        _ => string.IsNullOrEmpty(SourceType) ? "Task" : SourceType.Replace('_', ' ')
    };

    [JsonIgnore]
    public string LinkedTypeDisplay => LinkedTypeRaw switch
    {
        "deal" => "Project",
        "job" => "Job",
        "client" => "Client",
        "payment" => "Payment",
        "meeting" => "Meeting",
        _ => ""
    };

    [JsonIgnore]
    public bool HasLinkedRecord =>
        LinkedTypeRaw is "job" or "deal" && Guid.TryParse(LinkedId, out _);

    [JsonIgnore]
    public bool IsSystemGenerated =>
        !string.IsNullOrEmpty(SourceType)
        && SourceType is not "manual";

    // ── Presentation helpers (consumed by the My PA UI) ──────────────

    [JsonIgnore]
    public string PriorityLabel => PriorityRaw?.ToLowerInvariant() switch
    {
        "urgent" => "Urgent",
        "high" => "High",
        "low" => "Low",
        _ => "Medium"
    };

    /// <summary>Hex colour for the left priority strip / dot on a task card.</summary>
    [JsonIgnore]
    public string PriorityColor => PriorityRaw?.ToLowerInvariant() switch
    {
        "urgent" => "#EF4444",
        "high" => "#F59E0B",
        "low" => "#9CA3AF",
        _ => "#3B82F6"
    };

    [JsonIgnore]
    public bool IsInProgress => StatusRaw is "in_progress" or "inProgress";

    [JsonIgnore]
    public bool IsSnoozed => StatusRaw == "snoozed";

    /// <summary>Short uppercase status pill text (empty when no badge is warranted).</summary>
    [JsonIgnore]
    public string StatusBadgeText
    {
        get
        {
            if (IsDone) return "DONE";
            if (IsOverdue) return "OVERDUE";
            if (IsDueToday) return "DUE TODAY";
            if (IsSnoozed) return "SNOOZED";
            if (IsInProgress) return "IN PROGRESS";
            return "";
        }
    }

    [JsonIgnore]
    public string StatusBadgeColor
    {
        get
        {
            if (IsDone) return "#22C55E";
            if (IsOverdue) return "#EF4444";
            if (IsDueToday) return "#3B82F6";
            if (IsSnoozed) return "#F59E0B";
            if (IsInProgress) return "#8B5CF6";
            return "#6B7280";
        }
    }

    [JsonIgnore]
    public bool HasStatusBadge => StatusBadgeText.Length > 0;

    [JsonIgnore]
    public bool HasNotes => !string.IsNullOrWhiteSpace(Notes);
}
