namespace KaiFlow.Timesheets.Models;

/// <summary>
/// One row in the HR Contractor Activity Feed.
/// Built from an app_events row where meta->>'contractor_id' matches.
/// Immutable — rebuilt on every feed reload.
/// Phase 2C.
/// </summary>
public sealed class ContractorActivityEntry
{
    public long     Id        { get; init; }
    public DateTime CreatedAt { get; init; }
    public string   Action    { get; init; } = "";
    public string   Screen    { get; init; } = "";

    /// <summary>Raw meta dictionary from app_events.meta (JSONB).</summary>
    public IReadOnlyDictionary<string, object>? Meta { get; init; }

    // ── Date/time ─────────────────────────────────────────────────────────────

    public string DateDisplay => CreatedAt.ToLocalTime().ToString("dd MMM yyyy");
    public string TimeDisplay => CreatedAt.ToLocalTime().ToString("HH:mm");
    public string DateTimeDisplay => CreatedAt.ToLocalTime().ToString("dd MMM yyyy · HH:mm");

    // ── Event label + badge ───────────────────────────────────────────────────

    public string EventLabel => Action switch
    {
        "contractor_profile_updated"          => "Profile Updated",
        "contractor_document_uploaded"        => "Document Uploaded",
        "contractor_document_replaced"        => "Document Replaced",
        "contractor_document_approved"        => "Document Approved",
        "contractor_document_rejected"        => "Document Rejected",
        "contractor_compliance_pack_changed"  => "Pack Changed",
        "contractor_payment_hold_enabled"     => "Payment Hold On",
        "contractor_payment_hold_disabled"    => "Payment Hold Off",
        "contractor_compliance_hold_enabled"  => "Compliance Hold On",
        "contractor_compliance_hold_disabled" => "Compliance Hold Off",
        "contractor_banking_update_submitted"  => "Banking Submitted",
        "contractor_banking_update_approved"   => "Banking Approved",
        "contractor_banking_update_rejected"   => "Banking Rejected",
        "contractor_banking_verified"         => "Banking Verified",
        "contractor_banking_unverified"       => "Banking Unverified",
        _ => Action.Replace("contractor_", "").Replace("_", " ") is { } s
             ? char.ToUpper(s[0]) + s[1..] : Action
    };

    public string BadgeBg => Action switch
    {
        "contractor_document_approved"        => "#14532D",
        "contractor_document_rejected"        => "#7F1D1D",
        "contractor_document_uploaded"
         or "contractor_document_replaced"    => "#1E3A5F",
        "contractor_profile_updated"          => "#292012",
        "contractor_payment_hold_enabled"
         or "contractor_compliance_hold_enabled" => "#7F1D1D",
        "contractor_payment_hold_disabled"
         or "contractor_compliance_hold_disabled" => "#14532D",
        "contractor_banking_update_submitted"  => "#1E3A5F",
        "contractor_banking_update_approved"   => "#14532D",
        "contractor_banking_update_rejected"   => "#7F1D1D",
        "contractor_banking_verified"         => "#14532D",
        "contractor_banking_unverified"       => "#450A0A",
        "contractor_compliance_pack_changed"  => "#1E293B",
        _                                     => "#1E293B",
    };

    public string BadgeFg => Action switch
    {
        "contractor_document_approved"        => "#22C55E",
        "contractor_document_rejected"        => "#FCA5A5",
        "contractor_document_uploaded"
         or "contractor_document_replaced"    => "#60A5FA",
        "contractor_profile_updated"          => "#FCD34D",
        "contractor_payment_hold_enabled"
         or "contractor_compliance_hold_enabled" => "#FCA5A5",
        "contractor_payment_hold_disabled"
         or "contractor_compliance_hold_disabled" => "#22C55E",
        "contractor_banking_update_submitted"  => "#60A5FA",
        "contractor_banking_update_approved"   => "#22C55E",
        "contractor_banking_update_rejected"   => "#FCA5A5",
        "contractor_banking_verified"         => "#22C55E",
        "contractor_banking_unverified"       => "#FCA5A5",
        _                                     => "#94A3B8",
    };

    // ── Description ───────────────────────────────────────────────────────────

    public string Description
    {
        get
        {
            var docName      = MStr("document_name");
            var docType      = MStr("document_type");
            var packName     = MStr("pack_name");
            var reason       = MStr("rejected_reason");
            var fieldChanges = MFieldChanges();   // new: [{label, from, to}]
            var legacyChanges = MList("changes"); // old: ["company profile", …]

            return Action switch
            {
                // Profile updated — prefer field-level detail; fall back to old format
                "contractor_profile_updated" when fieldChanges.Count > 0
                    => FormatFieldChanges(fieldChanges),
                "contractor_profile_updated" when legacyChanges.Count > 0
                    => "Changed: " + string.Join(", ", legacyChanges),

                "contractor_document_uploaded"
                 or "contractor_document_replaced"
                    => string.IsNullOrEmpty(docName) ? docType : docName,

                "contractor_document_approved"
                    => string.IsNullOrEmpty(docName) ? docType : docName,

                "contractor_document_rejected"
                    => string.IsNullOrEmpty(reason)
                       ? (string.IsNullOrEmpty(docName) ? docType : docName)
                       : $"{docName} — {reason}",

                "contractor_banking_update_submitted"
                    => MStr("account_last4") is { Length: > 0 } last4
                       ? $"Account ending {last4} — awaiting HR review"
                       : "Awaiting HR review",

                "contractor_banking_update_approved"
                    => "Banking details updated. Verification reset — confirm before next payout.",

                "contractor_banking_update_rejected"
                    => MStr("rejection_reason") is { Length: > 0 } r
                       ? $"Rejected: {r}"
                       : "Banking update rejected.",

                "contractor_compliance_pack_changed" when !string.IsNullOrEmpty(packName)
                    => $"Pack: {packName}",

                _ => ""
            };
        }
    }

    /// <summary>
    /// Formats field-level before/after changes into a readable description.
    /// 1–2 changes: "Company Name: ABC → ABC PTY Ltd · VAT Number: *** → 4987654321"
    /// 3+ changes:  "Company Name, VAT Number, Phone, Email updated"
    /// </summary>
    private static string FormatFieldChanges(List<(string Label, string From, string To)> changes)
    {
        if (changes.Count == 0) return "";

        if (changes.Count <= 2)
        {
            return string.Join("  ·  ", changes.Select(c =>
            {
                // Boolean flags shown as enabled/disabled
                if (c.Label == "VAT Registered")
                    return $"VAT Registered {(c.To == "true" ? "enabled" : "disabled")}";

                var from = Trunc(c.From, 28);
                var to   = Trunc(c.To,   28);

                if (string.IsNullOrEmpty(from) && !string.IsNullOrEmpty(to))
                    return $"{c.Label} set to {to}";
                if (!string.IsNullOrEmpty(from) && string.IsNullOrEmpty(to))
                    return $"{c.Label} cleared";
                if (string.IsNullOrEmpty(from) && string.IsNullOrEmpty(to))
                    return $"{c.Label} updated";

                return $"{c.Label}: {from} → {to}";
            }));
        }

        // 3+ changes: list field names to keep the row compact
        return string.Join(", ", changes.Select(c => c.Label)) + " updated";
    }

    private static string Trunc(string s, int max) =>
        s.Length <= max ? s : s[..max] + "…";

    // ── Actor + source ────────────────────────────────────────────────────────

    public string Actor => Screen switch
    {
        "ContractorPortal"       => "Contractor",
        "HrContractorDetails"    => "HR",
        "HrContractorDocuments"  => "HR",
        _                        => "System"
    };

    public string Source => Screen switch
    {
        "ContractorPortal" => "Portal",
        "HrContractorDetails"
         or "HrContractorDocuments" => "HR Portal",
        _ => Screen
    };

    // ── Filter category ───────────────────────────────────────────────────────

    public string Category => Action switch
    {
        var a when a.StartsWith("contractor_document") => "documents",
        var a when a.StartsWith("contractor_profile")  => "profile",
        var a when a.Contains("compliance_pack")       => "compliance",
        var a when a.Contains("hold") || a.Contains("banking") || a.Contains("payment") => "payments",
        _ => "other"
    };

    // For the Portal filter chip: catch all events where the contractor acted
    public bool IsPortalEvent => Screen == "ContractorPortal";

    // ── Meta helpers ──────────────────────────────────────────────────────────

    private string MStr(string key)
    {
        if (Meta == null || !Meta.TryGetValue(key, out var v)) return "";
        return v?.ToString() ?? "";
    }

    private List<string> MList(string key)
    {
        if (Meta == null || !Meta.TryGetValue(key, out var v)) return [];
        return v switch
        {
            System.Collections.IEnumerable ie when v is not string
                => ie.Cast<object>()
                     .Where(o => o is string)   // only plain strings (old changes[] format)
                     .Select(o => o?.ToString() ?? "")
                     .Where(s => s.Length > 0)
                     .ToList(),
            _ => []
        };
    }

    /// <summary>
    /// Reads field_changes — the new [{field, label, from, to}] format.
    /// Returns empty list when not present (old events use changes[] instead).
    /// </summary>
    private List<(string Label, string From, string To)> MFieldChanges()
    {
        if (Meta == null || !Meta.TryGetValue("field_changes", out var v)) return [];
        if (v is not List<object> arr) return [];

        var list = new List<(string, string, string)>();
        foreach (var item in arr)
        {
            if (item is not Dictionary<string, object> dict) continue;
            var label = dict.TryGetValue("label", out var l) ? l?.ToString() ?? "" : "";
            var from  = dict.TryGetValue("from",  out var f) ? f?.ToString() ?? "" : "";
            var to    = dict.TryGetValue("to",    out var t) ? t?.ToString() ?? "" : "";
            if (!string.IsNullOrEmpty(label))
                list.Add((label, from, to));
        }
        return list;
    }
}
