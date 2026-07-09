namespace KaiFlow.Timesheets.Models;

/// <summary>
/// One entry in the contractor activity feed (Section B of the Activity tab).
/// Populated by hr_get_contractor_activity() — each row is one app_events record
/// with display fields pre-computed in SQL.
/// </summary>
public sealed class ContractorActivityEvent
{
    public string   Id             { get; init; } = "";
    public Guid     ContractorId   { get; init; }
    public string   ContractorName { get; init; } = "";
    public string   ContractorCode { get; init; } = "";
    public string   Screen         { get; init; } = "";
    public string   Action         { get; init; } = "";
    /// <summary>quotes | banking | profile | documents | other — used for filter</summary>
    public string   EventType      { get; init; } = "";
    /// <summary>Human-readable label: "Quote Approved", "Banking Submitted", etc.</summary>
    public string   EventLabel     { get; init; } = "";
    /// <summary>Short description built from meta fields in SQL.</summary>
    public string   Summary        { get; init; } = "";
    /// <summary>HR or Portal</summary>
    public string   Source         { get; init; } = "";
    public DateTime CreatedAt      { get; init; }

    // ── Display helpers ───────────────────────────────────────────────────────

    public string CreatedAtDisplay => CreatedAt == default
        ? "—" : CreatedAt.ToLocalTime().ToString("dd MMM HH:mm");

    /// <summary>
    /// Safe display name — never shows "Unknown" (Polish item 1).
    /// Fallback order: ContractorName → ContractorCode → "Contractor removed"
    /// </summary>
    public string ContractorDisplay =>
        !string.IsNullOrWhiteSpace(ContractorName) && ContractorName != "Unknown Contractor"
            ? ContractorName
            : !string.IsNullOrWhiteSpace(ContractorCode)
                ? ContractorCode
                : "Contractor removed";

    // ── Severity colours (Polish item 4) ──────────────────────────────────────

    /// <summary>Badge background — action-aware for strong severity signals.</summary>
    public string EventTypeBadgeBg => Action switch
    {
        "hr_approve_quote"                    => "#071A0F",   // dark green
        "contractor_banking_update_approved"  => "#071A0F",   // dark green
        "hr_reject_quote"                     => "#1A0707",   // dark red
        "contractor_banking_update_rejected"  => "#1A0707",   // dark red
        "hr_request_revision"                 => "#1C0F00",   // dark amber
        "contractor_banking_update_submitted" => "#29200E",   // amber
        _ => EventType switch
        {
            "quotes"  => "#1E3A5F",   // blue
            "banking" => "#29200E",   // amber
            "profile" => "#1A1A2E",   // purple
            _         => "#1E293B"
        }
    };

    public string EventTypeBadgeFg => EventType switch
    {
        "quotes"  => "#60A5FA",
        "banking" => "#FCD34D",
        "profile" => "#A78BFA",
        _         => "#94A3B8"
    };

    /// <summary>Text colour for the event label — severity-based (Polish item 4).</summary>
    public string EventLabelColor => Action switch
    {
        "hr_approve_quote"                    => "#22C55E",   // green
        "contractor_banking_update_approved"  => "#22C55E",   // green
        "hr_reject_quote"                     => "#F87171",   // red
        "contractor_banking_update_rejected"  => "#F87171",   // red
        "hr_request_revision"                 => "#FDBA74",   // amber
        "contractor_banking_update_submitted" => "#FCD34D",   // amber
        "contractor_quote_submitted"          => "#60A5FA",   // blue
        "resubmit_quote"                      => "#FDBA74",   // amber
        "hr_start_review"                     => "#93C5FD",   // lighter blue
        "contractor_profile_updated"          => "#A78BFA",   // purple
        "contractor_tax_updated"              => "#A78BFA",   // purple
        _                                     => "#94A3B8"    // slate default
    };

    public string SourceBadgeBg => Source == "Portal" ? "#0F2E0F" : "#1E1E3A";
    public string SourceBadgeFg => Source == "Portal" ? "#4ADE80"  : "#818CF8";

    /// <summary>Tab that the Open button should navigate to in contractor details.</summary>
    public string TargetTab => EventType switch
    {
        "quotes"  => "quotes",
        "banking" => "banking",
        "profile" => "information",
        _         => "activity"
    };
}
