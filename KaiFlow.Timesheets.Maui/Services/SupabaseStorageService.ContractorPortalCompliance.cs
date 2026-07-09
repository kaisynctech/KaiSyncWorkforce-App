using KaiFlow.Timesheets.Models;
using System.Text.Json;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Contractor Portal compliance document access (Phase 2B.3c).
/// Uses SECURITY DEFINER RPCs so the portal's anon session can read
/// and write contractor_documents without a JWT.
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Read: documents ──────────────────────────────────────────────────────

    public async Task<List<ContractorDocument>> ContractorPortalGetDocumentsAsync(
        Guid contractorId, Guid companyId)
    {
        var rows = await _supabase.Rpc("contractor_portal_get_documents",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
            });

        return ParsePortalDocuments(rows?.Content);
    }

    // ─── Read: compliance pack items ──────────────────────────────────────────

    public async Task<List<CompliancePackItem>> ContractorPortalGetCompliancePackAsync(
        Guid contractorId, Guid companyId)
    {
        var rows = await _supabase.Rpc("contractor_portal_get_compliance_pack",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
            });

        var content = rows?.Content;
        if (string.IsNullOrWhiteSpace(content) || content == "null") return [];

        var items = new List<CompliancePackItem>();
        try
        {
            using var doc = JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                items.Add(new CompliancePackItem
                {
                    DocumentType = CPStr(el, "document_type") ?? "",
                    Requirement  = CPStr(el, "requirement")  ?? "required",
                    SortOrder    = CPInt(el, "sort_order"),
                });
            }
        }
        catch { /* tolerate malformed payload */ }
        return items;
    }

    // ─── Upload ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Uploads a compliance document from the contractor portal.
    /// The file is stored in workforce-media under contractor_documents/.
    /// The DB record is inserted as approval_status='pending', uploaded_by_role='contractor_portal'.
    /// When oldDocumentId is provided the old record is superseded (is_current=false).
    /// After upload the VM should call ContractorPortalGetDocumentsAsync to refresh.
    /// </summary>
    public async Task ContractorPortalUploadDocumentAsync(
        Guid     contractorId,
        Guid     companyId,
        FileResult file,
        string   docType,
        string   docName,
        DateOnly? expiryDate,
        Guid?    oldDocumentId = null)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var storagePath  = $"contractor_documents/{companyId}/{contractorId}/{Guid.NewGuid()}{ext}";

        try
        {
            await _supabase.Storage.From("workforce-media").Upload(bytes, storagePath);
        }
        catch (Exception ex)
        {
            throw new Exception($"Could not upload document: {ex.Message}", ex);
        }

        var fileUrl = await ResolveWorkforceMediaUrlAsync(storagePath);

        var rpcParams = new Dictionary<string, object>
        {
            ["p_contractor_id"] = contractorId.ToString(),
            ["p_company_id"]    = companyId.ToString(),
            ["p_document_type"] = docType,
            ["p_document_name"] = docName.Trim(),
            ["p_file_url"]      = fileUrl,
            ["p_storage_path"]  = storagePath,
        };
        if (expiryDate.HasValue)
            rpcParams["p_expiry_date"] = expiryDate.Value.ToString("yyyy-MM-dd");
        if (oldDocumentId.HasValue)
            rpcParams["p_old_document_id"] = oldDocumentId.Value.ToString();

        await _supabase.Rpc("contractor_portal_insert_document", rpcParams);
    }

    // ─── JSON helpers (local; Finance.cs has its own private copies) ──────────

    private static List<ContractorDocument> ParsePortalDocuments(string? content)
    {
        var list = new List<ContractorDocument>();
        if (string.IsNullOrWhiteSpace(content) || content == "null") return list;
        try
        {
            using var doc = JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                list.Add(new ContractorDocument
                {
                    Id             = CPGuid(el, "id"),
                    CompanyId      = CPGuid(el, "company_id"),
                    ContractorId   = CPGuid(el, "contractor_id"),
                    DocumentType   = CPStr(el, "document_type") ?? "",
                    DocumentName   = CPStr(el, "document_name") ?? "",
                    FileUrl        = CPStr(el, "file_url")      ?? "",
                    StoragePath    = CPStr(el, "storage_path"),
                    ApprovalStatus = CPStr(el, "approval_status") ?? "pending",
                    RejectedReason = CPStr(el, "rejected_reason"),
                    IsRequired     = CPBool(el, "is_required"),
                    IsCurrent      = CPBool(el, "is_current", defaultTrue: true),
                    UploadedByRole = CPStr(el, "uploaded_by_role") ?? "hr",
                    ExpiryDate     = CPDate(el, "expiry_date"),
                    CreatedAt      = CPDateTime(el, "created_at"),
                    UpdatedAt      = CPDateTime(el, "updated_at"),
                });
            }
        }
        catch { /* tolerate malformed payload */ }
        return list;
    }

    // Prefixed CP (ContractorPortal) to avoid collision with Finance.cs helpers.
    private static string? CPStr(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static Guid CPGuid(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && Guid.TryParse(v.GetString(), out var g) ? g : Guid.Empty;

    private static bool CPBool(JsonElement e, string name, bool defaultTrue = false)
    {
        if (!e.TryGetProperty(name, out var v)) return defaultTrue;
        return v.ValueKind == JsonValueKind.True || (v.ValueKind == JsonValueKind.False ? false : defaultTrue);
    }

    private static int CPInt(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
           && v.TryGetInt32(out var i) ? i : 0;

    private static DateOnly? CPDate(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
           && DateOnly.TryParse(v.GetString(), out var d) ? d : null;

    private static DateTime CPDateTime(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
           && DateTime.TryParse(v.GetString(), out var dt) ? dt : DateTime.UtcNow;
}
