namespace KaiFlow.Timesheets.Models;

/// <summary>Offline incident payload queued until connectivity returns.</summary>
public class PendingIncident
{
    public Guid LocalId { get; set; } = Guid.NewGuid();
    public IncidentReport Incident { get; set; } = new();
    public List<string> LocalPhotoPaths { get; set; } = [];
    public DateTime QueuedAt { get; set; } = DateTime.UtcNow;
}
