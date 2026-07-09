namespace KaiFlow.Timesheets.Models;

/// <summary>
/// One item in the HR Contractor Action Centre.
/// Aggregated from: contractor_quotes (pending review),
/// contractor_banking_updates (pending approval),
/// contractor_documents (pending approval / expiring).
///
/// Populated by hr_get_contractor_action_items() RPC (Phase 2D.3).
/// UI-only: not stored as a DB table — read-only projection.
/// </summary>
public sealed class ContractorActionItem
{
    public Guid     RefId           { get; init; }
    public Guid     ContractorId    { get; init; }
    // Settable so the enrichment step can fill in contractor names after construction
    public string   ContractorName  { get; set; } = "";
    public string   ContractorCode  { get; set; } = "";
    /// <summary>quote_pending | banking_pending | document_pending | document_expiring</summary>
    public string   ActionType      { get; init; } = "";
    public string   Summary         { get; init; } = "";
    public decimal? Amount          { get; init; }
    public string   Status          { get; init; } = "";
    public DateTime CreatedAt       { get; init; }

    // ── Display helpers ───────────────────────────────────────────────────────

    public string ActionTypeLabel => ActionType switch
    {
        "quote_pending"     => "Quote Pending",
        "banking_pending"   => "Banking Pending",
        "document_pending"  => "Doc Pending",
        "document_expiring" => "Expiring Doc",
        _                   => ActionType
    };

    // ── Severity colours (Polish item 4) ──────────────────────────────────────
    // Quote → Blue  |  Banking → Amber  |  Document → Red  |  Expiring → Orange
    public string ActionTypeBadgeBg => ActionType switch
    {
        "quote_pending"     => "#1E3A5F",   // blue
        "banking_pending"   => "#29200E",   // amber
        "document_pending"  => "#3B0E0E",   // red   (was slate)
        "document_expiring" => "#3B1700",   // orange
        _                   => "#1E293B"
    };

    public string ActionTypeBadgeFg => ActionType switch
    {
        "quote_pending"     => "#93C5FD",   // light blue
        "banking_pending"   => "#FCD34D",   // amber
        "document_pending"  => "#FCA5A5",   // light red  (was slate)
        "document_expiring" => "#FB923C",   // orange
        _                   => "#94A3B8"
    };

    /// <summary>Tab slug for deep-link navigation.</summary>
    public string TargetTab => ActionType switch
    {
        "quote_pending"     => "quotes",
        "banking_pending"   => "banking",
        "document_pending"  => "compliance",
        "document_expiring" => "compliance",
        _                   => "information"
    };

    public string AmountDisplay => Amount is > 0 ? $"R{Amount:N2}" : "";

    public string CreatedAtDisplay => CreatedAt == default
        ? "—" : CreatedAt.ToLocalTime().ToString("dd MMM HH:mm");

    /// <summary>
    /// How long the item has been waiting for HR action (Polish item 5).
    /// &lt;60 min → "Xm"  |  &lt;24 h → "Xh"  |  otherwise → "Xd"
    /// </summary>
    public string WaitingDisplay
    {
        get
        {
            if (CreatedAt == default) return "—";
            var elapsed = DateTime.UtcNow - CreatedAt.ToUniversalTime();
            if (elapsed.TotalMinutes < 60)  return $"{Math.Max(1, (int)elapsed.TotalMinutes)}m";
            if (elapsed.TotalHours   < 24)  return $"{(int)elapsed.TotalHours}h";
            return $"{(int)elapsed.TotalDays}d";
        }
    }

    /// <summary>
    /// Safe display name (Polish item 1).
    /// Fallback: ContractorName → ContractorCode → "Contractor removed"
    /// </summary>
    public string ContractorDisplay =>
        !string.IsNullOrWhiteSpace(ContractorName) ? ContractorName
        : !string.IsNullOrWhiteSpace(ContractorCode) ? ContractorCode
        : "Contractor removed";
}
