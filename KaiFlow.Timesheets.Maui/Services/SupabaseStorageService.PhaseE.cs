namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Phase E — contractor-initiated invoice submission from the portal.
/// Portal calls use SECURITY DEFINER RPCs (anon-accessible, code-based auth).
/// The RPC resolves contractor identity from portal codes and creates a
/// contractor_payouts row with approval_status = 'pending' for HR review.
/// </summary>
public partial class SupabaseStorageService
{
    public async Task<Guid> ContractorPortalSubmitInvoiceAsync(
        string  companyCode,
        string  contractorCode,
        Guid    jobId,
        decimal amount,
        string? invoiceReference,
        string? notes)
    {
        var result = await _supabase.Rpc("contractor_portal_submit_invoice",
            new Dictionary<string, object>
            {
                ["p_company_code"]      = companyCode.Trim().ToUpperInvariant(),
                ["p_contractor_code"]   = contractorCode.Trim().ToUpperInvariant(),
                ["p_job_id"]            = jobId.ToString(),
                ["p_amount"]            = amount,
                ["p_invoice_reference"] = invoiceReference?.Trim() ?? (object)null!,
                ["p_notes"]             = notes?.Trim()             ?? (object)null!,
            });

        var content = result?.Content?.Trim('"');
        return Guid.TryParse(content, out var id) ? id : Guid.Empty;
    }
}
