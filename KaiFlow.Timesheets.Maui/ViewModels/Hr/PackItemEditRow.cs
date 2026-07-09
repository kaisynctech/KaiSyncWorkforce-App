using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace KaiFlow.Timesheets.ViewModels.Hr;

/// <summary>
/// One row in the compliance-pack editor checklist.
/// Represents a single document type with a 3-way toggle:
///   "required" | "recommended" | "none" (excluded).
///
/// Carries its own RelayCommand so Buttons in the CollectionView DataTemplate
/// can bind directly — avoids the need for VM-level CommandParameter routing.
/// Button.Command is the WinUI-reliable tap path (not TapGestureRecognizer).
/// </summary>
public partial class PackItemEditRow : ObservableObject
{
    public string DocumentType { get; }
    public string TypeLabel    { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(RequiredBg),    nameof(RequiredFg))]
    [NotifyPropertyChangedFor(nameof(RecommendedBg), nameof(RecommendedFg))]
    [NotifyPropertyChangedFor(nameof(NoneBg),        nameof(NoneFg))]
    private string _requirement = "none";

    public PackItemEditRow(string documentType, string typeLabel, string requirement = "none")
    {
        DocumentType = documentType;
        TypeLabel    = typeLabel;
        _requirement = requirement;
    }

    // ── Toggle command (called directly by the three Buttons in the row) ──────

    [RelayCommand]
    private void SetRequirement(string req) => Requirement = req;

    // ── Visual state colours ─────────────────────────────────────────────────
    // Button backgrounds and text colours reflect the active selection.

    public string RequiredBg    => Requirement == "required"    ? "#7F1D1D" : "#1E293B";
    public string RequiredFg    => Requirement == "required"    ? "#FCA5A5" : "#475569";

    public string RecommendedBg => Requirement == "recommended" ? "#78350F" : "#1E293B";
    public string RecommendedFg => Requirement == "recommended" ? "#FCD34D" : "#475569";

    public string NoneBg        => Requirement == "none"        ? "#0F172A" : "#1E293B";
    public string NoneFg        => Requirement == "none"        ? "#94A3B8" : "#475569";
}
