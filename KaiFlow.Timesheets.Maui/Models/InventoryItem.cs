using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("inventory_items")]
public class InventoryItem : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("sku")]
    public string? Sku { get; set; }

    [Column("description")]
    public string? Description { get; set; }

    [Column("unit_of_measure")]
    public string UnitOfMeasure { get; set; } = "each";

    [Column("unit_cost")]
    public double UnitCost { get; set; }

    [Column("selling_price")]
    public double SellingPrice { get; set; }

    [Column("quantity_on_hand")]
    public double QuantityOnHand { get; set; }

    [Column("reorder_level")]
    public double ReorderLevel { get; set; }

    [Column("supplier")]
    public string? Supplier { get; set; }

    [Column("supplier_contractor_id")]
    public Guid? SupplierContractorId { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public bool NeedsReorder => QuantityOnHand <= ReorderLevel;
    public double StockValue => QuantityOnHand * UnitCost;
    [JsonIgnore] public string UnitCostDisplay => $"R{UnitCost:N2}";
    [JsonIgnore] public string StockValueDisplay => $"R{StockValue:N2}";
    [JsonIgnore] public string SupplierDisplay => string.IsNullOrWhiteSpace(Supplier) ? "—" : Supplier!;
    [JsonIgnore] public string QtyDisplay => $"{QuantityOnHand:N1} {UnitOfMeasure}";
}
