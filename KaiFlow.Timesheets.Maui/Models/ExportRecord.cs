namespace KaiFlow.Timesheets.Models;

/// <summary>Local export history entry (Preferences-backed export centre).</summary>
public sealed class ExportRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string FileName { get; set; } = "";
    public string Format { get; set; } = "csv";
    public string Source { get; set; } = "";
    public DateTime ExportedAt { get; set; } = DateTime.UtcNow;
    public int RowCount { get; set; }
    public string Status { get; set; } = "completed";

    public string ExportedAtDisplay => ExportedAt.ToLocalTime().ToString("dd MMM yyyy HH:mm");
    public string FormatLabel => Format.ToUpperInvariant();
    public string StatusChipKind => Status == "completed" ? "success" : "error";
}
