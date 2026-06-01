using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("inventory_usage")]
public class InventoryUsage : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("inventory_item_id")]
    public Guid InventoryItemId { get; set; }

    [Column("job_id")]
    public Guid? JobId { get; set; }

    [Column("employee_id")]
    public Guid? EmployeeId { get; set; }

    [Column("quantity_used")]
    public double QuantityUsed { get; set; }

    [Column("unit_cost_at_use")]
    public double UnitCostAtUse { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("used_at")]
    public DateTime UsedAt { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    public double TotalCost => QuantityUsed * UnitCostAtUse;
}
