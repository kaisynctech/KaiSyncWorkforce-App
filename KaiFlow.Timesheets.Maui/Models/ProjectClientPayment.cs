using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("project_client_payments")]
public class ProjectClientPayment : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("deal_id")]
    public Guid DealId { get; set; }

    [Column("amount")]
    public double Amount { get; set; }

    [Column("paid_at")]
    public DateTime PaidAt { get; set; }

    [Column("payment_method")]
    public string? PaymentMethod { get; set; }

    [Column("reference")]
    public string? Reference { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("receipt_url")]
    public string? ReceiptUrl { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public string AmountDisplay => $"R{Amount:N2}";
    [JsonIgnore] public string PaidAtDisplay =>
        PortalDateHelper.IsSet(PaidAt)
            ? PortalDateHelper.FormatDateTime(PaidAt)
            : "—";
    [JsonIgnore] public string MethodDisplay => string.IsNullOrWhiteSpace(PaymentMethod) ? "—" : PaymentMethod!;
    [JsonIgnore] public string ReferenceDisplay => string.IsNullOrWhiteSpace(Reference) ? "—" : Reference!;
    [JsonIgnore] public bool HasReceipt => !string.IsNullOrWhiteSpace(ReceiptUrl);
}
