using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public interface IOfflineQueueService
{
    Task EnqueuePunchAsync(TimePunch punch);
    Task<List<TimePunch>> GetQueuedPunchesAsync();
    Task EnqueueIncidentAsync(PendingIncident pending);
    Task<List<PendingIncident>> GetQueuedIncidentsAsync();
    Task<int> ReplayQueueAsync();
    Task ClearQueueAsync();
    int QueuedCount { get; }
    int QueuedIncidentCount { get; }
}
