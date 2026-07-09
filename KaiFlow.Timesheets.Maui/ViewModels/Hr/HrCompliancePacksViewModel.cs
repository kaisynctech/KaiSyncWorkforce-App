using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

/// <summary>
/// Manages the Compliance Packs settings page.
/// Phase 2B.3a: view/create/edit/delete packs and their document-type requirements.
/// Phase 2B.3c will add assignment to contractors and scoring changes.
/// </summary>
public partial class HrCompliancePacksViewModel : BaseViewModel
{
    private readonly IStorageService     _storage;
    private readonly TimesheetStateService _state;

    // ── Pack list ─────────────────────────────────────────────────────────────

    [ObservableProperty]
    private ObservableCollection<CompliancePack> _packs = [];

    // ── Edit form state ───────────────────────────────────────────────────────

    [ObservableProperty] private bool   _isEditing;
    [ObservableProperty] private bool   _isCreating;    // true = new pack, false = editing existing

    // Form fields
    [ObservableProperty] private string _editName        = "";
    [ObservableProperty] private string _editDescription = "";
    [ObservableProperty] private bool   _editIsDefault;

    // Document-type checklist rows (all 20 types, each with Required/Recommended/Exclude state)
    [ObservableProperty]
    private ObservableCollection<PackItemEditRow> _editRows = [];

    // The pack currently being edited (null when creating)
    private CompliancePack? _editingPack;

    // ── All document types (order determines checklist display) ───────────────

    private static readonly (string Type, string Label)[] AllDocTypes =
    [
        ("company_registration",       "Company Registration"),
        ("tax_clearance",              "Tax Clearance (SARS TCS)"),
        ("vat_certificate",            "VAT Certificate"),
        ("bank_confirmation",          "Bank Confirmation Letter"),
        ("public_liability_insurance", "Public Liability Insurance"),
        ("professional_indemnity",     "Professional Indemnity"),
        ("coida",                      "COIDA / Workmen's Comp."),
        ("health_safety_file",         "Health & Safety File"),
        ("contractor_agreement",       "Contractor Agreement"),
        ("nda",                        "NDA"),
        ("popia_agreement",            "POPIA Agreement"),
        ("bbee_certificate",           "B-BBEE Certificate"),
        ("proof_of_address",           "Proof of Address"),
        ("id_document",                "ID / Passport"),
        ("site_certification",         "Site Certification"),
        // Phase 2B.3a additions
        ("psira_registration",         "PSIRA Registration"),
        ("fidelity_guarantee",         "Fidelity Guarantee"),
        ("liquor_license",             "Liquor Licence"),
        ("food_safety_cert",           "Food Safety Certificate"),
        ("other",                      "Other"),
    ];

    public HrCompliancePacksViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state   = state;
        Title    = "Compliance Packs";
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var packs     = await _storage.GetCompliancePacksAsync(companyId);

            // Load items for each pack (needed for RequiredCount/RecommendedCount display)
            foreach (var pack in packs)
                pack.Items = await _storage.GetCompliancePackItemsAsync(pack.Id);

            Packs = new ObservableCollection<CompliancePack>(packs);
        });
    }

    // ── Create ────────────────────────────────────────────────────────────────

    [RelayCommand]
    private void StartCreate()
    {
        _editingPack     = null;
        EditName         = "";
        EditDescription  = "";
        EditIsDefault    = false;
        EditRows         = BuildEditRows([]);
        IsCreating       = true;
        IsEditing        = true;
    }

    // ── Edit ──────────────────────────────────────────────────────────────────

    [RelayCommand]
    private void EditPack(CompliancePack pack)
    {
        _editingPack     = pack;
        EditName         = pack.Name;
        EditDescription  = pack.Description ?? "";
        EditIsDefault    = pack.IsDefault;
        EditRows         = BuildEditRows(pack.Items);
        IsCreating       = false;
        IsEditing        = true;
    }

    [RelayCommand]
    private void CancelEdit()
    {
        IsEditing    = false;
        _editingPack = null;
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (string.IsNullOrWhiteSpace(EditName))
        {
            await Shell.Current.DisplayAlert("Required", "Pack name is required.", "OK");
            return;
        }

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;

            // Build or reuse the pack object
            var pack = _editingPack ?? new CompliancePack { CompanyId = companyId };
            pack.Name        = EditName.Trim();
            pack.Description = string.IsNullOrWhiteSpace(EditDescription)
                               ? null
                               : EditDescription.Trim();
            pack.IsDefault   = EditIsDefault;

            // Auto-generate pack_code for new packs only
            if (pack.Id == Guid.Empty || string.IsNullOrWhiteSpace(pack.PackCode))
                pack.PackCode = GeneratePackCode(pack.Name);

            // Build items from the checklist (only include Required/Recommended rows)
            var items = EditRows
                .Where(r => r.Requirement != "none")
                .Select((r, i) => new CompliancePackItem
                {
                    DocumentType = r.DocumentType,
                    Requirement  = r.Requirement,
                    SortOrder    = i + 1,
                    CreatedAt    = DateTime.UtcNow,
                })
                .ToList();

            await _storage.SaveCompliancePackAsync(pack, items);

            // Reload list
            await ReloadPacksAsync(companyId);

            IsEditing    = false;
            _editingPack = null;
        });
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    [RelayCommand]
    private async Task DeletePackAsync(CompliancePack pack)
    {
        var confirmed = await Shell.Current.DisplayAlert(
            "Delete Compliance Pack",
            $"Delete '{pack.Name}'? Contractors assigned to this pack will become unassigned. This cannot be undone.",
            "Delete", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _storage.DeleteCompliancePackAsync(pack.Id);

            // If currently editing this pack, cancel the form
            if (_editingPack?.Id == pack.Id)
            {
                IsEditing    = false;
                _editingPack = null;
            }

            await ReloadPacksAsync(companyId);
        });
    }

    // ── Set default ───────────────────────────────────────────────────────────

    [RelayCommand]
    private async Task SetDefaultAsync(CompliancePack pack)
    {
        if (pack.IsDefault) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _storage.SetDefaultPackAsync(companyId, pack.Id);
            await ReloadPacksAsync(companyId);
        });
    }

    // ── Retry / back navigation ───────────────────────────────────────────────

    /// <summary>
    /// Re-runs LoadAsync. Used by the error banner Retry button.
    /// RunAsync clears ErrorMessage at the start of every invocation, so
    /// a successful retry will automatically hide the error banner.
    /// </summary>
    [RelayCommand]
    private async Task RetryLoadAsync() => await LoadAsync();

    [RelayCommand]
    private static async Task GoBackAsync() =>
        await Shell.Current.GoToAsync("..");

    // ── Private helpers ───────────────────────────────────────────────────────

    /// <summary>Builds the 20-row edit checklist, pre-populated from existing pack items.</summary>
    private static ObservableCollection<PackItemEditRow> BuildEditRows(List<CompliancePackItem> existing)
    {
        var existingMap = existing.ToDictionary(i => i.DocumentType, i => i.Requirement);
        return new ObservableCollection<PackItemEditRow>(
            AllDocTypes.Select(dt =>
                new PackItemEditRow(dt.Type, dt.Label,
                    existingMap.GetValueOrDefault(dt.Type, "none"))));
    }

    /// <summary>Reloads Packs + their items from the database.</summary>
    private async Task ReloadPacksAsync(Guid companyId)
    {
        var packs = await _storage.GetCompliancePacksAsync(companyId);
        foreach (var p in packs)
            p.Items = await _storage.GetCompliancePackItemsAsync(p.Id);
        Packs = new ObservableCollection<CompliancePack>(packs);
    }

    /// <summary>
    /// Converts a pack name to a slug for pack_code.
    /// "Security Contractor" → "security_contractor"
    /// Appended with unix-second suffix if pack is new to avoid collision.
    /// </summary>
    private static string GeneratePackCode(string name)
    {
        var slug = System.Text.RegularExpressions.Regex
            .Replace(name.ToLowerInvariant().Replace(" ", "_"), @"[^a-z0-9_]", "")
            .Trim('_');
        return string.IsNullOrWhiteSpace(slug) ? $"pack_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}" : slug;
    }
}
