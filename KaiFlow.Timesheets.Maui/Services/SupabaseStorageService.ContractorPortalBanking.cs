using KaiFlow.Timesheets.Models;
using System.Text.Json;
using static Supabase.Postgrest.Constants;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Contractor Portal banking self-service operations (Phase 2C.3).
///
/// Portal RPCs (SECURITY DEFINER, anon-callable):
///   contractor_portal_get_banking           — masked current banking status
///   contractor_portal_submit_banking        — create pending update + notify HR
///   contractor_portal_get_pending_banking   — portal's own pending update (masked)
///
/// HR direct PostgREST (authenticated JWT):
///   GetContractorPendingBankingAsync        — HR reads full pending update record
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Portal: get current banking (masked) ─────────────────────────────────

    public async Task<ContractorBankingStatus?> ContractorPortalGetBankingAsync(
        Guid contractorId, Guid companyId)
    {
        var result = await _supabase.Rpc("contractor_portal_get_banking",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
            });

        var content = result?.Content;
        if (string.IsNullOrWhiteSpace(content) || content is "null" or "[]") return null;

        try
        {
            using var doc = JsonDocument.Parse(content);
            var el = doc.RootElement;
            return new ContractorBankingStatus
            {
                AccountHolderName     = BStr(el, "account_holder_name"),
                BankName              = BStr(el, "bank_name"),
                MaskedAccount         = BStr(el, "masked_account"),
                BankBranchCode        = BStr(el, "bank_branch_code"),
                AccountType           = BStr(el, "account_type"),
                SwiftBic              = BStr(el, "swift_bic"),
                HasBankingDetails     = BBool(el, "has_banking_details"),
                BankingVerified       = BBool(el, "banking_verified"),
                PaymentHold           = BBool(el, "payment_hold"),
                ComplianceHold        = BBool(el, "compliance_hold"),
                PaymentTerms          = BStr(el, "payment_terms"),
                PreferredPaymentMethod = BStr(el, "preferred_payment_method"),
            };
        }
        catch { return null; }
    }

    // ─── Portal: submit banking update ────────────────────────────────────────

    public async Task ContractorPortalSubmitBankingAsync(
        Guid   contractorId,
        Guid   companyId,
        string accountHolder,
        string bankName,
        string bankAccount,
        string branchCode,
        string accountType,
        string swiftBic)
    {
        await _supabase.Rpc("contractor_portal_submit_banking",
            new Dictionary<string, object>
            {
                ["p_contractor_id"]  = contractorId.ToString(),
                ["p_company_id"]     = companyId.ToString(),
                ["p_account_holder"] = accountHolder.Trim(),
                ["p_bank_name"]      = bankName.Trim(),
                ["p_bank_account"]   = bankAccount.Trim(),
                ["p_branch_code"]    = branchCode.Trim(),
                ["p_account_type"]   = accountType.Trim(),
                ["p_swift_bic"]      = swiftBic.Trim(),
            });
    }

    // ─── Portal: get own pending banking update (masked) ──────────────────────

    public async Task<ContractorBankingUpdate?> ContractorPortalGetPendingBankingAsync(
        Guid contractorId, Guid companyId)
    {
        var result = await _supabase.Rpc("contractor_portal_get_pending_banking",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
            });
        return ParsePortalBankingUpdate(result?.Content, contractorId, companyId);
    }

    // ─── Portal: get latest banking decision (any status) ────────────────────
    //
    // Returns the most recent banking update (pending/approved/rejected).
    // Lets the contractor see decisions after HR reviews, not just pending state.

    public async Task<ContractorBankingUpdate?> ContractorPortalGetLatestBankingDecisionAsync(
        Guid contractorId, Guid companyId)
    {
        var result = await _supabase.Rpc("contractor_portal_get_latest_banking_decision",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
            });
        return ParsePortalBankingUpdate(result?.Content, contractorId, companyId);
    }

    /// <summary>Shared parser for pending and latest-decision portal RPCs.</summary>
    private static ContractorBankingUpdate? ParsePortalBankingUpdate(
        string? content, Guid contractorId, Guid companyId)
    {
        if (string.IsNullOrWhiteSpace(content) || content is "null" or "[]") return null;
        try
        {
            using var doc = JsonDocument.Parse(content);
            var el = doc.RootElement;

            DateTime.TryParse(BStr(el, "submitted_at"), out var submitted);
            var reviewedAtStr = BStr(el, "reviewed_at");
            DateTime.TryParse(reviewedAtStr, out var reviewedParsed);
            DateTime? reviewedAt = reviewedAtStr != null ? reviewedParsed : null;

            return new ContractorBankingUpdate
            {
                Id                = Guid.TryParse(BStr(el, "id"), out var gid) ? gid : Guid.Empty,
                ContractorId      = contractorId,
                CompanyId         = companyId,
                AccountHolderName = BStr(el, "account_holder_name"),
                BankName          = BStr(el, "bank_name"),
                BankAccount       = BStr(el, "masked_account"),   // always masked in portal RPCs
                BankBranchCode    = BStr(el, "bank_branch_code"),
                AccountType       = BStr(el, "account_type"),
                SwiftBic          = BStr(el, "swift_bic"),
                Status            = BStr(el, "status") ?? "pending",
                SubmittedAt       = submitted,
                ReviewedAt        = reviewedAt,
                RejectionReason   = BStr(el, "rejection_reason"),
            };
        }
        catch { return null; }
    }

    // ─── HR: read pending banking update (authenticated, direct PostgREST) ────

    public async Task<ContractorBankingUpdate?> GetContractorPendingBankingAsync(
        Guid companyId, Guid contractorId)
    {
        var result = await _supabase
            .From<ContractorBankingUpdate>()
            .Filter("contractor_id", Operator.Equals, contractorId.ToString())
            .Filter("company_id",    Operator.Equals, companyId.ToString())
            .Filter("status",        Operator.Equals, "pending")
            .Order("submitted_at", Ordering.Descending)
            .Limit(1)
            .Get();

        return result.Models.FirstOrDefault();
    }

    // ─── JSON helpers (B = Banking) ───────────────────────────────────────────

    private static string? BStr(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
           ? v.GetString() : null;

    private static bool BBool(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
}
