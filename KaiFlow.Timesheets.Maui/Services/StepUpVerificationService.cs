using KaiFlow.Timesheets.Services;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Wraps calls to step-up-guarded RPCs. When STEP_UP_REQUIRED is raised,
/// prompts the HR user to re-enter their password. On success, records a
/// 15-minute step-up window in the DB and retries the original call.
/// </summary>
public class StepUpVerificationService
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    private DateTimeOffset _stepUpValidUntil = DateTimeOffset.MinValue;

    public StepUpVerificationService(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state   = state;
    }

    /// <summary>
    /// Executes <paramref name="sensitiveCall"/>, transparently handling STEP_UP_REQUIRED
    /// by prompting the user for their password before retrying once.
    /// </summary>
    public async Task ExecuteAsync(Func<Task> sensitiveCall)
    {
        try
        {
            await sensitiveCall();
        }
        catch (Exception ex) when (ex.Message.Contains("STEP_UP_REQUIRED"))
        {
            await PromptAndVerifyAsync();
            // Retry after successful step-up
            await sensitiveCall();
        }
    }

    /// <summary>
    /// Executes <paramref name="sensitiveCall"/> returning a value, transparently
    /// handling STEP_UP_REQUIRED by prompting the user before retrying once.
    /// </summary>
    public async Task<T> ExecuteAsync<T>(Func<Task<T>> sensitiveCall)
    {
        try
        {
            return await sensitiveCall();
        }
        catch (Exception ex) when (ex.Message.Contains("STEP_UP_REQUIRED"))
        {
            await PromptAndVerifyAsync();
            return await sensitiveCall();
        }
    }

    private async Task PromptAndVerifyAsync()
    {
        var companyId = _state.CurrentEmployee?.CompanyId
            ?? throw new InvalidOperationException("No active company session.");

        // Fast path: in-memory window still valid
        if (DateTimeOffset.UtcNow < _stepUpValidUntil)
        {
            await _storage.HrConfirmStepUpAsync(companyId);
            return;
        }

        var email = await _storage.GetCurrentUserEmailAsync();
        if (string.IsNullOrWhiteSpace(email))
            throw new InvalidOperationException("Cannot determine current user email for step-up verification.");

        // Prompt for password
        var password = await Shell.Current.DisplayPromptAsync(
            "Security verification",
            "Re-enter your password to continue.",
            accept: "Verify",
            cancel: "Cancel",
            placeholder: "Password",
            maxLength: 128,
            keyboard: Keyboard.Default);

        if (string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("Step-up verification cancelled.");

        try
        {
            // Re-authenticate with GoTrue to confirm password
            await _storage.SignInAsync(email, password);

            // Record confirmed step-up in DB
            await _storage.HrConfirmStepUpAsync(companyId);

            // Cache the 15-minute window in-memory (slightly under DB window)
            _stepUpValidUntil = DateTimeOffset.UtcNow.AddMinutes(14.5);
        }
        catch (Exception ex) when (!ex.Message.Contains("STEP_UP_REQUIRED"))
        {
            // Password wrong or GoTrue error — record failure
            var (attempts, lockedUntil) = await _storage.HrRecordStepUpFailureAsync(companyId);

            if (lockedUntil.HasValue && lockedUntil.Value > DateTimeOffset.UtcNow)
            {
                var lockMins = (int)Math.Ceiling((lockedUntil.Value - DateTimeOffset.UtcNow).TotalMinutes);
                throw new InvalidOperationException(
                    $"Too many failed attempts. Step-up verification locked for {lockMins} minute(s).");
            }

            var remaining = Math.Max(0, 3 - attempts);
            throw new InvalidOperationException(
                $"Incorrect password. {remaining} attempt(s) remaining before lockout.");
        }
    }
}
