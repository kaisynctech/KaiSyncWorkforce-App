using KaiFlow.Timesheets.Models;
using System.Text.Json;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Contractor Portal self-service profile operations (Phase 2C.2).
/// Uses SECURITY DEFINER RPCs — no direct table access from the portal.
/// Contractor identity is validated server-side via contractor_id + company_id.
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Get profile ──────────────────────────────────────────────────────────

    public async Task<ContractorPortalProfile?> ContractorPortalGetProfileAsync(
        Guid contractorId, Guid companyId)
    {
        var result = await _supabase.Rpc("contractor_portal_get_profile",
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
            return ParseProfile(el);
        }
        catch { return null; }
    }

    // ─── Update profile ───────────────────────────────────────────────────────

    public async Task ContractorPortalUpdateProfileAsync(
        Guid contractorId, Guid companyId, ContractorPortalProfile profile)
    {
        await _supabase.Rpc("contractor_portal_update_profile",
            new Dictionary<string, object>
            {
                ["p_contractor_id"]       = contractorId.ToString(),
                ["p_company_id"]          = companyId.ToString(),
                ["p_name"]                = profile.Name.Trim(),
                ["p_registration_number"] = profile.RegistrationNumber?.Trim() ?? "",
                ["p_tax_number"]          = profile.TaxNumber?.Trim()          ?? "",
                ["p_is_vat_registered"]   = profile.IsVatRegistered,
                ["p_vat_number"]          = profile.IsVatRegistered
                                            ? (profile.VatNumber?.Trim() ?? "")
                                            : "",
                ["p_contact_person"]      = profile.ContactPerson?.Trim()  ?? "",
                ["p_phone"]               = profile.Phone?.Trim()           ?? "",
                ["p_email"]               = profile.Email?.Trim()           ?? "",
                ["p_address"]             = profile.Address?.Trim()         ?? "",
            });
    }

    // ─── JSON parser ─────────────────────────────────────────────────────────

    private static ContractorPortalProfile ParseProfile(JsonElement el)
    {
        return new ContractorPortalProfile
        {
            // Editable
            Name               = PPStr(el, "name")               ?? "",
            RegistrationNumber = PPStr(el, "registration_number"),
            TaxNumber          = PPStr(el, "tax_number"),
            IsVatRegistered    = PPBool(el, "is_vat_registered"),
            VatNumber          = PPStr(el, "vat_number"),
            ContactPerson      = PPStr(el, "contact_person"),
            Phone              = PPStr(el, "phone"),
            Email              = PPStr(el, "email"),
            Address            = PPStr(el, "address"),
            // Read-only identity
            CompanyName        = PPStr(el, "company_name")    ?? "",
            CompanyCode        = PPStr(el, "company_code")    ?? "",
            ContractorCode     = PPStr(el, "contractor_code") ?? "",
            PartnerKind        = PPStr(el, "partner_kind")    ?? "",
            // Read-only HR-owned (Rating intentionally not parsed — not in RPC response)
            BankingVerified        = PPBool(el, "banking_verified"),
            PaymentHold            = PPBool(el, "payment_hold"),
            ComplianceHold         = PPBool(el, "compliance_hold"),
            IsActive               = PPBool(el, "is_active", defaultTrue: true),
            PaymentTerms           = PPStr(el, "payment_terms"),
            PreferredPaymentMethod = PPStr(el, "preferred_payment_method"),
            CompliancePackName     = PPStr(el, "compliance_pack_name"),
        };
    }

    // Local helpers (PP = portal profile) — avoid collision with Finance helpers.
    private static string? PPStr(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
           ? v.GetString() : null;

    private static bool PPBool(JsonElement e, string name, bool defaultTrue = false)
    {
        if (!e.TryGetProperty(name, out var v)) return defaultTrue;
        return v.ValueKind == JsonValueKind.True || (v.ValueKind != JsonValueKind.False && defaultTrue);
    }

    // PPDouble removed — rating is not returned by contractor_portal_get_profile.
}
