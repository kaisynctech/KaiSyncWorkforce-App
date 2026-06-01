using System.Text.Json;
using KaiFlow.Timesheets.Models.Reporting;

namespace KaiFlow.Timesheets.Services.Reporting;

public interface IReportFilterService
{
    ReportFilterCriteria Current { get; }
    IReadOnlyList<ReportFilterPreset> Presets { get; }
    IReadOnlyList<ReportFilterPreset> SavedPresets { get; }
    void ApplyPreset(ReportFilterPreset preset);
    void UpdateCriteria(Action<ReportFilterCriteria> mutate);
    Task SaveCurrentAsPresetAsync(string name);
    Task DeleteSavedPresetAsync(string id);
    Task LoadAsync();
    event EventHandler? FilterChanged;
}

public sealed class ReportFilterService : IReportFilterService
{
    private const string PrefKey = "kaiflow_report_filter_presets_v1";
    private readonly List<ReportFilterPreset> _saved = [];
    private ReportFilterCriteria _current = ReportFilterPresets.BuiltIn[1].Criteria.Clone();

    public ReportFilterCriteria Current => _current;
    public IReadOnlyList<ReportFilterPreset> Presets => ReportFilterPresets.BuiltIn;
    public IReadOnlyList<ReportFilterPreset> SavedPresets => _saved;
    public event EventHandler? FilterChanged;

    public async Task LoadAsync()
    {
        await Task.CompletedTask;
        _saved.Clear();
        var json = Preferences.Default.Get(PrefKey, "");
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            var loaded = JsonSerializer.Deserialize<List<ReportFilterPreset>>(json);
            if (loaded is not null)
                _saved.AddRange(loaded);
        }
        catch { /* corrupt prefs */ }
    }

    public void ApplyPreset(ReportFilterPreset preset)
    {
        _current = preset.Criteria.Clone();
        FilterChanged?.Invoke(this, EventArgs.Empty);
    }

    public void UpdateCriteria(Action<ReportFilterCriteria> mutate)
    {
        mutate(_current);
        FilterChanged?.Invoke(this, EventArgs.Empty);
    }

    public Task SaveCurrentAsPresetAsync(string name)
    {
        _saved.Insert(0, new ReportFilterPreset
        {
            Name = name,
            Criteria = _current.Clone(),
        });
        Persist();
        return Task.CompletedTask;
    }

    public Task DeleteSavedPresetAsync(string id)
    {
        _saved.RemoveAll(p => p.Id == id);
        Persist();
        return Task.CompletedTask;
    }

    private void Persist() =>
        Preferences.Default.Set(PrefKey, JsonSerializer.Serialize(_saved));
}
