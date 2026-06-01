namespace KaiFlow.Timesheets.Services;

/// <summary>OAuth calendar connect scaffold — finish when Google/Azure app IDs are configured.</summary>
public interface IMyPaCalendarConnectService
{
    bool IsGoogleConfigured { get; }
    bool IsOutlookConfigured { get; }
    Task ConnectGoogleAsync(Guid employeeId, Guid companyId);
    Task ConnectOutlookAsync(Guid employeeId, Guid companyId);
    Task DisconnectAsync(Guid employeeId, string provider);
}
