using KaiFlow.Timesheets.Models;
using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Persists failed punches and incidents to SecureStorage and replays when connectivity returns.
/// </summary>
public class OfflineQueueService : IOfflineQueueService
{
    private const string PunchQueueKey = "offline_punch_queue";
    private const string IncidentQueueKey = "offline_incident_queue";
    private readonly IStorageService _storage;
    private readonly ILocationService _location;
    private readonly AppTelemetry _telemetry;
    private List<TimePunch> _punchQueue = [];
    private List<PendingIncident> _incidentQueue = [];

    public OfflineQueueService(
        IStorageService storage,
        ILocationService location,
        AppTelemetry telemetry)
    {
        _storage = storage;
        _location = location;
        _telemetry = telemetry;
        _ = LoadQueuesAsync();

        Connectivity.ConnectivityChanged += OnConnectivityChanged;
    }

    public int QueuedCount => _punchQueue.Count;
    public int QueuedIncidentCount => _incidentQueue.Count;

    public async Task EnqueuePunchAsync(TimePunch punch)
    {
        _punchQueue.Add(punch);
        await PersistPunchesAsync();
        _telemetry.LogEvent("offline_punch_enqueued", new Dictionary<string, string>
        {
            ["employee_id"] = punch.EmployeeId.ToString(),
            ["type"] = punch.TypeRaw,
            ["queue_size"] = _punchQueue.Count.ToString(),
        });
    }

    public Task<List<TimePunch>> GetQueuedPunchesAsync() => Task.FromResult(_punchQueue.ToList());

    public async Task EnqueueIncidentAsync(PendingIncident pending)
    {
        _incidentQueue.Add(pending);
        await PersistIncidentsAsync();
        _telemetry.LogEvent("offline_incident_enqueued", new Dictionary<string, string>
        {
            ["local_id"] = pending.LocalId.ToString(),
            ["job_id"] = pending.Incident.JobId?.ToString() ?? "",
            ["queue_size"] = _incidentQueue.Count.ToString(),
        });
    }

    public Task<List<PendingIncident>> GetQueuedIncidentsAsync() => Task.FromResult(_incidentQueue.ToList());

    public async Task<int> ReplayQueueAsync()
    {
        var replayed = await ReplayPunchesAsync();
        replayed += await ReplayIncidentsAsync();
        return replayed;
    }

    private async Task<int> ReplayPunchesAsync()
    {
        if (_punchQueue.Count == 0) return 0;

        var replayed = 0;
        var remaining = new List<TimePunch>();

        foreach (var punch in _punchQueue)
        {
            try
            {
                if (string.IsNullOrEmpty(punch.Address) && punch.Latitude.HasValue)
                    punch.Address = await _location.ReverseGeocodeAsync(punch.Latitude.Value, punch.Longitude!.Value);

                await _storage.InsertPunchAsync(punch);
                replayed++;
            }
            catch (Exception ex)
            {
                _telemetry.LogWarning("offline punch replay failed", nameof(ReplayPunchesAsync),
                    new Dictionary<string, string>
                    {
                        ["employee_id"] = punch.EmployeeId.ToString(),
                        ["error"] = ex.Message,
                    });
                remaining.Add(punch);
            }
        }

        if (replayed > 0)
        {
            _telemetry.LogEvent("offline_punch_replay", new Dictionary<string, string>
            {
                ["replayed"] = replayed.ToString(),
                ["remaining"] = remaining.Count.ToString(),
            });
        }

        _punchQueue = remaining;
        await PersistPunchesAsync();
        return replayed;
    }

    private async Task<int> ReplayIncidentsAsync()
    {
        if (_incidentQueue.Count == 0) return 0;

        var replayed = 0;
        var remaining = new List<PendingIncident>();

        foreach (var pending in _incidentQueue)
        {
            try
            {
                await _storage.CreateIncidentAsync(pending.Incident, pending.LocalPhotoPaths);
                replayed++;
            }
            catch (Exception ex)
            {
                _telemetry.LogWarning("offline incident replay failed", nameof(ReplayIncidentsAsync),
                    new Dictionary<string, string>
                    {
                        ["local_id"] = pending.LocalId.ToString(),
                        ["error"] = ex.Message,
                    });
                remaining.Add(pending);
            }
        }

        if (replayed > 0)
        {
            _telemetry.LogEvent("offline_incident_replay", new Dictionary<string, string>
            {
                ["replayed"] = replayed.ToString(),
                ["remaining"] = remaining.Count.ToString(),
            });
        }

        _incidentQueue = remaining;
        await PersistIncidentsAsync();
        return replayed;
    }

    public async Task ClearQueueAsync()
    {
        _punchQueue.Clear();
        _incidentQueue.Clear();
        await PersistPunchesAsync();
        await PersistIncidentsAsync();
    }

    private async void OnConnectivityChanged(object? sender, ConnectivityChangedEventArgs e)
    {
        if (e.NetworkAccess == NetworkAccess.Internet && (QueuedCount > 0 || QueuedIncidentCount > 0))
            await ReplayQueueAsync();
    }

    private async Task LoadQueuesAsync()
    {
        try
        {
            var punchJson = await SecureStorage.GetAsync(PunchQueueKey);
            if (!string.IsNullOrEmpty(punchJson))
                _punchQueue = JsonConvert.DeserializeObject<List<TimePunch>>(punchJson) ?? [];

            var incidentJson = await SecureStorage.GetAsync(IncidentQueueKey);
            if (!string.IsNullOrEmpty(incidentJson))
                _incidentQueue = JsonConvert.DeserializeObject<List<PendingIncident>>(incidentJson) ?? [];
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(LoadQueuesAsync));
            _punchQueue = [];
            _incidentQueue = [];
        }
    }

    private async Task PersistPunchesAsync()
    {
        try
        {
            await SecureStorage.SetAsync(PunchQueueKey, JsonConvert.SerializeObject(_punchQueue));
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(PersistPunchesAsync));
        }
    }

    private async Task PersistIncidentsAsync()
    {
        try
        {
            await SecureStorage.SetAsync(IncidentQueueKey, JsonConvert.SerializeObject(_incidentQueue));
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(PersistIncidentsAsync));
        }
    }
}
