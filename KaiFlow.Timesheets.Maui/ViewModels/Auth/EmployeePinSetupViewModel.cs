using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;

namespace KaiFlow.Timesheets.ViewModels.Auth;

/// <summary>
/// Handles first-time 4-digit PIN creation for field employees.
///
/// Flow:
///   Step 1 (EnterPin)   — employee taps 4 digits on the numpad.
///   Step 2 (ConfirmPin) — employee re-enters the same 4 digits to confirm.
///   On match            — calls SetEmployeePinAsync, then navigates to the employee dashboard.
///
/// The raw PIN is held in memory only long enough to complete the RPC call;
/// it is never written to disk or SecureStorage.
/// </summary>
[QueryProperty(nameof(SessionToken), "sessionToken")]
public partial class EmployeePinSetupViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    // ── State ───────────────────────────────────────────────────────────────

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsConfirmStep))]
    [NotifyPropertyChangedFor(nameof(StepHeading))]
    [NotifyPropertyChangedFor(nameof(StepSubtext))]
    private string _sessionToken = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Dot1Filled))]
    [NotifyPropertyChangedFor(nameof(Dot2Filled))]
    [NotifyPropertyChangedFor(nameof(Dot3Filled))]
    [NotifyPropertyChangedFor(nameof(Dot4Filled))]
    private string _currentPin = string.Empty;

    /// <summary>Which of the two entry steps the user is currently on.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsConfirmStep))]
    [NotifyPropertyChangedFor(nameof(StepHeading))]
    [NotifyPropertyChangedFor(nameof(StepSubtext))]
    private PinSetupStep _currentStep = PinSetupStep.EnterPin;

    // ── Derived display properties ──────────────────────────────────────────

    public bool IsConfirmStep => CurrentStep == PinSetupStep.ConfirmPin;

    public string StepHeading => CurrentStep == PinSetupStep.EnterPin
        ? "Create Your PIN"
        : "Confirm Your PIN";

    public string StepSubtext => CurrentStep == PinSetupStep.EnterPin
        ? "Choose a 4-digit PIN. You will use this each time you sign in."
        : "Enter the same PIN again to confirm.";

    // Individual dot properties — explicit booleans avoid array-indexer issues
    // in MAUI compiled bindings.
    public bool Dot1Filled => CurrentPin.Length > 0;
    public bool Dot2Filled => CurrentPin.Length > 1;
    public bool Dot3Filled => CurrentPin.Length > 2;
    public bool Dot4Filled => CurrentPin.Length > 3;

    // The confirmed first-step PIN is held only in memory.
    private string _firstPin = string.Empty;

    public EmployeePinSetupViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state   = state;
        Title    = "Create PIN";
    }

    // ── Numpad commands ─────────────────────────────────────────────────────

    /// <summary>
    /// Async so AsyncRelayCommand prevents re-entry during the server call.
    /// 4th digit auto-advances step or auto-submits. Dots stay filled while IsBusy.
    /// </summary>
    [RelayCommand]
    private async Task AppendDigitAsync(string digit)
    {
        if (CurrentPin.Length >= 4 || IsBusy) return;
        CurrentPin += digit;

        if (CurrentPin.Length == 4)
            await OnPinCompleteAsync();
    }

    [RelayCommand]
    private void Backspace()
    {
        if (CurrentPin.Length == 0 || IsBusy) return;
        CurrentPin   = CurrentPin[..^1];
        ErrorMessage = null;
    }

    // ── Step logic ──────────────────────────────────────────────────────────

    private async Task OnPinCompleteAsync()
    {
        if (CurrentStep == PinSetupStep.EnterPin)
        {
            _firstPin   = CurrentPin;
            CurrentPin  = string.Empty;
            CurrentStep = PinSetupStep.ConfirmPin;
            return;
        }

        // Confirm step complete — await submission (was fire-and-forget; caused 4th dot vanish)
        await SubmitPinAsync();
    }

    private async Task SubmitPinAsync()
    {
        if (CurrentPin != _firstPin)
        {
            ErrorMessage = "PINs do not match. Let's try again from the start.";
            CurrentPin  = string.Empty;
            _firstPin   = string.Empty;
            CurrentStep = PinSetupStep.EnterPin;
            return;
        }

        var pin = CurrentPin;
        // CurrentPin NOT cleared here — dots stay filled while IsBusy = true.
        // Cleared on failure only (success navigates away immediately).
        _firstPin = string.Empty;

        await RunAsync(async () =>
        {
            if (string.IsNullOrWhiteSpace(SessionToken))
            {
                CurrentPin   = string.Empty;
                CurrentStep  = PinSetupStep.EnterPin;
                ErrorMessage = "Session expired. Please sign in again with your ID number.";
                await ShellNavigation.GoToAsync($"//{nameof(EmployeeLoginPage)}");
                return;
            }

            var result = await _storage.SetEmployeePinAsync(SessionToken, pin);

            if (result == null)
            {
                CurrentPin   = string.Empty;
                CurrentStep  = PinSetupStep.EnterPin;
                ErrorMessage = "Failed to save PIN. Please try again.";
                return;
            }

            _state.SetEmployee(result.Employee);
            _state.SetCompany(result.Company);
            await EmployeeAccountRouting.RouteAfterCompanySelectedAsync(result.Employee);
        });
    }
}

public enum PinSetupStep { EnterPin, ConfirmPin }
