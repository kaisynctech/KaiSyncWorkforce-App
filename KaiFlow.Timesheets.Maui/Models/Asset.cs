using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum AssetStatus { Active, Retired, OutOfService }

[Table("assets")]
public class Asset : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("site_id")]
    public Guid? SiteId { get; set; }

    [Column("unit_id")]
    public Guid? UnitId { get; set; }

    [Column("asset_type")]
    public string AssetType { get; set; } = "";

    [Column("label")]
    public string? Label { get; set; }

    [Column("manufacturer")]
    public string? Manufacturer { get; set; }

    [Column("model_number")]
    public string? ModelNumber { get; set; }

    [Column("serial_number")]
    public string? SerialNumber { get; set; }

    [Column("install_date")]
    public DateOnly? InstallDate { get; set; }

    [Column("warranty_expires")]
    public DateOnly? WarrantyExpires { get; set; }

    [Column("status")]
    public string StatusRaw { get; set; } = "active";

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("photo_urls")]
    public List<string> PhotoUrls { get; set; } = [];

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore]
    public AssetStatus AssetStatus => StatusRaw switch
    {
        "retired" => AssetStatus.Retired,
        "out_of_service" or "outOfService" => AssetStatus.OutOfService,
        _ => AssetStatus.Active
    };

    [JsonIgnore] public bool IsWarrantyActive => WarrantyExpires.HasValue &&
        WarrantyExpires.Value >= DateOnly.FromDateTime(DateTime.Today);

    [JsonIgnore] public string DisplayName => Label ?? $"{AssetType} ({SerialNumber ?? "no serial"})";
}
