using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

/// <summary>Local export centre — tracks recent exports on this device.</summary>
public interface IExportHistoryService
{
    IReadOnlyList<ExportRecord> Recent { get; }
    void Record(string fileName, string format, string source, int rowCount = 0, string status = "completed");
    Task LoadAsync();
    Task ClearAsync();
}
