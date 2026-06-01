namespace KaiFlow.Timesheets.Models;

public class ContractorPortalLogin
{
    public Guid ContractorId { get; set; }
    public Guid CompanyId { get; set; }
    public string CompanyCode { get; set; } = "";
    public string ContractorCode { get; set; } = "";
    public string ContractorName { get; set; } = "";
}
