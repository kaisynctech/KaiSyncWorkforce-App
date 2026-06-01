namespace KaiFlow.Timesheets.Models;

public class ClientPortalLogin
{
    public Guid ClientId { get; set; }
    public Guid CompanyId { get; set; }
    public string CompanyCode { get; set; } = "";
    public string ClientCode { get; set; } = "";
    public string ClientName { get; set; } = "";
    public string? Email { get; set; }
}
