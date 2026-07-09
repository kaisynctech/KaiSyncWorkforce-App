using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// An attached document on a contractor_quote (upload mode).
/// Maps to public.contractor_quote_attachments (Phase 2D.2).
/// </summary>
[Table("contractor_quote_attachments")]
public class ContractorQuoteAttachment : BaseModel
{
    [PrimaryKey("id")]           public Guid    Id          { get; set; }
    [Column("quote_id")]         public Guid    QuoteId     { get; set; }
    [Column("company_id")]       public Guid    CompanyId   { get; set; }
    [Column("contractor_id")]    public Guid    ContractorId { get; set; }
    [Column("file_name")]        public string  FileName    { get; set; } = "";
    [Column("file_url")]         public string  FileUrl     { get; set; } = "";
    [Column("storage_path")]     public string? StoragePath { get; set; }
    [Column("file_size_bytes")]  public long?   FileSizeBytes { get; set; }
    [Column("mime_type")]        public string? MimeType    { get; set; }
    [Column("is_primary")]       public bool    IsPrimary   { get; set; } = true;
    [Column("uploaded_by")]      public string  UploadedBy  { get; set; } = "contractor_portal";
    [Column("created_at")]       public DateTime CreatedAt  { get; set; }

    [JsonIgnore] public string FileSizeDisplay =>
        FileSizeBytes.HasValue
        ? FileSizeBytes.Value switch
          {
              < 1024             => $"{FileSizeBytes}B",
              < 1024 * 1024      => $"{FileSizeBytes / 1024.0:F1}KB",
              _                  => $"{FileSizeBytes / (1024.0 * 1024):F1}MB"
          }
        : "";
}
