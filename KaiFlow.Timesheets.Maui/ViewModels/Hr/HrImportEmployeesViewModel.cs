using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrImportEmployeesViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService  _export;
    private readonly TimesheetStateService _state;
    private readonly IFeatureAccessService _features;

    [ObservableProperty] private ObservableCollection<Employee> _preview = [];
    [ObservableProperty] private ObservableCollection<string> _parseErrors = [];
    [ObservableProperty] private ObservableCollection<string> _parseWarnings = [];
    [ObservableProperty] private int _importedCount;
    [ObservableProperty] private bool _showPreview;
    [ObservableProperty] private string _previewSummary = "";
    [ObservableProperty] private string _mappingSummary = "";
    [ObservableProperty] private string _defaultTemplateHint = "";

    private List<Employee> _toImport = [];
    private List<EmployeeShiftTemplate> _templates = [];
    private EmployeeImportContext _importContext = new();
    private string? _selectedFilePath;

    public bool HasPreview => Preview.Count > 0;
    public bool HasParseErrors => ParseErrors.Count > 0;
    public bool HasParseWarnings => ParseWarnings.Count > 0;

    partial void OnPreviewChanged(ObservableCollection<Employee> value)
        => OnPropertyChanged(nameof(HasPreview));

    partial void OnParseErrorsChanged(ObservableCollection<string> value)
        => OnPropertyChanged(nameof(HasParseErrors));

    partial void OnParseWarningsChanged(ObservableCollection<string> value)
        => OnPropertyChanged(nameof(HasParseWarnings));

    public HrImportEmployeesViewModel(IStorageService storage, IExportService export, TimesheetStateService state, IFeatureAccessService features)
    {
        _storage = storage;
        _export  = export;
        _state   = state;
        _features = features;
        Title = "Import Employees";
    }

    public async Task LoadAsync()
    {
        var companyId = _state.CurrentEmployee?.CompanyId ?? _state.CurrentCompany?.Id;
        if (companyId == null) return;

        await RunAsync(async () =>
        {
            _templates = await _storage.GetShiftTemplatesAsync(companyId.Value);
            _importContext = EmployeeImportContext.FromTemplates(_templates);
            var defaultTemplate = _importContext.DefaultTemplate;
            DefaultTemplateHint = defaultTemplate != null
                ? $"Company default time template: {defaultTemplate.Name} ({defaultTemplate.PaidHours:F1}h paid)"
                : _templates.Count > 0
                    ? "No default time template set — assign time_template per row or set a default in Time Templates."
                    : "No time templates yet — employees will import without a shift template.";
        });
    }

    [RelayCommand]
    private async Task DownloadTemplateAsync()
        => await RunAsync(() => _export.ExportEmployeeImportTemplateAsync(_templates));

    [RelayCommand]
    private async Task PickFileAsync()
    {
        try
        {
            var result = await FilePicker.PickAsync(new PickOptions
            {
                PickerTitle = "Select Employee Import File (.xlsx)",
                FileTypes   = new FilePickerFileType(new Dictionary<DevicePlatform, IEnumerable<string>>
                {
                    { DevicePlatform.WinUI,   new[] { ".xlsx" } },
                    { DevicePlatform.Android, new[] { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } },
                    { DevicePlatform.iOS,     new[] { "com.microsoft.excel.xlsx" } },
                    { DevicePlatform.MacCatalyst, new[] { "com.microsoft.excel.xlsx" } }
                })
            });

            if (result == null) return;
            _selectedFilePath = result.FullPath;

            await RunAsync(async () =>
            {
                var companyId = _state.CurrentEmployee!.CompanyId;

                if (_templates.Count == 0)
                {
                    _templates = await _storage.GetShiftTemplatesAsync(companyId);
                    _importContext = EmployeeImportContext.FromTemplates(_templates);
                }

                var existing = await _storage.GetEmployeesAsync(companyId);
                var existingIds = BuildLoginIdentifierSet(existing);

                var parsed = await _export.ParseEmployeeImportFileAsync(
                    _selectedFilePath, companyId, existingIds, _importContext);

                ParseErrors = new ObservableCollection<string>(parsed.RowErrors);
                ParseWarnings = new ObservableCollection<string>(parsed.RowWarnings);
                MappingSummary = parsed.MappingSummary ?? "";
                _toImport = parsed.Ready;
                Preview = new ObservableCollection<Employee>(_toImport);

                if (_toImport.Count > 0)
                {
                    var skipped = parsed.RowErrors.Count;
                    PreviewSummary = skipped > 0
                        ? $"{_toImport.Count} ready · {skipped} row(s) skipped"
                        : $"{_toImport.Count} employee(s) ready to import";
                    ShowPreview = true;
                }
                else
                {
                    ShowPreview = false;
                    PreviewSummary = parsed.RowErrors.Count > 0
                        ? "Fix the issues below and try again."
                        : "No employees found in file.";
                    if (parsed.RowErrors.Count == 0)
                        ErrorMessage = "No valid employee rows found.";
                }
            });
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Could not read file: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task ImportAsync()
    {
        if (_toImport.Count == 0) return;

        var confirm = await Shell.Current.DisplayAlert("Import Employees",
            $"Create {_toImport.Count} active employee record(s) in your company?",
            "Import", "Cancel");
        if (!confirm) return;

        var companyId = _state.CurrentEmployee!.CompanyId;
        await _features.RefreshAsync(companyId);
        var remaining = _features.GetRemainingEmployeeCapacity();
        if (_toImport.Count > remaining)
        {
            await Shell.Current.DisplayAlert(
                "Plan limit",
                $"This import would add {_toImport.Count} employees but only {remaining} slot(s) remain on your plan.",
                "OK");
            return;
        }

        await RunAsync(async () =>
        {
            int count = 0;
            var errors = new List<string>();

            foreach (var emp in _toImport)
            {
                try
                {
                    emp.IsActive = true;
                    emp.RegistrationStatus = "active";
                    emp.ImportTimeTemplateName = null;
                    await _storage.CreateEmployeeAsync(emp);
                    count++;
                }
                catch (Exception ex)
                {
                    errors.Add($"{emp.FullName}: {ex.Message}");
                }
            }

            ImportedCount = count;
            Preview = [];
            ParseErrors = [];
            ParseWarnings = [];
            ShowPreview = false;
            _toImport.Clear();

            var msg = count > 0
                ? $"Successfully imported {count} employee(s). They are active and ready to use."
                : "No employees were imported.";
            if (count > 0)
                await _features.RefreshAsync(companyId);
            if (errors.Count > 0)
                msg += $"\n\n{errors.Count} failed:\n" + string.Join("\n", errors.Take(8));

            await Shell.Current.DisplayAlert("Import Complete", msg, "OK");
            await ShellNavigation.GoToAsync("..");
        });
    }

    private static HashSet<string> BuildLoginIdentifierSet(IEnumerable<Employee> employees)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in employees)
        {
            if (!string.IsNullOrWhiteSpace(e.EmployeeCode))
                set.Add(e.EmployeeCode.Trim());
            if (!string.IsNullOrWhiteSpace(e.IdNumber))
                set.Add(e.IdNumber.Trim());
        }
        return set;
    }
}
