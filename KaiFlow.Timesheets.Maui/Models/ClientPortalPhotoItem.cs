namespace KaiFlow.Timesheets.Models;

/// <summary>Before/after photo shown on the client portal (from a job on this project).</summary>
public class ClientPortalPhotoItem
{
    public string JobTitle { get; set; } = "";
    public string Phase { get; set; } = "before";
    public string Url { get; set; } = "";

    public string PhaseLabel => Phase.Equals("after", StringComparison.OrdinalIgnoreCase) ? "After" : "Before";
}
