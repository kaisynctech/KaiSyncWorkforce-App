using KaiFlow.Timesheets.Models;
using static Supabase.Postgrest.Constants;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Compliance Pack CRUD operations (Phase 2B.3a).
/// Default packs are seeded per-company on first call to GetCompliancePacksAsync
/// (idempotent — uses ON CONFLICT DO NOTHING on pack_code unique constraint).
/// No scoring or assignment logic here — that is Phase 2B.3c.
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Read ─────────────────────────────────────────────────────────────────

    public async Task<List<CompliancePack>> GetCompliancePacksAsync(Guid companyId)
    {
        var result = await _supabase
            .From<CompliancePack>()
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Filter("is_archived", Operator.Equals, "false")
            .Order("sort_order", Ordering.Ascending)
            .Get();

        var packs = result.Models;

        // Seed defaults on first use (idempotent).
        if (packs.Count == 0)
        {
            await SeedDefaultPacksAsync(companyId);
            var seeded = await _supabase
                .From<CompliancePack>()
                .Filter("company_id", Operator.Equals, companyId.ToString())
                .Filter("is_archived", Operator.Equals, "false")
                .Order("sort_order", Ordering.Ascending)
                .Get();
            packs = seeded.Models;
        }

        return packs;
    }

    public async Task<List<CompliancePackItem>> GetCompliancePackItemsAsync(Guid packId)
    {
        var result = await _supabase
            .From<CompliancePackItem>()
            .Filter("pack_id", Operator.Equals, packId.ToString())
            .Order("sort_order", Ordering.Ascending)
            .Get();
        return result.Models;
    }

    // ─── Save (insert or update) ──────────────────────────────────────────────

    public async Task<CompliancePack> SaveCompliancePackAsync(
        CompliancePack pack, List<CompliancePackItem> items)
    {
        // If setting as default, clear any existing default for this company first.
        if (pack.IsDefault)
            await ClearDefaultPacksAsync(pack.CompanyId, pack.Id);

        CompliancePack saved;

        if (pack.Id == Guid.Empty)
        {
            // INSERT — let DB generate UUID
            pack.CreatedAt = DateTime.UtcNow;
            pack.UpdatedAt = DateTime.UtcNow;
            var inserted = await _supabase.From<CompliancePack>().Insert(pack);
            saved = inserted.Models.First();
        }
        else
        {
            // UPDATE
            pack.UpdatedAt = DateTime.UtcNow;
            var updated = await _supabase
                .From<CompliancePack>()
                .Filter("id", Operator.Equals, pack.Id.ToString())
                .Set(p => p.Name,        pack.Name)
                .Set(p => p.Description, pack.Description ?? "")
                .Set(p => p.IsDefault,   pack.IsDefault)
                .Set(p => p.SortOrder,   pack.SortOrder)
                .Set(p => p.UpdatedAt,   pack.UpdatedAt)
                .Update();
            saved = updated.Models.First();
        }

        // Replace all items: delete existing, re-insert.
        await _supabase
            .From<CompliancePackItem>()
            .Filter("pack_id", Operator.Equals, saved.Id.ToString())
            .Delete();

        if (items.Count > 0)
        {
            foreach (var item in items)
            {
                item.Id        = Guid.Empty;   // let DB generate
                item.PackId    = saved.Id;
                item.CreatedAt = DateTime.UtcNow;
            }
            await _supabase.From<CompliancePackItem>().Insert(items);
        }

        return saved;
    }

    // ─── Delete ───────────────────────────────────────────────────────────────

    public async Task DeleteCompliancePackAsync(Guid packId)
    {
        // Items are cascade-deleted by the FK ON DELETE CASCADE.
        // Contractors assigned to this pack become NULL (ON DELETE SET NULL).
        await _supabase
            .From<CompliancePack>()
            .Filter("id", Operator.Equals, packId.ToString())
            .Delete();
    }

    // ─── Set default ──────────────────────────────────────────────────────────

    public async Task SetDefaultPackAsync(Guid companyId, Guid packId)
    {
        await ClearDefaultPacksAsync(companyId, packId);

        await _supabase
            .From<CompliancePack>()
            .Filter("id", Operator.Equals, packId.ToString())
            .Set(p => p.IsDefault,  true)
            .Set(p => p.UpdatedAt,  DateTime.UtcNow)
            .Update();
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    private async Task ClearDefaultPacksAsync(Guid companyId, Guid exceptPackId)
    {
        // Clear is_default=true on all packs for this company EXCEPT the target pack.
        // Called before setting a new default to avoid partial-unique-index violation.
        var existing = await _supabase
            .From<CompliancePack>()
            .Filter("company_id", Operator.Equals, companyId.ToString())
            .Filter("is_default",  Operator.Equals, "true")
            .Filter("is_archived", Operator.Equals, "false")
            .Get();

        foreach (var p in existing.Models.Where(p => p.Id != exceptPackId))
        {
            await _supabase
                .From<CompliancePack>()
                .Filter("id", Operator.Equals, p.Id.ToString())
                .Set(x => x.IsDefault, false)
                .Set(x => x.UpdatedAt, DateTime.UtcNow)
                .Update();
        }
    }

    // ─── Default pack seeding ─────────────────────────────────────────────────

    /// <summary>
    /// Seeds 6 SA-specific default pack templates for a company on first use.
    /// Truly idempotent: checks for existence before each INSERT rather than
    /// relying on unique-constraint violations being swallowed.
    /// Items are inserted one-at-a-time to avoid batch Guid.Empty PK collisions
    /// (all items in a batch share Id=Guid.Empty; PostgreSQL would insert only
    /// the first and reject the rest with a duplicate-PK error).
    /// Errors propagate — callers see the real failure, not a silent empty list.
    /// </summary>
    private async Task SeedDefaultPacksAsync(Guid companyId)
    {
        foreach (var template in DefaultPackTemplates)
        {
            // ── 1. Find or create the pack ──────────────────────────────────

            var existingPacks = await _supabase
                .From<CompliancePack>()
                .Filter("company_id", Operator.Equals, companyId.ToString())
                .Filter("pack_code",  Operator.Equals, template.Code)
                .Get();

            CompliancePack savedPack;

            if (existingPacks.Models.Count > 0)
            {
                // Pack row already exists (previous partial seed or user-created).
                savedPack = existingPacks.Models.First();
            }
            else
            {
                var pack = new CompliancePack
                {
                    CompanyId   = companyId,
                    Name        = template.Name,
                    PackCode    = template.Code,
                    Description = template.Description,
                    IsDefault   = template.IsDefault,
                    SortOrder   = template.SortOrder,
                    CreatedAt   = DateTime.UtcNow,
                    UpdatedAt   = DateTime.UtcNow,
                };
                var inserted = await _supabase.From<CompliancePack>().Insert(pack);
                savedPack = inserted.Models.First();
            }

            // ── 2. Insert items one-at-a-time (only if none exist yet) ──────
            // Batch Insert(List<T>) where every item has Id=Guid.Empty sends
            // the same nil UUID for all rows; PostgreSQL accepts the first and
            // rejects every subsequent one.  Single inserts avoid this entirely.

            var existingItems = await _supabase
                .From<CompliancePackItem>()
                .Filter("pack_id", Operator.Equals, savedPack.Id.ToString())
                .Get();

            if (existingItems.Models.Count == 0 && template.Items.Count > 0)
            {
                for (int i = 0; i < template.Items.Count; i++)
                {
                    var (itemType, itemReq) = template.Items[i];
                    var item = new CompliancePackItem
                    {
                        // Id intentionally NOT set — let the DB generate via DEFAULT gen_random_uuid()
                        PackId       = savedPack.Id,
                        DocumentType = itemType,
                        Requirement  = itemReq,
                        SortOrder    = i + 1,
                        CreatedAt    = DateTime.UtcNow,
                    };
                    await _supabase.From<CompliancePackItem>().Insert(item);
                }
            }
        }
    }

    // ─── Default pack definitions (SA market, 6 templates) ───────────────────

    private sealed record PackTemplate(
        string Name, string Code, string Description,
        bool IsDefault, int SortOrder,
        List<(string Type, string Req)> Items);

    private static readonly List<PackTemplate> DefaultPackTemplates =
    [
        new("General Contractor", "general",
            "Standard requirements for general service contractors.",
            true, 1,
        [
            ("company_registration",  "required"),
            ("tax_clearance",         "required"),
            ("bank_confirmation",     "required"),
            ("contractor_agreement",  "required"),
            ("id_document",           "recommended"),
            ("proof_of_address",      "recommended"),
            ("popia_agreement",       "recommended"),
        ]),

        new("Security Contractor", "security",
            "Security and guarding contractors. Includes PSIRA and fidelity requirements.",
            false, 2,
        [
            ("company_registration",       "required"),
            ("tax_clearance",              "required"),
            ("bank_confirmation",          "required"),
            ("psira_registration",         "required"),
            ("coida",                      "required"),
            ("public_liability_insurance", "required"),
            ("popia_agreement",            "required"),
            ("contractor_agreement",       "required"),
            ("id_document",                "required"),
            ("fidelity_guarantee",         "recommended"),
            ("professional_indemnity",     "recommended"),
        ]),

        new("Maintenance Contractor", "maintenance",
            "Maintenance and repair contractors. Includes H&S and liability requirements.",
            false, 3,
        [
            ("company_registration",       "required"),
            ("tax_clearance",              "required"),
            ("bank_confirmation",          "required"),
            ("public_liability_insurance", "required"),
            ("coida",                      "required"),
            ("health_safety_file",         "required"),
            ("contractor_agreement",       "required"),
            ("professional_indemnity",     "recommended"),
            ("bbee_certificate",           "recommended"),
        ]),

        new("Construction Contractor", "construction",
            "Construction and civil contractors. Full compliance pack including B-BBEE.",
            false, 4,
        [
            ("company_registration",       "required"),
            ("tax_clearance",              "required"),
            ("bank_confirmation",          "required"),
            ("public_liability_insurance", "required"),
            ("coida",                      "required"),
            ("health_safety_file",         "required"),
            ("contractor_agreement",       "required"),
            ("bbee_certificate",           "required"),
            ("site_certification",         "recommended"),
            ("professional_indemnity",     "recommended"),
        ]),

        new("Cleaning Contractor", "cleaning",
            "Cleaning and hygiene contractors.",
            false, 5,
        [
            ("company_registration",       "required"),
            ("tax_clearance",              "required"),
            ("bank_confirmation",          "required"),
            ("public_liability_insurance", "required"),
            ("coida",                      "required"),
            ("contractor_agreement",       "required"),
            ("health_safety_file",         "recommended"),
            ("popia_agreement",            "recommended"),
            ("bbee_certificate",           "recommended"),
        ]),

        new("Supplier", "supplier",
            "Product and material suppliers (non-contractor). Minimal compliance requirements.",
            false, 6,
        [
            ("company_registration", "required"),
            ("tax_clearance",        "required"),
            ("bank_confirmation",    "required"),
            ("vat_certificate",      "recommended"),
            ("bbee_certificate",     "recommended"),
        ]),
    ];
}
