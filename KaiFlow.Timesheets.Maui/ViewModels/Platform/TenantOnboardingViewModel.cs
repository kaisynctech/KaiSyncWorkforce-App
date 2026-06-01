using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Platform;

public partial class TenantOnboardingViewModel : BaseViewModel
{
    private readonly IOnboardingService _onboarding;
    private readonly TimesheetStateService _state;
    private readonly AppTelemetry _telemetry;

    [ObservableProperty] private int _currentStepIndex;
    [ObservableProperty] private double _completionPercent;
    public double CompletionProgress => CompletionPercent / 100.0;
    partial void OnCompletionPercentChanged(double value) => OnPropertyChanged(nameof(CompletionProgress));
    [ObservableProperty] private ObservableCollection<OnboardingStepDisplay> _steps = [];

    public string CurrentStepTitle => CurrentStepIndex < Steps.Count ? Steps[CurrentStepIndex].Title : "";
    public bool CanGoBack => CurrentStepIndex > 0;
    public bool IsLastStep => CurrentStepIndex >= Steps.Count - 1;

    public TenantOnboardingViewModel(
        IOnboardingService onboarding,
        TimesheetStateService state,
        AppTelemetry telemetry)
    {
        _onboarding = onboarding;
        _state = state;
        _telemetry = telemetry;
        Title = "Setup Wizard";
    }

    public async Task LoadAsync()
    {
        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (companyId is null) return;

        var progress = await _onboarding.GetProgressAsync(companyId.Value);
        var completed = progress.Where(p => p.IsCompleted).Select(p => p.StepKey).ToHashSet();

        Steps = new ObservableCollection<OnboardingStepDisplay>(
            SaasFeatureCodes.OnboardingSteps.Select((key, i) => new OnboardingStepDisplay
            {
                Key = key,
                Title = FormatStepTitle(key),
                Index = i,
                IsCompleted = completed.Contains(key),
            }));

        CurrentStepIndex = Steps.FirstOrDefault(s => !s.IsCompleted)?.Index ?? 0;
        CompletionPercent = await _onboarding.GetCompletionPercentAsync(companyId.Value);
    }

    [RelayCommand]
    private async Task CompleteCurrentStepAsync()
    {
        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (companyId is null || CurrentStepIndex >= Steps.Count) return;

        var step = Steps[CurrentStepIndex];
        await _onboarding.MarkStepCompleteAsync(companyId.Value, step.Key);
        step.IsCompleted = true;
        CompletionPercent = await _onboarding.GetCompletionPercentAsync(companyId.Value);
        _telemetry.LogEvent("onboarding_step_complete", new() { ["step"] = step.Key });

        if (IsLastStep)
        {
            await ShellNavigation.GoToAsync("//HrDashboard");
            return;
        }
        CurrentStepIndex++;
    }

    [RelayCommand]
    private void GoBack()
    {
        if (!CanGoBack) return;
        CurrentStepIndex--;
    }

    [RelayCommand]
    private async Task SkipAsync() => await ShellNavigation.GoToAsync("//HrDashboard");

    private static string FormatStepTitle(string key) => key switch
    {
        "company_profile" => "Company profile",
        "logo" => "Upload logo",
        "departments" => "Departments",
        "branches" => "Branches & sites",
        "payroll_settings" => "Payroll settings",
        "vat_settings" => "VAT settings",
        "shift_templates" => "Shift templates",
        "leave_policies" => "Leave policies",
        "permissions_template" => "Permissions template",
        "employee_import" => "Import employees",
        _ => key,
    };
}

public class OnboardingStepDisplay
{
    public string Key { get; set; } = "";
    public string Title { get; set; } = "";
    public int Index { get; set; }
    public bool IsCompleted { get; set; }
}
