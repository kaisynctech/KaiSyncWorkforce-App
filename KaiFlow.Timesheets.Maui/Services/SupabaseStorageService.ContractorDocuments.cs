using KaiFlow.Timesheets.Models;
using static Supabase.Postgrest.Constants;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Contractor compliance document operations (Phase 2B.1).
/// HR-only upload path: authenticated JWT → direct storage upload → PostgREST insert.
/// No upload-grant needed for authenticated users (bucket policy allows direct INSERT).
/// Contractor portal upload support is Phase 2B.2.
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Read ─────────────────────────────────────────────────────────────────

    public async Task<List<ContractorDocument>> GetContractorDocumentsAsync(
        Guid companyId, Guid contractorId)
    {
        var result = await _supabase
            .From<ContractorDocument>()
            .Filter("company_id",    Operator.Equals, companyId.ToString())
            .Filter("contractor_id", Operator.Equals, contractorId.ToString())
            .Filter("is_current",    Operator.Equals, "true")
            .Order("created_at", Ordering.Descending)
            .Get();
        return result.Models;
    }

    // ─── Upload ───────────────────────────────────────────────────────────────

    public async Task<ContractorDocument> UploadContractorDocumentAsync(
        Guid companyId, Guid contractorId,
        FileResult file,
        string documentType, string documentName,
        DateOnly? issueDate, DateOnly? expiryDate,
        bool isRequired)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var storagePath = $"contractor_documents/{companyId}/{contractorId}/{Guid.NewGuid()}{ext}";

        // HR uses authenticated JWT — direct upload, no grant required.
        try
        {
            await _supabase.Storage.From("workforce-media").Upload(bytes, storagePath);
        }
        catch (Exception ex)
        {
            throw new Exception($"Could not upload contractor document: {ex.Message}", ex);
        }

        var fileUrl = await ResolveWorkforceMediaUrlAsync(storagePath);

        var doc = new ContractorDocument
        {
            CompanyId      = companyId,
            ContractorId   = contractorId,
            DocumentType   = documentType,
            DocumentName   = documentName.Trim(),
            FileUrl        = fileUrl,
            StoragePath    = storagePath,
            IssueDate      = issueDate,
            ExpiryDate     = expiryDate,
            ApprovalStatus = "approved",   // HR uploads are auto-approved
            ApprovedAt     = DateTime.UtcNow,
            IsRequired     = isRequired,
            IsCurrent      = true,
            UploadedByRole = "hr",
            CreatedAt      = DateTime.UtcNow,
            UpdatedAt      = DateTime.UtcNow,
        };

        var inserted = await _supabase.From<ContractorDocument>().Insert(doc);
        return inserted.Models.First();
    }

    // ─── Approve ──────────────────────────────────────────────────────────────

    public async Task<ContractorDocument> ApproveContractorDocumentAsync(
        Guid documentId, Guid approvedByEmployeeId)
    {
        var result = await _supabase
            .From<ContractorDocument>()
            .Filter("id", Operator.Equals, documentId.ToString())
            .Set(d => d.ApprovalStatus, "approved")
            .Set(d => d.ApprovedBy,     approvedByEmployeeId)
            .Set(d => d.ApprovedAt,     DateTime.UtcNow)
            .Set(d => d.RejectedReason, null!)
            .Set(d => d.UpdatedAt,      DateTime.UtcNow)
            .Update();
        var doc = result.Models.First();

        // Activity log — non-fatal
        _ = WriteContractorEventAsync(doc.CompanyId, doc.ContractorId,
            "HrContractorDocuments", "contractor_document_approved",
            new()
            {
                ["document_id"]   = doc.Id.ToString(),
                ["document_name"] = doc.DocumentName,
                ["document_type"] = doc.DocumentType,
            });

        return doc;
    }

    // ─── Reject ───────────────────────────────────────────────────────────────

    public async Task<ContractorDocument> RejectContractorDocumentAsync(
        Guid documentId, string reason)
    {
        var result = await _supabase
            .From<ContractorDocument>()
            .Filter("id", Operator.Equals, documentId.ToString())
            .Set(d => d.ApprovalStatus, "rejected")
            .Set(d => d.RejectedReason, reason.Trim())
            .Set(d => d.ApprovedBy,     null!)
            .Set(d => d.ApprovedAt,     null!)
            .Set(d => d.UpdatedAt,      DateTime.UtcNow)
            .Update();
        var doc = result.Models.First();

        // Activity log — non-fatal
        _ = WriteContractorEventAsync(doc.CompanyId, doc.ContractorId,
            "HrContractorDocuments", "contractor_document_rejected",
            new()
            {
                ["document_id"]      = doc.Id.ToString(),
                ["document_name"]    = doc.DocumentName,
                ["document_type"]    = doc.DocumentType,
                ["rejected_reason"]  = reason.Trim(),
            });

        return doc;
    }

    // ─── Delete ───────────────────────────────────────────────────────────────

    public async Task DeleteContractorDocumentAsync(ContractorDocument document)
    {
        // Remove DB row first.
        await _supabase
            .From<ContractorDocument>()
            .Filter("id", Operator.Equals, document.Id.ToString())
            .Delete();

        // Then clean up storage (non-fatal — row is already gone).
        if (!string.IsNullOrWhiteSpace(document.StoragePath))
            await TryDeleteStorageFileByPathAsync(document.StoragePath);
        else if (!string.IsNullOrWhiteSpace(document.FileUrl))
            await TryDeleteStorageFileAsync(document.FileUrl);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// <summary>
    /// Deletes a file from workforce-media by its raw storage path (not URL).
    /// Unlike TryDeleteStorageFileAsync which takes a full URL, this takes
    /// the path directly — avoiding URL parsing issues for signed URLs.
    /// </summary>
    private async Task TryDeleteStorageFileByPathAsync(string storagePath)
    {
        try
        {
            await _supabase.Storage.From("workforce-media").Remove(new List<string> { storagePath });
        }
        catch
        {
            // Non-fatal: DB row is already deleted.
        }
    }
}
