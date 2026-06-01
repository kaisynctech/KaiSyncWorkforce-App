using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum ClientType { Individual, Company, Property }

[Table("clients")]
public class Client : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("type")]
    public string TypeRaw { get; set; } = "individual";

    [Column("contact_person")]
    public string? ContactPerson { get; set; }

    [Column("phone")]
    public string? Phone { get; set; }

    [Column("email")]
    public string? Email { get; set; }

    [Column("address")]
    public string? Address { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("linked_company_id")]
    public Guid? LinkedCompanyId { get; set; }

    [Column("source_contractor_id")]
    public Guid? SourceContractorId { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("client_code")]
    public string? ClientCode { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public string TypeLabel => TypeRaw switch
    {
        "company" => "Company",
        "property" => "Property",
        _ => "Individual"
    };

    [JsonIgnore] public string ClientCodeDisplay => string.IsNullOrWhiteSpace(ClientCode) ? "—" : ClientCode!;

    [JsonIgnore]
    public ClientType ClientType => TypeRaw switch
    {
        "company" => ClientType.Company,
        "property" => ClientType.Property,
        _ => ClientType.Individual
    };
}
