namespace KaiFlow.Timesheets.Services;

public sealed class ExportQueueItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string FileName { get; set; } = "";
    public string Format { get; set; } = "csv";
    public string Source { get; set; } = "";
    public string Status { get; set; } = "queued";
    public int ProgressPercent { get; set; }
    public string? Error { get; set; }
    public DateTime QueuedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}

public interface IExportQueueService
{
    IReadOnlyList<ExportQueueItem> Items { get; }
    void Enqueue(string fileName, string format, string source);
    void MarkCompleted(Guid id);
    void MarkFailed(Guid id, string error);
    void MarkInProgress(Guid id);
    Task LoadAsync();
}

/// <summary>Device-local export queue — scheduled/server export ready architecture.</summary>
public sealed class ExportQueueService : IExportQueueService
{
    private const string PrefKey = "kaiflow_export_queue_v1";
    private const int MaxItems = 30;
    private readonly List<ExportQueueItem> _items = [];

    public IReadOnlyList<ExportQueueItem> Items => _items;

    public async Task LoadAsync()
    {
        await Task.CompletedTask;
        _items.Clear();
        var json = Preferences.Default.Get(PrefKey, "");
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            var loaded = System.Text.Json.JsonSerializer.Deserialize<List<ExportQueueItem>>(json);
            if (loaded is not null)
                _items.AddRange(loaded.OrderByDescending(i => i.QueuedAt).Take(MaxItems));
        }
        catch { }
    }

    public void Enqueue(string fileName, string format, string source)
    {
        _items.Insert(0, new ExportQueueItem
        {
            FileName = fileName,
            Format = format,
            Source = source,
            Status = "queued",
        });
        Trim();
        Persist();
    }

    public void MarkInProgress(Guid id) => Update(id, i => { i.Status = "processing"; i.ProgressPercent = 10; });
    public void MarkCompleted(Guid id) => Update(id, i => { i.Status = "completed"; i.ProgressPercent = 100; i.CompletedAt = DateTime.UtcNow; });
    public void MarkFailed(Guid id, string error) => Update(id, i => { i.Status = "failed"; i.Error = error; i.CompletedAt = DateTime.UtcNow; });

    private void Update(Guid id, Action<ExportQueueItem> mutate)
    {
        var item = _items.FirstOrDefault(i => i.Id == id);
        if (item is null) return;
        mutate(item);
        Persist();
    }

    private void Trim()
    {
        while (_items.Count > MaxItems)
            _items.RemoveAt(_items.Count - 1);
    }

    private void Persist() =>
        Preferences.Default.Set(PrefKey, System.Text.Json.JsonSerializer.Serialize(_items));
}
