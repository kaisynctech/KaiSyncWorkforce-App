using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// One document-type requirement within a compliance pack.
/// requirement = "required"    → counted in compliance score (missing = penalty).
/// requirement = "recommended" → advisory only, not scored.
/// Phase 2B.3a — table: contractor_compliance_pack_items.
/// </summary>
[Table("contractor_compliance_pack_items")]
public class CompliancePackItem : BaseModel
{
    [PrimaryKey("id")]          public Guid    Id           { get; set; }
    [Column("pack_id")]         public Guid    PackId       { get; set; }
    [Column("document_type")]   public string  DocumentType { get; set; } = "";
    [Column("requirement")]     public string  Requirement  { get; set; } = "required";
    [Column("notes")]           public string? Notes        { get; set; }
    [Column("sort_order")]      public int     SortOrder    { get; set; }
    [Column("created_at")]      public DateTime CreatedAt   { get; set; }

    // ── Computed helpers ──────────────────────────────────────────────────────

    [JsonIgnore] public bool IsRequired    => Requirement == "required";
    [JsonIgnore] public bool IsRecommended => Requirement == "recommended";

    /// <summary>Human-readable document type label. Mirrors ContractorDocument.TypeLabel.</summary>
    [JsonIgnore]
    public string TypeLabel => DocumentType switch
    {
        "company_registration"       => "Company Registration",
        "tax_clearance"              => "Tax Clearance (SARS TCS)",
        "vat_certificate"            => "VAT Certificate",
        "bank_confirmation"          => "Bank Confirmation Letter",
        "public_liability_insurance" => "Public Liability Insurance",
        "professional_indemnity"     => "Professional Indemnity",
        "coida"                      => "COIDA / Workmen's Comp.",
        "health_safety_file"         => "Health & Safety File",
        "contractor_agreement"       => "Contractor Agreement",
        "nda"                        => "NDA",
        "popia_agreement"            => "POPIA Agreement",
        "bbee_certificate"           => "B-BBEE Certificate",
        "proof_of_address"           => "Proof of Address",
        "id_document"                => "ID / Passport",
        "site_certification"         => "Site Certification",
        // Phase 2B.3a additions
        "psira_registration"         => "PSIRA Registration",
        "fidelity_guarantee"         => "Fidelity Guarantee",
        "liquor_license"             => "Liquor Licence",
        "food_safety_cert"           => "Food Safety Certificate",
        "other"                      => "Other",
        _                            => DocumentType
    };

    [JsonIgnore]
    public string RequirementLabel => Requirement switch
    {
        "required"    => "Required",
        "recommended" => "Recommended",
        _             => "—"
    };

    [JsonIgnore]
    public string RequirementBg => Requirement switch
    {
        "required"    => "#7F1D1D",
        "recommended" => "#78350F",
        _             => "#1E293B"
    };

    [JsonIgnore]
    public string RequirementFg => Requirement switch
    {
        "required"    => "#FCA5A5",
        "recommended" => "#FCD34D",
        _             => "#64748B"
    };
}
