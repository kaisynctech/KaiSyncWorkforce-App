namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Current banking status returned by contractor_portal_get_banking RPC.
/// Account number is always MASKED — full number is never returned to the portal.
/// Read-only for the contractor; HR-owned fields displayed for information only.
/// Phase 2C.3.
/// </summary>
public sealed class ContractorBankingStatus
{
    // ── Current banking (from contractors table, account masked) ──────────────
    public string? AccountHolderName { get; set; }
    public string? BankName          { get; set; }
    public string? MaskedAccount     { get; set; }   // e.g. "••••••5678" or null
    public string? BankBranchCode    { get; set; }
    public string? AccountType       { get; set; }
    public string? SwiftBic          { get; set; }
    public bool    HasBankingDetails  { get; set; }

    // ── HR-owned flags (read-only display) ────────────────────────────────────
    public bool    BankingVerified        { get; set; }
    public bool    PaymentHold            { get; set; }
    public bool    ComplianceHold         { get; set; }
    public string? PaymentTerms           { get; set; }
    public string? PreferredPaymentMethod { get; set; }

    // ── Display helpers ───────────────────────────────────────────────────────

    public string MaskedAccountDisplay =>
        string.IsNullOrWhiteSpace(MaskedAccount) ? "No account on file" : MaskedAccount;

    public string AccountTypeLabel => AccountType switch
    {
        "cheque"       => "Cheque",
        "savings"      => "Savings",
        "transmission" => "Transmission",
        "credit"       => "Credit",
        _              => AccountType ?? "—"
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
}
