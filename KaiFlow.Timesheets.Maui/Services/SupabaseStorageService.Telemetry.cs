using KaiFlow.Timesheets.Models;
using Op = Supabase.Postgrest.Constants.Operator;
using Ord = Supabase.Postgrest.Constants.Ordering;

namespace KaiFlow.Timesheets.Services;

public partial class SupabaseStorageService
{
    public async Task<List<AppEvent>> GetAppEventsAsync(Guid companyId, DateTime from, DateTime to, int limit = 3000)
    {
        limit = Math.Clamp(limit, 1, 5000);
        var fromIso = from.ToUniversalTime().ToString("o");
        var toIso = to.ToUniversalTime().ToString("o");

        var result = await _supabase
            .From<AppEvent>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Filter("created_at", Op.GreaterThanOrEqual, fromIso)
            .Filter("created_at", Op.LessThanOrEqual, toIso)
            .Order("created_at", Ord.Descending)
            .Limit(limit)
            .Get()
            .ConfigureAwait(false);

        return result.Models ?? [];
    }
}
