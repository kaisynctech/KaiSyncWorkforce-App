using KaiFlow.Timesheets.Models;
using static Supabase.Postgrest.Constants;

namespace KaiFlow.Timesheets.Services;

public partial class SupabaseStorageService
{
    /// <inheritdoc />
    public async Task<List<JobContractor>> GetJobContractorsAsync(Guid jobId)
    {
        var result = await _supabase
            .From<JobContractor>()
            .Select("*, jobs(*)")
            .Filter("job_id", Operator.Equals, jobId.ToString())
            .Order("assigned_at", Ordering.Ascending)
            .Get();

        return result.Models;
    }

    /// <inheritdoc />
    public async Task<List<ProjectContractor>> GetProjectContractorsAsync(Guid dealId)
    {
        var result = await _supabase
            .From<ProjectContractor>()
            .Select("*, client_deals(*)")
            .Filter("deal_id", Operator.Equals, dealId.ToString())
            .Order("assigned_at", Ordering.Ascending)
            .Get();

        return result.Models;
    }

    /// <inheritdoc />
    public async Task<List<JobContractor>> GetContractorAssignmentsAsync(Guid companyId, Guid contractorId)
    {
        var result = await _supabase
            .From<JobContractor>()
            .Select("*, jobs(*)")
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Filter("contractor_id", Operator.Equals, contractorId.ToString())
            .Order("assigned_at", Ordering.Descending)
            .Get();

        return result.Models;
    }

    /// <inheritdoc />
    public async Task<List<JobContractor>> GetAllJobContractorsAsync(Guid companyId)
    {
        var result = await _supabase
            .From<JobContractor>()
            .Select("*")
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Get();

        return result.Models;
    }

    /// <inheritdoc />
    public async Task<List<ProjectContractor>> GetContractorProjectsAsync(Guid companyId, Guid contractorId)
    {
        var result = await _supabase
            .From<ProjectContractor>()
            .Select("*, client_deals(*)")
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Filter("contractor_id", Operator.Equals, contractorId.ToString())
            .Order("assigned_at", Ordering.Descending)
            .Get();

        return result.Models;
    }

    /// <inheritdoc />
    public async Task UpsertJobContractorAsync(Guid companyId, Guid jobId, Guid contractorId, Guid? quoteId = null, decimal agreedAmount = 0)
    {
        var existing = await _supabase
            .From<JobContractor>()
            .Filter("job_id", Operator.Equals, jobId.ToString())
            .Filter("contractor_id", Operator.Equals, contractorId.ToString())
            .Get();

        if (existing.Models.Count > 0) return;

        await _supabase.From<JobContractor>().Insert(new JobContractor
        {
            Id            = Guid.NewGuid(),
            CompanyId     = companyId,
            JobId         = jobId,
            ContractorId  = contractorId,
            QuoteId       = quoteId,
            Role          = "general",
            AgreedAmount  = agreedAmount,
            QuotedAmount  = agreedAmount,
            StatusRaw     = "assigned",
            AssignedAt    = DateTime.UtcNow,
            CreatedAt     = DateTime.UtcNow,
            UpdatedAt     = DateTime.UtcNow,
        });
    }

    /// <inheritdoc />
    public async Task UpsertProjectContractorAsync(Guid companyId, Guid dealId, Guid contractorId)
    {
        var existing = await _supabase
            .From<ProjectContractor>()
            .Filter("deal_id", Operator.Equals, dealId.ToString())
            .Filter("contractor_id", Operator.Equals, contractorId.ToString())
            .Get();

        if (existing.Models.Count > 0) return;

        await _supabase.From<ProjectContractor>().Insert(new ProjectContractor
        {
            Id           = Guid.NewGuid(),
            CompanyId    = companyId,
            DealId       = dealId,
            ContractorId = contractorId,
            Role         = "general",
            StatusRaw    = "active",
            AssignedAt   = DateTime.UtcNow,
            CreatedAt    = DateTime.UtcNow,
            UpdatedAt    = DateTime.UtcNow,
        });
    }

    /// <inheritdoc />
    public async Task DeleteJobContractorAsync(Guid companyId, Guid id)
    {
        await _supabase
            .From<JobContractor>()
            .Filter("id",         Operator.Equals, id.ToString())
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Delete();
    }

    /// <inheritdoc />
    public async Task UpdateJobContractorAsync(
        Guid companyId, Guid jobContractorId, string role, decimal agreedAmount)
    {
        await _supabase
            .From<JobContractor>()
            .Filter("id",         Operator.Equals, jobContractorId.ToString())
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Set(x => x.Role,         role)
            .Set(x => x.AgreedAmount, agreedAmount)
            .Set(x => x.UpdatedAt,    DateTime.UtcNow)
            .Update();
    }
}
