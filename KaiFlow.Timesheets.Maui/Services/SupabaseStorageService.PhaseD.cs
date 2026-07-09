using KaiFlow.Timesheets.Models;
using static Supabase.Postgrest.Constants;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Phase D — job-contractor-level document operations.
/// HR-only upload path: authenticated JWT → direct storage upload → PostgREST insert.
/// Storage path: job_contractor_documents/{companyId}/{jobContractorId}/{guid}{ext}
/// </summary>
public partial class SupabaseStorageService
{
    public async Task<JobContractor?> GetJobContractorByIdAsync(Guid jobContractorId, Guid companyId)
    {
        var result = await _supabase
            .From<JobContractor>()
            .Select("*, jobs(*)")
            .Filter("id",         Operator.Equals, jobContractorId.ToString())
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task<List<JobContractorDocument>> GetJobContractorDocumentsAsync(
        Guid companyId, Guid jobContractorId)
    {
        var result = await _supabase
            .From<JobContractorDocument>()
            .Filter("company_id",        Operator.Equals, companyId.ToString())
            .Filter("job_contractor_id", Operator.Equals, jobContractorId.ToString())
            .Order("created_at", Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<JobContractorDocument> UploadJobContractorDocumentAsync(
        Guid       companyId,
        Guid       jobId,
        Guid       contractorId,
        Guid       jobContractorId,
        FileResult file,
        string     documentType,
        string     documentName,
        Guid?      createdBy = null)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var storagePath  = $"job_contractor_documents/{companyId}/{jobContractorId}/{Guid.NewGuid()}{ext}";

        try
        {
            await _supabase.Storage.From("workforce-media").Upload(bytes, storagePath);
        }
        catch (Exception ex)
        {
            throw new Exception($"Could not upload document: {ex.Message}", ex);
        }

        var fileUrl = await ResolveWorkforceMediaUrlAsync(storagePath);

        var doc = new JobContractorDocument
        {
            CompanyId       = companyId,
            JobId           = jobId,
            ContractorId    = contractorId,
            JobContractorId = jobContractorId,
            DocumentType    = documentType,
            DocumentName    = documentName.Trim(),
            FileUrl         = fileUrl,
            StoragePath     = storagePath,
            CreatedBy       = createdBy,
            CreatedAt       = DateTime.UtcNow,
            UpdatedAt       = DateTime.UtcNow,
        };

        var inserted = await _supabase.From<JobContractorDocument>().Insert(doc);
        return inserted.Models.First();
    }

    public async Task DeleteJobContractorDocumentAsync(JobContractorDocument document)
    {
        await _supabase
            .From<JobContractorDocument>()
            .Filter("id", Operator.Equals, document.Id.ToString())
            .Delete();

        if (!string.IsNullOrWhiteSpace(document.StoragePath))
            await TryDeleteStorageFileByPathAsync(document.StoragePath);
        else if (!string.IsNullOrWhiteSpace(document.FileUrl))
            await TryDeleteStorageFileAsync(document.FileUrl);
    }
}
