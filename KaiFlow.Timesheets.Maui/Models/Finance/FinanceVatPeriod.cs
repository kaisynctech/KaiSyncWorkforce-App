using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>A VAT reporting period roll-up. Maps to public.finance_vat_periods.</summary>
[Table("finance_vat_periods")]
public class FinanceVatPeriod : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("start_date")] public DateOnly StartDate { get; set; }
    [Column("end_date")] public DateOnly EndDate { get; set; }
    [Column("output_vat")] public decimal OutputVat { get; set; }
    [Column("input_vat")] public decimal InputVat { get; set; }
    [Column("vat_due")] public decimal VatDue { get; set; }
    [Column("submitted")] public bool Submitted { get; set; }
    [Column("submitted_at")] public DateTime? SubmittedAt { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [JsonIgnore] public bool IsRefund => VatDue < 0;
    [JsonIgnore] public string PeriodLabel => $"{StartDate:dd MMM} – {EndDate:dd MMM yyyy}";
    [JsonIgnore] public string OutputDisplay => $"R{OutputVat:N2}";
    [JsonIgnore] public string InputDisplay => $"R{InputVat:N2}";
    [JsonIgnore] public string VatDueDisplay => $"R{Math.Abs(VatDue):N2}";
    [JsonIgnore] public string VatDueLabel => IsRefund ? "VAT Refundable" : "VAT Due";
    [JsonIgnore] public string StatusLabel => Submitted ? "Submitted" : "Open";
    [JsonIgnore] public string StatusColor => Submitted ? "#16A34A" : "#F59E0B";
}
