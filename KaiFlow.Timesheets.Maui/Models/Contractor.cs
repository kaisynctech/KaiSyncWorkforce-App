using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("contractors")]
public class Contractor : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("registration_number")]
    public string? RegistrationNumber { get; set; }

    [Column("contact_person")]
    public string? ContactPerson { get; set; }

    [Column("phone")]
    public string? Phone { get; set; }

    [Column("email")]
    public string? Email { get; set; }

    [Column("address")]
    public string? Address { get; set; }

    [Column("bank_account")]
    public string? BankAccount { get; set; }

    [Column("bank_name")]
    public string? BankName { get; set; }

    [Column("bank_branch_code")]
    public string? BankBranchCode { get; set; }

    [Column("rating")]
    public double Rating { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("partner_kind")]
    public string PartnerKindRaw { get; set; } = PartnerKinds.Contractor;

    [Column("contractor_code")]
    public string? ContractorCode { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore] public string PartnerKindLabel => PartnerKinds.LabelFor(PartnerKindRaw);
    [JsonIgnore] public string ContactDisplay =>
        string.Join(" · ", new[] { ContactPerson, Phone, Email }.Where(s => !string.IsNullOrWhiteSpace(s)));
    [JsonIgnore] public string StatusLabel => IsActive ? "Active" : "Inactive";
    [JsonIgnore] public string RatingDisplay => Rating > 0 ? $"★ {Rating:F1}" : "—";
    [JsonIgnore] public string ContractorCodeDisplay => string.IsNullOrWhiteSpace(ContractorCode) ? "—" : ContractorCode!;
}
