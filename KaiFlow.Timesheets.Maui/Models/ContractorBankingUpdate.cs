using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// A pending banking update submitted by a contractor via the portal.
/// Maps to public.contractor_banking_updates.
///
/// HR reads this directly via PostgREST (authenticated JWT).
/// The portal reads a masked version via contractor_portal_get_pending_banking RPC.
///
/// Approval (Phase 2C.4) will copy approved fields to contractors table
/// and reset banking_verified = false for HR re-verification.
/// Phase 2C.3.
/// </summary>
[Table("contractor_banking_updates")]
public class ContractorBankingUpdate : BaseModel
{
    [PrimaryKey("id")]               public Guid     Id                { get; set; }
    [Column("contractor_id")]        public Guid     ContractorId      { get; set; }
    [Column("company_id")]           public Guid     CompanyId         { get; set; }

    [Column("account_holder_name")]  public string?  AccountHolderName { get; set; }
    [Column("bank_name")]            public string?  BankName          { get; set; }
    [Column("bank_account")]         public string?  BankAccount       { get; set; }
    [Column("bank_branch_code")]     public string?  BankBranchCode    { get; set; }
    [Column("account_type")]         public string?  AccountType       { get; set; }
    [Column("swift_bic")]            public string?  SwiftBic          { get; set; }

    [Column("status")]               public string   Status            { get; set; } = "pending";
    [Column("submitted_at")]         public DateTime SubmittedAt       { get; set; }
    [Column("reviewed_at")]          public DateTime? ReviewedAt       { get; set; }
    [Column("reviewed_by")]          public Guid?    ReviewedBy        { get; set; }
    [Column("rejection_reason")]     public string?  RejectionReason   { get; set; }
    [Column("created_at")]           public DateTime CreatedAt         { get; set; }

    // ── Display helpers ───────────────────────────────────────────────────────

    [JsonIgnore] public string StatusLabel => Status switch
    {
        "approved" => "Approved",
        "rejected" => "Rejected",
        _          => "Pending HR Review"
    };

    [JsonIgnore] public string StatusBadgeBg => Status switch
    {
        "approved" => "#14532D",
        "rejected" => "#7F1D1D",
        _          => "#292012"
    };

    [JsonIgnore] public string StatusBadgeFg => Status switch
    {
        "approved" => "#22C55E",
        "rejected" => "#FCA5A5",
        _          => "#FCD34D"
    };

    [JsonIgnore] public string SubmittedAtDisplay =>
        SubmittedAt.ToLocalTime().ToString("dd MMM yyyy · HH:mm");

    [JsonIgnore] public string ReviewedAtDisplay =>
        ReviewedAt.HasValue
        ? ReviewedAt.Value.ToLocalTime().ToString("dd MMM yyyy · HH:mm")
        : "";

    /// <summary>Last 4 digits of the submitted account number for HR display.</summary>
    [JsonIgnore] public string MaskedAccount =>
        string.IsNullOrWhiteSpace(BankAccount) ? "—"
        : new string('•', Math.Max(0, BankAccount.Length - 4))
          + BankAccount[^Math.Min(4, BankAccount.Length)..];

    [JsonIgnore] public string AccountTypeLabel => AccountType switch
    {
        "cheque"       => "Cheque",
        "savings"      => "Savings",
        "transmission" => "Transmission",
        "credit"       => "Credit",
        _              => AccountType ?? "—"
    };

    /// <summary>True when this is the most recent pending update (used by HR Payments tab).</summary>
    [JsonIgnore] public bool IsPending => Status == "pending";
}
