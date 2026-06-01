using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum ComplianceStatus { Current, DueSoon, Overdue, NotApplicable }

[Table("compliance_entries")]
public class ComplianceEntry : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("site_id")]
    public Guid? SiteId { get; set; }

    [Column("asset_id")]
    public Guid? AssetId { get; set; }

    [Column("compliance_type")]
    public string ComplianceType { get; set; } = "";

    [Column("certificate_number")]
    public string? CertificateNumber { get; set; }

    [Column("issued_date")]
    public DateOnly? IssuedDate { get; set; }

    [Column("expiry_date")]
    public DateOnly? ExpiryDate { get; set; }

    [Column("issued_by")]
    public string? IssuedBy { get; set; }

    [Column("document_url")]
    public string? DocumentUrl { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public ComplianceStatus Status
    {
        get
        {
            if (!ExpiryDate.HasValue) return ComplianceStatus.NotApplicable;
            var today = DateOnly.FromDateTime(DateTime.Today);
            if (ExpiryDate.Value < today) return ComplianceStatus.Overdue;
            if (ExpiryDate.Value <= today.AddDays(30)) return ComplianceStatus.DueSoon;
            return ComplianceStatus.Current;
        }
    }
}
