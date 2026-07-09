namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Phase P — contractor portal reject → revise → resubmit flow.
/// Calls the SECURITY DEFINER RPC which validates the contractor identity
/// via portal codes and resets the payout to pending for HR re-review.
/// </summary>
public partial class SupabaseStorageService
{
    public async Task ContractorPortalResubmitPayoutAsync(
        string  companyCode,
        string  contractorCode,
        Guid    payoutId,
        decimal amount,
        string? invoiceReference,
        string? notes)
    {
        await _supabase.Rpc("contractor_portal_resubmit_payout",
            new Dictionary<string, object>
            {
                ["p_company_code"]      = companyCode.Trim().ToUpperInvariant(),
                ["p_contractor_code"]   = contractorCode.Trim().ToUpperInvariant(),
                ["p_payout_id"]         = payoutId.ToString(),
                ["p_amount"]            = amount,
                ["p_invoice_reference"] = invoiceReference?.Trim() ?? (object)null!,
                ["p_notes"]             = notes?.Trim()             ?? (object)null!,
            });
    }
}
