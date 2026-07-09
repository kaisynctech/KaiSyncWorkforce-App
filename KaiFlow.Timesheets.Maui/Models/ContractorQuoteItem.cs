using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// One line item on a contractor_quote (manual/line-item mode only).
/// Maps to public.contractor_quote_items (Phase 2D.2).
/// </summary>
[Table("contractor_quote_items")]
public class ContractorQuoteItem : BaseModel
{
    [PrimaryKey("id")]           public Guid    Id             { get; set; }
    [Column("quote_id")]         public Guid    QuoteId        { get; set; }
    [Column("company_id")]       public Guid    CompanyId      { get; set; }
    [Column("line_no")]          public int     LineNo         { get; set; }
    [Column("description")]      public string  Description    { get; set; } = "";
    [Column("quantity")]         public decimal Quantity       { get; set; } = 1;
    [Column("unit_price")]       public decimal UnitPrice      { get; set; }
    [Column("discount_amount")]  public decimal DiscountAmount { get; set; }
    [Column("subtotal")]         public decimal Subtotal       { get; set; }
    [Column("vat_rate")]         public decimal VatRate        { get; set; } = 0.15m;
    [Column("vat_amount")]       public decimal VatAmount      { get; set; }
    [Column("line_total")]       public decimal LineTotal      { get; set; }
    [Column("is_vat_inclusive")] public bool    IsVatInclusive { get; set; }
    [Column("sort_order")]       public int     SortOrder      { get; set; }
    [Column("created_at")]       public DateTime CreatedAt     { get; set; }

    [JsonIgnore] public string LineTotalDisplay => $"R{LineTotal:N2}";
    [JsonIgnore] public string UnitPriceDisplay => $"R{UnitPrice:N2}";
}
