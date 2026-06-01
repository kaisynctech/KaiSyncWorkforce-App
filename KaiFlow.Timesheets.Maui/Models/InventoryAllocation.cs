using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("inventory_allocations")]
public class InventoryAllocation : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("inventory_item_id")]
    public Guid InventoryItemId { get; set; }

    [Column("job_id")]
    public Guid? JobId { get; set; }

    [Column("asset_id")]
    public Guid? AssetId { get; set; }

    [Column("quantity_allocated")]
    public double QuantityAllocated { get; set; }

    [Column("unit_cost_at_allocation")]
    public double UnitCostAtAllocation { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("allocated_at")]
    public DateTime AllocatedAt { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    public double TotalAllocatedCost => QuantityAllocated * UnitCostAtAllocation;
}
