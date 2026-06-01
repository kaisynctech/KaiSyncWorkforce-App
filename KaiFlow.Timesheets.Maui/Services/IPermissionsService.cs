using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public interface IPermissionsService
{
    Task RefreshAsync(Guid companyId, Employee employee);
    bool Can(string permissionKey);
    bool IsLoaded { get; }
}
