using System.Text.Json;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public sealed class ExportHistoryService : IExportHistoryService
{
    private const string PrefKey = "kaiflow_export_history_v1";
    private const int MaxEntries = 50;

    private readonly List<ExportRecord> _entries = [];

    public IReadOnlyList<ExportRecord> Recent => _entries;

    public async Task LoadAsync()
    {
        await Task.CompletedTask;
        _entries.Clear();
        var json = Preferences.Default.Get(PrefKey, "");
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            var loaded = JsonSerializer.Deserialize<List<ExportRecord>>(json);
            if (loaded is not null)
                _entries.AddRange(loaded.OrderByDescending(e => e.ExportedAt).Take(MaxEntries));
        }
        catch { /* corrupt prefs — start fresh */ }
    }

    public void Record(string fileName, string format, string source, int rowCount = 0, string status = "completed")
    {
        _entries.Insert(0, new ExportRecord
        {
            FileName = fileName,
            Format = format,
            Source = source,
            ExportedAt = DateTime.UtcNow,
            RowCount = rowCount,
            Status = status,
        });
        while (_entries.Count > MaxEntries)
            _entries.RemoveAt(_entries.Count - 1);
        Persist();
    }

    public Task ClearAsync()
    {
        _entries.Clear();
        Preferences.Default.Remove(PrefKey);
        return Task.CompletedTask;
    }

    private void Persist()
    {
        Preferences.Default.Set(PrefKey, JsonSerializer.Serialize(_entries));
    }
}
