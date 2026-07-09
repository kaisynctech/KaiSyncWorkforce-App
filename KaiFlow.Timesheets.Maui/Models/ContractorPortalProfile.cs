namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Contractor profile as seen and edited through the Contractor Portal.
/// Returned by contractor_portal_get_profile RPC.
/// Passed to contractor_portal_update_profile RPC for saves.
///
/// The contractor may update editable fields freely.
/// HR-owned fields are included for display only — they are never sent
/// back to the update RPC and are never written by portal-accessible functions.
///
/// Phase 2C.2.
/// </summary>
public sealed class ContractorPortalProfile
{
    // ── Contractor-editable ───────────────────────────────────────────────────

    public string  Name               { get; set; } = "";
    public string? RegistrationNumber { get; set; }
    public string? TaxNumber          { get; set; }
    public bool    IsVatRegistered    { get; set; }
    public string? VatNumber          { get; set; }
    public string? ContactPerson      { get; set; }
    public string? Phone              { get; set; }
    public string? Email              { get; set; }
    public string? Address            { get; set; }

    // ── Read-only: identity (set at contractor creation, HR-managed) ──────────

    public string CompanyName     { get; set; } = "";
    public string CompanyCode     { get; set; } = "";
    public string ContractorCode  { get; set; } = "";
    public string PartnerKind     { get; set; } = "";

    // ── Read-only: HR-owned operational state ─────────────────────────────────

    public bool    BankingVerified        { get; set; }
    public bool    PaymentHold            { get; set; }
    public bool    ComplianceHold         { get; set; }
    // Rating is intentionally absent — internal HR information, never returned to contractor.
    public bool    IsActive               { get; set; }
    public string? PaymentTerms           { get; set; }
    public string? PreferredPaymentMethod { get; set; }
    public string? CompliancePackName     { get; set; }

    // ── Display helpers ───────────────────────────────────────────────────────

    public string PartnerKindLabel => PartnerKind switch
    {
        "contractor"    => "Contractor",
        "supplier"      => "Supplier",
        "subcontractor" => "Subcontractor",
        _               => string.IsNullOrWhiteSpace(PartnerKind) ? "—" : PartnerKind
    };

    public string PaymentTermsLabel => PaymentTerms switch
    {
        "immediate" => "Immediate",
        "7_days"    => "7 Days",
        "14_days"   => "14 Days",
        "30_days"   => "30 Days",
        "60_days"   => "60 Days",
        "90_days"   => "90 Days",
        _           => PaymentTerms ?? "—"
    };

    public string PaymentMethodLabel => PreferredPaymentMethod switch
    {
        "eft"    => "EFT",
        "cash"   => "Cash",
        "cheque" => "Cheque",
        "card"   => "Card",
        _        => PreferredPaymentMethod ?? "—"
    };

    public string CompliancePackDisplay =>
        string.IsNullOrWhiteSpace(CompliancePackName) ? "No pack assigned" : CompliancePackName;

    public string TaxDisplay =>
        string.IsNullOrWhiteSpace(TaxNumber) ? "—" : TaxNumber;

    public string VatStatusDisplay => IsVatRegistered
        ? $"Registered — {(string.IsNullOrWhiteSpace(VatNumber) ? "no number on file" : VatNumber)}"
        : "Not registered";
}
