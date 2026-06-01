using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>Append-only finance audit trail entry. Maps to public.finance_audit_log.</summary>
[Table("finance_audit_log")]
public class FinanceAuditEntry : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("entity_type")] public string EntityType { get; set; } = "";
    [Column("entity_id")] public Guid? EntityId { get; set; }
    [Column("action")] public string Action { get; set; } = "";
    [Column("actor_id")] public Guid? ActorId { get; set; }
    [Column("actor_name")] public string? ActorName { get; set; }
    [Column("amount")] public decimal Amount { get; set; }
    [Column("note")] public string? Note { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [JsonIgnore] public string ActionLabel => Action switch
    {
        "approved" => "Approved",
        "rejected" => "Rejected",
        "paid" => "Paid",
        "refunded" => "Refund issued",
        "status_changed" => "Status changed",
        _ => Action
    };

    [JsonIgnore] public string ActionColor => Action switch
    {
        "approved" => "#16A34A",
        "rejected" => "#DC2626",
        "paid" => "#2563EB",
        "refunded" => "#8B5CF6",
        _ => "#6B7280"
    };

    [JsonIgnore] public string EntityLabel => EntityType switch
    {
        "supplier_invoice" => "Supplier invoice",
        "contractor_payout" => "Contractor payout",
        "finance_invoice" => "Client invoice",
        "refund" => "Refund",
        _ => EntityType
    };

    [JsonIgnore] public string AmountDisplay => $"R{Amount:N2}";
    [JsonIgnore] public string WhenDisplay => CreatedAt.ToLocalTime().ToString("dd MMM yyyy HH:mm");
    [JsonIgnore] public string ActorDisplay => string.IsNullOrWhiteSpace(ActorName) ? "System" : ActorName!;
    [JsonIgnore] public string Summary => $"{ActionLabel} · {EntityLabel}";
}
