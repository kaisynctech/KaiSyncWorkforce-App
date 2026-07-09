using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("contractors")]
public class Contractor : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("registration_number")]
    public string? RegistrationNumber { get; set; }

    [Column("contact_person")]
    public string? ContactPerson { get; set; }

    [Column("phone")]
    public string? Phone { get; set; }

    [Column("email")]
    public string? Email { get; set; }

    [Column("address")]
    public string? Address { get; set; }

    [Column("bank_account")]
    public string? BankAccount { get; set; }

    [Column("bank_name")]
    public string? BankName { get; set; }

    [Column("bank_branch_code")]
    public string? BankBranchCode { get; set; }

    // ── Phase 2A: expanded banking details ───────────────────────────────────
    [Column("account_holder_name")]
    public string? AccountHolderName { get; set; }

    [Column("account_type")]
    public string? AccountType { get; set; }   // cheque|savings|transmission|credit

    [Column("swift_bic")]
    public string? SwiftBic { get; set; }

    // ── Phase 2A: tax ─────────────────────────────────────────────────────────
    [Column("tax_number")]
    public string? TaxNumber { get; set; }

    // ── Phase 2A: payment control ─────────────────────────────────────────────
    [Column("payment_terms")]
    public string? PaymentTerms { get; set; }   // immediate|7_days|14_days|30_days|60_days|90_days

    [Column("preferred_payment_method")]
    public string? PreferredPaymentMethod { get; set; }  // eft|cash|cheque|card

    [Column("payment_hold")]
    public bool PaymentHold { get; set; }

    [Column("compliance_hold")]
    public bool ComplianceHold { get; set; }

    [Column("banking_verified")]
    public bool BankingVerified { get; set; }

    [Column("rating")]
    public double Rating { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("partner_kind")]
    public string PartnerKindRaw { get; set; } = PartnerKinds.Contractor;

    [Column("contractor_code")]
    public string? ContractorCode { get; set; }

    [Column("contractor_code_expires_at")]
    public DateTimeOffset? ContractorCodeExpiresAt { get; set; }

    [Column("contractor_code_rotated_at")]
    public DateTimeOffset? ContractorCodeRotatedAt { get; set; }

    // VAT & tax — columns added by 20260529200000_finance_module_foundation.sql
    [Column("is_vat_registered")]
    public bool IsVatRegistered { get; set; }

    [Column("vat_number")]
    public string? VatNumber { get; set; }

    [Column("default_vat_rate")]
    public decimal? DefaultVatRate { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    // updated_at — added by 20260604120000_contractors_add_updated_at.sql
    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    // Phase 2B.3a — compliance pack assignment (nullable FK).
    // NULL = legacy is_required-per-document scoring.
    // Non-NULL = pack-based scoring (activated Phase 2B.3c).
    [Column("compliance_pack_id")]
    public Guid? CompliancePackId { get; set; }

    // partner_profile (jsonb) intentionally not mapped: column does not exist in
    // the UUID v2 schema (20260515160036). Verified absent via REST inspection 2026-06-04.

    [JsonIgnore] public string PartnerKindLabel => PartnerKinds.LabelFor(PartnerKindRaw);
    [JsonIgnore] public string ContactDisplay =>
        string.Join(" · ", new[] { ContactPerson, Phone, Email }.Where(s => !string.IsNullOrWhiteSpace(s)));
    [JsonIgnore] public string StatusLabel => IsActive ? "Active" : "Inactive";
    [JsonIgnore] public string RatingDisplay => Rating > 0 ? $"★ {Rating:F1}" : "—";
    [JsonIgnore] public string ContractorCodeDisplay => string.IsNullOrWhiteSpace(ContractorCode) ? "—" : ContractorCode!;
    [JsonIgnore] public bool HasContractorCode => !string.IsNullOrWhiteSpace(ContractorCode);

    // Status badge colours for the contractors list
    [JsonIgnore] public string StatusBadgeBackground => IsActive ? "#14532D" : "#1E293B";
    [JsonIgnore] public string StatusBadgeTextColor  => IsActive ? "#22C55E" : "#64748B";

    // ── Phase 2A display helpers ──────────────────────────────────────────────

    [JsonIgnore] public string AccountTypeLabel => AccountType switch
    {
        "cheque"       => "Cheque",
        "savings"      => "Savings",
        "transmission" => "Transmission",
        "credit"       => "Credit",
        _              => "—"
    };

    [JsonIgnore] public string PaymentTermsLabel => PaymentTerms switch
    {
        "immediate" => "Immediate",
        "7_days"    => "7 Days",
        "14_days"   => "14 Days",
        "30_days"   => "30 Days",
        "60_days"   => "60 Days",
        "90_days"   => "90 Days",
        _           => "30 Days"
    };

    [JsonIgnore] public string PaymentMethodLabel => PreferredPaymentMethod switch
    {
        "eft"    => "EFT",
        "cash"   => "Cash",
        "cheque" => "Cheque",
        "card"   => "Card",
        _        => "EFT"
    };

    // Legacy stacked-flags helpers (retained for backwards compatibility)
    [JsonIgnore] public bool HasAnyHold => PaymentHold || ComplianceHold;
    [JsonIgnore] public string HoldBadgeText => ComplianceHold ? "Compliance Hold" : "Payment Hold";
    [JsonIgnore] public string HoldBadgeBg   => ComplianceHold ? "#7F1D1D" : "#78350F";
    [JsonIgnore] public string HoldBadgeFg   => ComplianceHold ? "#FCA5A5" : "#FCD34D";

    // ── Two-state column badges (always shown — one badge per cell, colour changes) ──

    /// <summary>Banking column: "Verified" (green) or "Pending" (grey).</summary>
    [JsonIgnore] public string BankingStatusText => BankingVerified ? "Verified" : "Pending";
    [JsonIgnore] public string BankingStatusBg   => BankingVerified ? "#14532D"  : "#1E293B";
    [JsonIgnore] public string BankingStatusFg   => BankingVerified ? "#22C55E"  : "#64748B";

    /// <summary>Payment column: "Clear" (green) or "Hold" (amber).</summary>
    [JsonIgnore] public string PaymentStatusText => PaymentHold ? "Hold"    : "Clear";
    [JsonIgnore] public string PaymentStatusBg   => PaymentHold ? "#78350F" : "#14532D";
    [JsonIgnore] public string PaymentStatusFg   => PaymentHold ? "#FCD34D" : "#22C55E";

    /// <summary>Compliance column: "Hold" (red) or "Compliant" (green).</summary>
    [JsonIgnore] public string ComplianceStatusText => ComplianceHold ? "Hold"    : "Compliant";
    [JsonIgnore] public string ComplianceStatusBg   => ComplianceHold ? "#7F1D1D" : "#14532D";
    [JsonIgnore] public string ComplianceStatusFg   => ComplianceHold ? "#FCA5A5" : "#22C55E";
}
