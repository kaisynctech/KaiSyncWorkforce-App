using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("project_quotation_lines")]
public class ProjectQuotationLine : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("deal_id")]
    public Guid DealId { get; set; }

    [Column("line_no")]
    public int LineNo { get; set; }

    [Column("description")]
    public string Description { get; set; } = "";

    [Column("quantity")]
    public double Quantity { get; set; } = 1;

    [Column("unit_price")]
    public double UnitPrice { get; set; }

    [JsonIgnore] public double LineTotal => Quantity * UnitPrice;
    [JsonIgnore] public string LineTotalDisplay => $"R{LineTotal:N2}";
}
