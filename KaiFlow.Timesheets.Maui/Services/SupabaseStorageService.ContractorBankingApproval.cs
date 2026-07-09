namespace KaiFlow.Timesheets.Services;

/// <summary>
/// HR-side banking approval / rejection (Phase 2C.4).
/// Both operations use SECURITY DEFINER RPCs that validate:
///   - The update is pending
///   - The reviewer is an active HR/admin/owner employee in the same company
/// Approval copies banking fields to contractors table and resets banking_verified = false.
/// Rejection marks the update rejected; contractors table is never touched.
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Approve ──────────────────────────────────────────────────────────────

    public async Task ApproveContractorBankingAsync(Guid updateId, Guid reviewedByEmployeeId)
    {
        await _supabase.Rpc("hr_approve_contractor_banking",
            new Dictionary<string, object>
            {
                ["p_update_id"]   = updateId.ToString(),
                ["p_reviewed_by"] = reviewedByEmployeeId.ToString(),
            });
    }

    // ─── Reject ───────────────────────────────────────────────────────────────

    public async Task RejectContractorBankingAsync(
        Guid updateId, Guid reviewedByEmployeeId, string reason)
    {
        await _supabase.Rpc("hr_reject_contractor_banking",
            new Dictionary<string, object>
            {
                ["p_update_id"]   = updateId.ToString(),
                ["p_reviewed_by"] = reviewedByEmployeeId.ToString(),
                ["p_reason"]      = reason.Trim(),
            });
    }
}
