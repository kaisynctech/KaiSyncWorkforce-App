# Claude Code Prompt — Employee PIN Authentication (C# Implementation)

**Date:** 2026-06-12  
**Migration applied:** `20260612004_employee_pin_authentication` ✅  
**Project:** KaiFlow Workforce App — `.NET MAUI`, CommunityToolkit.Mvvm, Supabase

---

## Context

The Supabase migration `20260612004` is already live. It adds:

- 5 new columns on `employees`: `pin_hash`, `pin_set_at`, `pin_reset_required`, `pin_failed_attempts`, `pin_locked_until`
- `login_method` column on `employee_code_sessions`
- 3 new RPCs: `employee_set_pin(session_token, pin)`, `employee_sign_in_with_pin(company_code, employee_code, pin)`, `hr_reset_employee_pin(employee_id)`
- Updated `employee_refresh_code_session(token)` — now token-only, no credential re-check
- Updated `employee_sign_in_with_code(company_code, employee_code)` — now returns `needs_pin_setup` and `pin_set`

**Login flows:**
1. **First login:** company code + ID number → `employee_sign_in_with_code` returns `needs_pin_setup: true` → app navigates to PIN setup → `employee_set_pin(session_token, pin)` → fresh session issued
2. **Returning login:** company code + employee code + 4-digit PIN → `employee_sign_in_with_pin` → session issued
3. **Auto-restore:** session token only → `employee_refresh_code_session(token)` — if it returns `needs_pin_setup: true`, route to PIN setup
4. **HR reset:** `hr_reset_employee_pin(employee_id)` — clears PIN, revokes all sessions; next time employee opens app, session refresh fails with `pin_reset_required` detail → re-route to ID-number login

---

## Task 1 — Update `CodeLoginResult.cs`

**File:** `KaiFlow.Timesheets.Maui/Models/CodeLoginResult.cs`

Read the file first. Add two properties to the `CodeLoginResult` class:

```csharp
public bool NeedsPinSetup { get; set; }
public bool PinSet { get; set; }
```

These map to `needs_pin_setup` and `pin_set` (inside the `employee` object) returned by all three RPCs.

---

## Task 2 — Update `IStorageService.cs`

**File:** `KaiFlow.Timesheets.Maui/Services/IStorageService.cs`

Read the file first. Add these three method signatures in the employee auth section (near the existing `SignInWithCodeAsync` and `RefreshCodeSessionAsync`):

```csharp
/// <summary>
/// Called immediately after first-login ID verification.
/// Hashes and stores the employee's 4-digit PIN server-side,
/// revokes the identity session, and issues a fresh PIN session.
/// </summary>
Task<CodeLoginResult?> SetEmployeePinAsync(string sessionToken, string pin);

/// <summary>
/// Returning employee login: company code + employee code + 4-digit PIN.
/// </summary>
Task<CodeLoginResult?> SignInWithPinAsync(string companyCode, string employeeCode, string pin);

/// <summary>
/// HR action: clears the employee's PIN and revokes all active sessions.
/// The employee must re-authenticate with their ID number on next launch.
/// </summary>
Task HrResetEmployeePinAsync(Guid employeeId);
```

---

## Task 3 — Implement the three methods in `SupabaseStorageService`

**File:** `KaiFlow.Timesheets.Maui/Services/SupabaseStorageService.cs` (find the correct partial file if needed — search for `SignInWithCodeAsync`)

Read `SignInWithCodeAsync` carefully before writing anything. Follow the exact same RPC-call, JSON-parse, and `CodeSessionStore.Save` patterns already used there.

### 3a. `SetEmployeePinAsync`

```csharp
public async Task<CodeLoginResult?> SetEmployeePinAsync(string sessionToken, string pin)
{
    try
    {
        var response = await _supabase.Rpc(
            "employee_set_pin",
            new Dictionary<string, object>
            {
                { "p_session_token", sessionToken },
                { "p_pin", pin }
            });

        if (string.IsNullOrWhiteSpace(response.Content))
            return null;

        var parsed = JsonSerializer.Deserialize<CodeLoginResult>(
            response.Content, _jsonOptions);

        if (parsed is null) return null;

        // Save the new PIN session — do NOT store the PIN itself
        // The session token is the credential from here on
        await CodeSessionStore.SaveAsync(
            parsed.Company.Code,
            parsed.Employee.EmployeeCode,
            parsed.SessionToken);

        return parsed;
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[SetEmployeePinAsync] {ex.Message}");
        return null;
    }
}
```

**Important:** `CodeSessionStore.SaveAsync` is a fix introduced in Task 5 (see below). Use `await` — not fire-and-forget.

### 3b. `SignInWithPinAsync`

```csharp
public async Task<CodeLoginResult?> SignInWithPinAsync(
    string companyCode, string employeeCode, string pin)
{
    try
    {
        var response = await _supabase.Rpc(
            "employee_sign_in_with_pin",
            new Dictionary<string, object>
            {
                { "p_company_code",  companyCode },
                { "p_employee_code", employeeCode },
                { "p_pin",           pin }
            });

        if (string.IsNullOrWhiteSpace(response.Content))
            return null;

        var parsed = JsonSerializer.Deserialize<CodeLoginResult>(
            response.Content, _jsonOptions);

        if (parsed is null) return null;

        await CodeSessionStore.SaveAsync(
            parsed.Company.Code,
            parsed.Employee.EmployeeCode,
            parsed.SessionToken);

        return parsed;
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[SignInWithPinAsync] {ex.Message}");
        return null;
    }
}
```

### 3c. `HrResetEmployeePinAsync`

```csharp
public async Task HrResetEmployeePinAsync(Guid employeeId)
{
    try
    {
        await _supabase.Rpc(
            "hr_reset_employee_pin",
            new Dictionary<string, object>
            {
                { "p_employee_id", employeeId.ToString() }
            });
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[HrResetEmployeePinAsync] {ex.Message}");
        throw; // Let caller surface the error to HR user
    }
}
```

---

## Task 4 — Update `SignInWithCodeAsync` JSON parsing

**File:** same as Task 3 — the method that calls `employee_sign_in_with_code`

After the RPC call, the response JSON now includes `needs_pin_setup` at the top level and `pin_set` inside the `employee` object. Ensure the deserialization picks these up into `CodeLoginResult.NeedsPinSetup` and `CodeLoginResult.PinSet`.

If the project uses `[JsonPropertyName]` attributes, add:
- `[JsonPropertyName("needs_pin_setup")]` on `NeedsPinSetup`  
- `[JsonPropertyName("pin_set")]` on `PinSet` (on the Employee model if `pin_set` is inside the employee JSON, otherwise on `CodeLoginResult`)

Read the existing deserialization code before deciding where to place the attributes. Match the existing pattern exactly.

Do the same for `RefreshCodeSessionAsync` — the updated RPC now also returns `needs_pin_setup` and `pin_set`.

---

## Task 5 — Fix `CodeSessionStore.cs` fire-and-forget

**File:** `KaiFlow.Timesheets.Maui/Services/CodeSessionStore.cs`

Read the file first. The current `Save` method calls `_ = PersistAsync(...)` without awaiting, which means session tokens can be silently lost if the app terminates or if `SecureStorage` throws.

### Changes required:

1. **Rename `Save` to `SaveAsync`** and make it `async Task`:

```csharp
public static async Task SaveAsync(string companyCode, string employeeCode, string sessionToken)
{
    var company  = companyCode.Trim().ToUpperInvariant();
    var employee = employeeCode.Trim();
    
    // Persist first — await it
    await PersistAsync(company, employee, sessionToken);
    
    // Then update in-memory cache
    Preferences.Remove(CompanyCodeKey);
    // ... rest of the existing cache-update logic
}
```

2. **Find all callers of `CodeSessionStore.Save(...)` in the solution** (search for `CodeSessionStore.Save`). For each caller:
   - Add `await` before the call
   - Make the enclosing method `async` if it is not already
   - Ensure the caller does not swallow the awaited exception

3. **Do NOT fall back to plaintext `Preferences` for secrets.** If `SecureStorage` throws, the method should throw or return false — not silently downgrade to `Preferences`. Audit the existing `PersistAsync` body: if it catches `SecureStorage` exceptions and falls back to `Preferences.Set` for the session token or employee code, remove that fallback for those two keys. Plain Preferences are acceptable only for non-sensitive data (e.g., last-used company code hint for display purposes).

---

## Task 6 — Fix `RefreshCodeSessionAsync` dangerous fallback

**File:** `KaiFlow.Timesheets.Maui/Services/SupabaseStorageService.cs`

Read `RefreshCodeSessionAsync` first. The current implementation, on session-refresh failure, falls back to calling `SignInWithCodeAsync(codes.Value.CompanyCode, codes.Value.EmployeeCode)` — which re-authenticates using the raw stored ID number as a credential.

**Remove this fallback entirely.** The updated `employee_refresh_code_session` RPC is now token-only. If the token is expired or revoked, the correct behavior is to route the user back to the login screen — not silently re-authenticate with stored credentials.

After the fix, `RefreshCodeSessionAsync` should:
1. Call `employee_refresh_code_session(token)` with the stored token
2. On success: return the `CodeLoginResult`
3. On failure (any exception or null): return `null` — the caller (`IdEntryViewModel`) must treat `null` as "session expired, go to login"

Check: does `IdEntryViewModel.OnAppearing` / `RestoreSessionAsync` already handle a `null` return by routing to the login page? If not, fix that too.

---

## Task 7 — Create `EmployeePinSetupViewModel.cs`

**File:** `KaiFlow.Timesheets.Maui/ViewModels/Auth/EmployeePinSetupViewModel.cs`

This ViewModel handles first-time 4-digit PIN creation. Follow the exact MVVM patterns from `EmployeeLoginViewModel`.

```csharp
[QueryProperty(nameof(SessionToken), "sessionToken")]
public partial class EmployeePinSetupViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] string sessionToken = string.Empty;
    [ObservableProperty] string pin = string.Empty;
    [ObservableProperty] string confirmPin = string.Empty;
    [ObservableProperty] string errorMessage = string.Empty;
    [ObservableProperty] bool hasError;

    public EmployeePinSetupViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state   = state;
        Title    = "Create Your PIN";
    }

    [RelayCommand]
    private async Task SetPinAsync()
    {
        ErrorMessage  = string.Empty;
        HasError      = false;

        if (Pin.Length != 4 || !Pin.All(char.IsDigit))
        {
            ErrorMessage = "PIN must be exactly 4 digits.";
            HasError     = true;
            return;
        }

        if (Pin != ConfirmPin)
        {
            ErrorMessage = "PINs do not match. Please try again.";
            HasError     = true;
            Pin          = string.Empty;
            ConfirmPin   = string.Empty;
            return;
        }

        await RunAsync(async () =>
        {
            var result = await _storage.SetEmployeePinAsync(SessionToken, Pin);

            if (result is null)
            {
                ErrorMessage = "Failed to set PIN. Please try signing in again.";
                HasError     = true;
                return;
            }

            _state.SetCurrentEmployee(result.Employee, result.Company, result.Memberships);

            await Shell.Current.GoToAsync(
                $"//{nameof(EmployeeDashboardPage)}", animate: false);
        });
    }
}
```

**Notes:**
- The `Pin` and `ConfirmPin` entries are bound to digit-entry controls in the XAML — keep them as `string` so the numpad view can append/delete digits.
- `RunAsync` is `BaseViewModel.RunAsync` — check `EmployeeLoginViewModel` for usage pattern.
- Navigate to `EmployeeDashboardPage` (or whichever page is the employee home) after PIN is set.
- Check how `_state.SetCurrentEmployee(...)` is called in `EmployeeLoginViewModel` and match the signature exactly.

---

## Task 8 — Create `EmployeePinSetupPage.xaml` + code-behind

**File:** `KaiFlow.Timesheets.Maui/Views/Auth/EmployeePinSetupPage.xaml`

Follow the layout style of the existing employee auth pages (same shell colors, logo placement, card style). The page must work on small mobile screens.

Key UI elements:
- Heading: "Create Your PIN"
- Subtext: "Choose a 4-digit PIN you'll use to sign in."
- **PIN display row:** 4 circles/boxes that fill in as digits are entered (do not show digits as text — show filled/empty indicators only)
- **Confirm PIN display row:** same style
- **Numpad:** 3×4 grid — digits 1–9, then `←` (backspace), `0`, and `✓` (confirm/submit)
- Error label (bound to `ErrorMessage`, visible when `HasError`)
- Loading indicator (bound to `IsBusy`)

**Numpad implementation pattern:**

Use `Command` bindings on `Button` controls. The ViewModel exposes:

```csharp
[RelayCommand] void AppendDigit(string digit) { /* append to active field */ }
[RelayCommand] void Backspace() { /* remove last char from active field */ }
```

Active field logic: first fill `Pin` (4 digits), then automatically move focus to `ConfirmPin`, then `SetPinCommand` fires when confirm is complete and user taps `✓`.

Alternatively, use two sequential entry states managed by a `CurrentStep` enum: `EnterPin` → `ConfirmPin`. This keeps the logic simple.

Register the page and ViewModel in `MauiProgram.cs` / DI setup — follow the existing auth page registration pattern.

Register the route in `AppShell.xaml.cs`:

```csharp
Routing.RegisterRoute(nameof(EmployeePinSetupPage), typeof(EmployeePinSetupPage));
```

---

## Task 9 — Create `EmployeePinEntryViewModel.cs`

**File:** `KaiFlow.Timesheets.Maui/ViewModels/Auth/EmployeePinEntryViewModel.cs`

This is the returning-employee PIN login screen.

```csharp
[QueryProperty(nameof(CompanyCode),  "companyCode")]
[QueryProperty(nameof(EmployeeCode), "employeeCode")]
public partial class EmployeePinEntryViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] string companyCode  = string.Empty;
    [ObservableProperty] string employeeCode = string.Empty;
    [ObservableProperty] string pin          = string.Empty;
    [ObservableProperty] string errorMessage = string.Empty;
    [ObservableProperty] bool hasError;

    public EmployeePinEntryViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state   = state;
        Title    = "Enter Your PIN";
    }

    [RelayCommand]
    private async Task SubmitPinAsync()
    {
        ErrorMessage = string.Empty;
        HasError     = false;

        if (Pin.Length != 4)
            return; // numpad prevents this, but guard anyway

        await RunAsync(async () =>
        {
            var result = await _storage.SignInWithPinAsync(CompanyCode, EmployeeCode, Pin);

            if (result is null)
            {
                ErrorMessage = "Incorrect PIN. Please try again.";
                HasError     = true;
                Pin          = string.Empty;
                return;
            }

            // PIN reset required (HR wiped it)
            if (result.NeedsPinSetup)
            {
                await Shell.Current.GoToAsync(
                    $"{nameof(EmployeePinSetupPage)}?sessionToken={result.SessionToken}");
                return;
            }

            _state.SetCurrentEmployee(result.Employee, result.Company, result.Memberships);

            await Shell.Current.GoToAsync(
                $"//{nameof(EmployeeDashboardPage)}", animate: false);
        });
    }

    [RelayCommand]
    private async Task UseIdNumberInsteadAsync()
    {
        // Navigate back to the code/ID login screen
        await Shell.Current.GoToAsync("..");
    }
}
```

The `SignInWithPinAsync` RPC returns a specific error detail `account_locked` when locked. Optionally catch the `PostgrestException` and check the detail to show a better message:

```csharp
catch (PostgrestException pgEx) when (pgEx.Message.Contains("account_locked"))
{
    ErrorMessage = "Too many incorrect attempts. Please try again in 15 minutes.";
    HasError     = true;
}
```

Look at how `EmployeeLoginViewModel` handles `PostgrestException` and match that pattern.

---

## Task 10 — Create `EmployeePinEntryPage.xaml` + code-behind

**File:** `KaiFlow.Timesheets.Maui/Views/Auth/EmployeePinEntryPage.xaml`

Same layout style as `EmployeePinSetupPage` but without the confirm row.

Key UI elements:
- Heading: "Enter Your PIN"
- Subtext: shows the employee's name if available (pass it as a query param, or derive from the session restore result)
- **PIN display row:** 4 circles — fill as digits are entered, auto-submit when 4th digit is entered
- **Numpad:** same 3×4 grid, no `✓` button needed (auto-submit on 4th digit)
- Error label
- "Use ID number instead" link/button (calls `UseIdNumberInsteadCommand`)
- Loading indicator

Register route in `AppShell.xaml.cs`:

```csharp
Routing.RegisterRoute(nameof(EmployeePinEntryPage), typeof(EmployeePinEntryPage));
```

Register page + ViewModel in DI.

---

## Task 11 — Refactor `EmployeeLoginViewModel.cs`

**File:** `KaiFlow.Timesheets.Maui/ViewModels/Auth/EmployeeLoginViewModel.cs`

Read the entire file first. The current code login path (`LoginWithCodeAsync`) calls `SignInWithCodeAsync` and then checks `LoginPasswordReady` to decide whether to route to `EmployeeMandatoryPasswordPage`. That logic must be replaced.

**New routing logic after `SignInWithCodeAsync` returns:**

```csharp
var result = await _storage.SignInWithCodeAsync(companyCode, employeeCode);

if (result is null)
{
    // Show error — invalid code
    return;
}

if (result.NeedsPinSetup)
{
    // First login or PIN was reset by HR — go to PIN setup
    await Shell.Current.GoToAsync(
        $"{nameof(EmployeePinSetupPage)}?sessionToken={result.SessionToken}");
    return;
}

// Has a PIN — go to PIN entry with the codes pre-filled
await Shell.Current.GoToAsync(
    $"{nameof(EmployeePinEntryPage)}?companyCode={result.Company.Code}&employeeCode={result.Employee.EmployeeCode}");
```

**Do NOT route to `EmployeeMandatoryPasswordPage` from the code-login path.** The mandatory password page (8-char Supabase auth password) is irrelevant for code/PIN employees. Leave it reachable only from the email/password login path if it is used there.

---

## Task 12 — Refactor `IdEntryViewModel.cs` (session restore routing)

**File:** `KaiFlow.Timesheets.Maui/ViewModels/Auth/IdEntryViewModel.cs`

Read the file first. This ViewModel handles app startup and auto-restores sessions from `CodeSessionStore`.

After calling `RefreshCodeSessionAsync`, apply this routing:

```csharp
var result = await _storage.RefreshCodeSessionAsync();

if (result is null)
{
    // Session expired/revoked — go to login
    await Shell.Current.GoToAsync($"//{nameof(EmployeeLoginPage)}", animate: false);
    return;
}

if (result.NeedsPinSetup)
{
    // HR reset the PIN — must re-enter ID number then create new PIN
    // Route to login with a message (or directly to PIN setup if session token is still valid)
    await Shell.Current.GoToAsync(
        $"{nameof(EmployeePinSetupPage)}?sessionToken={result.SessionToken}");
    return;
}

// Fully authenticated — restore state and proceed
_state.SetCurrentEmployee(result.Employee, result.Company, result.Memberships);
await Shell.Current.GoToAsync($"//{nameof(EmployeeDashboardPage)}", animate: false);
```

**Note:** If `RefreshCodeSessionAsync` now returns `null` for all failure cases (expired, revoked, pin_reset), check that `IdEntryViewModel` was not previously relying on the fallback re-auth (which we removed in Task 6). The null path should always route to the login screen — this is correct.

---

## Task 13 — Register everything in DI and AppShell

1. Open `MauiProgram.cs` (or wherever services are registered).
2. Add:
   ```csharp
   builder.Services.AddTransient<EmployeePinSetupViewModel>();
   builder.Services.AddTransient<EmployeePinSetupPage>();
   builder.Services.AddTransient<EmployeePinEntryViewModel>();
   builder.Services.AddTransient<EmployeePinEntryPage>();
   ```
3. Open `AppShell.xaml.cs` and register routes (if not done in Tasks 8/10):
   ```csharp
   Routing.RegisterRoute(nameof(EmployeePinSetupPage), typeof(EmployeePinSetupPage));
   Routing.RegisterRoute(nameof(EmployeePinEntryPage), typeof(EmployeePinEntryPage));
   ```

---

## Strict rules for all tasks

1. **Read every file before editing it.** Do not write code from memory.
2. **Match existing patterns exactly:** `[ObservableProperty]`, `[RelayCommand]`, `partial void On*Changed`, `BaseViewModel.RunAsync`, `MainThread.InvokeOnMainThreadAsync`, `IsCodeLoginSession()`, `TimesheetStateService` (not `AppState`), JSON deserialization options already used in `SupabaseStorageService`.
3. **No temporary code, no TODO comments, no hardcoded values.**
4. **Do not modify the Supabase migration files** — the migration is already applied.
5. **Do not create any new Supabase RPCs** — only call the ones listed above.
6. **The PIN is never persisted anywhere in the client** — only the session token goes into `CodeSessionStore`.
7. **`CodeSessionStore.SaveAsync` must be awaited at every call site** (Task 5 renames `Save` to `SaveAsync`).
8. **Search the entire solution for `CodeSessionStore.Save`** after renaming — update every caller.
9. **Search for `SignInWithCodeAsync` callers** — ensure they all handle `NeedsPinSetup` correctly after the model change.
10. **Build must compile with no warnings treated as errors** before marking complete.

---

## Verification checklist

After all tasks:

- [ ] `CodeLoginResult` has `NeedsPinSetup` and `PinSet` with correct `[JsonPropertyName]` attributes
- [ ] `IStorageService` has 3 new method signatures
- [ ] `SupabaseStorageService` implements all 3, calling the exact RPC names above
- [ ] `SetEmployeePinAsync` and `SignInWithPinAsync` both call `CodeSessionStore.SaveAsync` (awaited)
- [ ] `RefreshCodeSessionAsync` no longer calls `SignInWithCodeAsync` as a fallback
- [ ] `CodeSessionStore.Save` renamed to `SaveAsync`, returns `Task`, is awaited everywhere
- [ ] `EmployeePinSetupViewModel` + `EmployeePinSetupPage` created and registered
- [ ] `EmployeePinEntryViewModel` + `EmployeePinEntryPage` created and registered
- [ ] `EmployeeLoginViewModel` code path routes to PIN setup or PIN entry (not `EmployeeMandatoryPasswordPage`)
- [ ] `IdEntryViewModel` handles `null` from `RefreshCodeSessionAsync` by routing to login
- [ ] Project builds cleanly
