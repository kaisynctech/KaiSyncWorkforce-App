namespace KaiFlow.Timesheets.ViewModels.Hr;

/// <summary>
/// One document-type row in the Required Documents Checklist.
/// Represents a single pack item cross-referenced against the contractor's uploaded documents.
/// Immutable — a fresh list is built every time RefreshDocumentView() runs.
/// Lives in ViewModels.Hr so the XAML DataTemplate can reference it via
/// xmlns:vm="clr-namespace:KaiFlow.Timesheets.ViewModels.Hr" with x:DataType="vm:PackChecklistRow".
/// </summary>
public sealed class PackChecklistRow
{
    public string  DocumentType  { get; init; } = "";
    public string  TypeLabel     { get; init; } = "";
    public bool    IsRequired    { get; init; }  // false = recommended

    /// <summary>
    /// "complete" | "expiring" | "expired" | "pending" | "rejected" | "missing"
    /// </summary>
    public string  Status        { get; init; } = "missing";

    /// <summary>Formatted expiry date string when a document has an expiry date, else null.</summary>
    public string? ExpiryDisplay { get; init; }

    // ── Score ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// True when the document is approved and not expired (expiring-soon still counts).
    /// Only required rows that CountsForScore contribute to the compliance score.
    /// </summary>
    public bool CountsForScore => Status is "complete" or "expiring";

    // ── Requirement badge ─────────────────────────────────────────────────────

    public string RequirementLabel => IsRequired ? "Req." : "Opt.";
    public string RequirementBg    => IsRequired ? "#450A0A" : "#1E293B";
    public string RequirementFg    => IsRequired ? "#FCA5A5" : "#64748B";

    // ── Status badge ──────────────────────────────────────────────────────────

    public string StatusLabel => Status switch
    {
        "complete"  => "Complete",
        "expiring"  => "Expiring",
        "expired"   => "Expired",
        "pending"   => "Pending",
        "rejected"  => "Rejected",
        _           => "Missing",
    };

    public string StatusBadgeBg => Status switch
    {
        "complete"  => "#14532D",
        "expiring"  => "#78350F",
        "expired"   => "#450A0A",
        "pending"   => "#1E293B",
        "rejected"  => "#7F1D1D",
        _           => "#0F172A",
    };

    public string StatusBadgeFg => Status switch
    {
        "complete"  => "#22C55E",
        "expiring"  => "#FCD34D",
        "expired"   => "#FCA5A5",
        "pending"   => "#94A3B8",
        "rejected"  => "#FCA5A5",
        _           => "#475569",
    };

    public bool ShowExpiry => ExpiryDisplay != null;
}
