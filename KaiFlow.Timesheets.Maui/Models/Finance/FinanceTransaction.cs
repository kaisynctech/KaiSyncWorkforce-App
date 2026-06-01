using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>Universal money-in / money-out ledger entry. Maps to public.finance_transactions.</summary>
[Table("finance_transactions")]
public class FinanceTransaction : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("transaction_type")] public string TransactionTypeRaw { get; set; } = "adjustment";
    [Column("direction")] public string DirectionRaw { get; set; } = "incoming";
    [Column("source_table")] public string? SourceTable { get; set; }
    [Column("source_id")] public Guid? SourceId { get; set; }
    [Column("reference_number")] public string? ReferenceNumber { get; set; }
    [Column("amount")] public decimal Amount { get; set; }
    [Column("vat_amount")] public decimal VatAmount { get; set; }
    [Column("total_amount")] public decimal TotalAmount { get; set; }
    [Column("transaction_date")] public DateOnly TransactionDate { get; set; }
    [Column("payment_method")] public string? PaymentMethod { get; set; }
    [Column("notes")] public string? Notes { get; set; }
    [Column("created_by")] public Guid? CreatedBy { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [JsonIgnore] public bool IsIncoming => DirectionRaw == "incoming";
    [JsonIgnore] public decimal SignedTotal => IsIncoming ? TotalAmount : -TotalAmount;

    [JsonIgnore] public string TypeLabel => TransactionTypeRaw switch
    {
        "invoice" => "Invoice",
        "supplier_payment" => "Supplier Payment",
        "contractor_payment" => "Contractor Payment",
        "payroll" => "Payroll",
        "expense" => "Expense",
        "refund" => "Refund",
        _ => "Adjustment"
    };

    [JsonIgnore] public string DirectionColor => IsIncoming ? "#16A34A" : "#DC2626";
    [JsonIgnore] public string AmountDisplay => $"{(IsIncoming ? "+" : "-")}R{TotalAmount:N2}";
    [JsonIgnore] public string TransactionDateDisplay => TransactionDate.ToString("dd MMM yyyy");
}
