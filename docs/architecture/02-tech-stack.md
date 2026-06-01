# 02 — Tech Stack & Technical Architecture

## Solution layout

| Project | Type | Responsibility |
|---------|------|----------------|
| `KaiFlow.Timesheets.Maui` | .NET MAUI app (`Exe`, `UseMaui`) | The entire production client: UI, ViewModels, services, models, Supabase integration |
| `KaiFlow.Payroll` | Class library (referenced) | Pure payroll calculation: SARS PAYE, UIF, salary resolution, IRP5, bank-file formatting, leave-day math |
| `supabase/migrations` | SQL | Database schema, RPCs, RLS, telemetry — the backend source of truth |

`KaiFlow.Timesheets.Maui.csproj` highlights:

```5:5:KaiFlow.Timesheets.Maui/KaiFlow.Timesheets.Maui.csproj
    <TargetFrameworks>net10.0-windows10.0.19041.0;net10.0-android;net10.0-ios;net10.0-maccatalyst</TargetFrameworks>
```

- **Target frameworks:** .NET 10, Windows-first (the dev/primary deployment is the Windows desktop app), plus Android, iOS, Mac Catalyst.
- **Nullable** + **ImplicitUsings** enabled.
- **App identity:** `com.kaisynctech.kaiflow.timesheets`, display name "KaiFlow Timesheets".

### Key NuGet dependencies

| Package | Version | Used for |
|---------|---------|----------|
| `Microsoft.Maui.Controls` | 10.0.60 | UI framework |
| `CommunityToolkit.Maui` | 14.1.1 | UI behaviors / converters |
| `CommunityToolkit.Mvvm` | 8.3.2 | MVVM source generators (`[ObservableProperty]`, `[RelayCommand]`) |
| `Supabase` | 1.1.1 | Supabase client (Postgrest, GoTrue, Realtime, Storage) |
| `QuestPDF` | 2025.4.0 | PDF generation (payslips, exports) |
| `ClosedXML` | 0.102.2 | Excel export |
| `Newtonsoft.Json` | 13.0.3 | JSON parsing of RPC payloads |
| `Plugin.Maui.Audio` | 4.0.0 | Voice quick-notes (My PA) |
| `System.IO.Packaging` | 8.0.0 | OOXML packaging support |

## MVVM implementation

The app is strict MVVM built on **CommunityToolkit.Mvvm**.

- **Base class:** `ViewModels/Base/BaseViewModel.cs` derives from `ObservableObject` and provides:
  - `IsBusy` / `IsNotBusy`, `ErrorMessage`, `Title` as observable properties.
  - `RunAsync(...)` wrappers that centralize the busy/try-catch/error pattern so every async command has uniform loading and error handling:

```29:47:KaiFlow.Timesheets.Maui/ViewModels/Base/BaseViewModel.cs
    protected async Task RunAsync(Func<Task> action, string? busyTitle = null)
    {
        if (IsBusy) return;
        IsBusy = true;
        ErrorMessage = null;
        if (busyTitle != null) Title = busyTitle;
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }
```

- **Source-generated properties/commands:** ViewModels use `[ObservableProperty]` and `[RelayCommand]` throughout (e.g. `MyJobsViewModel`, `HrDashboardViewModel`).
- **Views:** XAML `ContentPage`s under `Views/{Auth,Employee,Hr,ClientPortal,ContractorPortal,Client,Shared}` with `x:DataType` bindings to their ViewModels. Reusable `ContentView`s live under `Views/Shared` (e.g. `AttendanceSessionTableView`, `MyPaSectionView`, `HrJobsTableView`, `PayrollLineItemsTableView`) and `Views/Hr/Controls` (kanban cards/columns, list panels).
- **Folder convention:** ViewModels mirror Views — `ViewModels/{Auth,Employee,Hr,ClientPortal,ContractorPortal}`. Note the employee ViewModel namespace is `KaiFlow.Timesheets.ViewModels.Employees` (plural).

## Dependency injection & composition root

DI is configured in `MauiProgram.cs`. Lifetimes are deliberate:

**Singletons (app-wide state & infrastructure):**

```50:60:KaiFlow.Timesheets.Maui/MauiProgram.cs
        builder.Services.AddSingleton<IStorageService, SupabaseStorageService>();
        builder.Services.AddSingleton<ILocationService, LocationService>();
        builder.Services.AddSingleton<IBranchGeofenceService, BranchGeofenceService>();
        builder.Services.AddSingleton<IOfflineQueueService, OfflineQueueService>();
        builder.Services.AddSingleton<IExportService, ExportService>();
        builder.Services.AddSingleton<IPermissionsService, PermissionsService>();
        builder.Services.AddSingleton<EmployeeScopeService>();
        builder.Services.AddSingleton<AppTelemetry>();
        builder.Services.AddSingleton<AppUpdateService>();
        builder.Services.AddSingleton<RealtimeService>();
        builder.Services.AddSingleton<AccountNotificationAlertService>();
```

- The **Supabase `Client`** is a singleton built with `AutoRefreshToken = true`, `AutoConnectRealtime = false` (realtime is connected lazily/deferred), and a custom `MauiSupabaseSessionHandler` for persisting sessions.
- `TimesheetStateService` is a singleton (global session/state).
- **ViewModels and Pages are transient** (a fresh instance per navigation), except the small number of services injected into them.

The shared `MyPaSectionViewModel` is injected into both the employee My PA page and the HR dashboard so the personal-assistant module can render as an embedded HR tab as well as a standalone page.

## Supabase integration

```38:47:KaiFlow.Timesheets.Maui/MauiProgram.cs
        builder.Services.AddSingleton(provider =>
        {
            var options = new SupabaseOptions
            {
                AutoRefreshToken = true,
                AutoConnectRealtime = false,
                SessionHandler = new MauiSupabaseSessionHandler()
            };
            return new Client(SupabaseEnvironment.Url, SupabaseEnvironment.AnonKey, options);
        });
```

Three Supabase capabilities are used:

1. **Postgrest** — typed table access for authenticated (HR) users via `BaseModel`-decorated models (e.g. `[Table("companies")]`, `[Column(...)]` in `Models/Company.cs`).
2. **GoTrue auth** — JWT sessions for HR; anonymous sessions for code-login users.
3. **Realtime** — Postgres change subscriptions (deferred connect).
4. **Storage** — documents/photos (employee docs, job/project docs, job photos, incident photos).

Data access is abstracted behind **`IStorageService`** (implemented by `SupabaseStorageService`), so ViewModels never touch the Supabase client directly. The implementation mixes:
- **PostgREST** queries for authenticated paths, and
- **`.Rpc(...)`** calls (with manual `Newtonsoft.Json` parsing) for code-login paths and for anything requiring `security definer` privileges.

> See `backend/02-rpcs.md` for the RPC catalog and `architecture/04-offline-and-realtime.md` for realtime/offline.

## PostgreSQL / backend architecture

- **PostgreSQL via Supabase**, schema defined exclusively through versioned SQL migrations in `supabase/migrations` (161 files at the time of this pass).
- **UUID primary keys** across the schema. Earlier iterations used `bigint`; a deliberate migration program moved to UUIDs, which required dropping legacy `bigint` RPC overloads to avoid PostgREST function-overload ambiguity (`PGRST203`).
- **Security-definer RPCs** are the backbone of untrusted-role access.
- **Row Level Security** protects authenticated access and enforces company scoping.
- **Telemetry table** (`app_events`) records structured events.

> See `backend/01-database.md`, `backend/03-migrations.md` for detail.

## Configuration / environment strategy

Connection settings live in `Constants/`:

```10:18:KaiFlow.Timesheets.Maui/Constants/SupabaseEnvironment.cs
    public static string Url =>
        Environment.GetEnvironmentVariable("SUPABASE_URL") ?? SupabaseConfig.Url;

    public static string AnonKey =>
        Environment.GetEnvironmentVariable("SUPABASE_ANON_KEY") ?? SupabaseConfig.AnonKey;

    public static bool IsProduction =>
        Url.Contains("vcivtjwreybaxgtdhtou", StringComparison.OrdinalIgnoreCase);
```

- `SupabaseEnvironment` prefers `SUPABASE_URL` / `SUPABASE_ANON_KEY` environment variables, falling back to hard-coded production values in `SupabaseConfig`.
- The **anon key is committed** in `SupabaseConfig.cs`. The anon key is designed to be publishable, but the project explicitly notes a multi-env pipeline is not yet wired. (See `roadmap/01-risks-and-technical-debt.md`.)
- `Constants/GeoapifyConfig.cs` holds the geocoding provider key used by `LocationService` for reverse-geocoding punch locations.

## Session persistence

- **`MauiSupabaseSessionHandler`** implements the Supabase session-handler contract to persist/restore the GoTrue session (used for HR JWT auto-refresh).
- Code-login (employee), contractor, and client sessions are persisted by dedicated stores: `CodeSessionStore`, `ContractorPortalSessionStore`, `ClientPortalSessionStore` (typically via MAUI `Preferences`/`SecureStorage`).
- `TimesheetStateService` holds the live in-memory session (`CurrentEmployee`, `CurrentCompany`, `LastPunch`) and raises `StateChanged`.

## Telemetry

`AppTelemetry` (singleton) provides structured `LogEvent` / `LogWarning` / `LogError` calls that persist to the `app_events` table (created by the `app_events_telemetry` migration). Modules emit named events (e.g. `my_jobs_query`) with string key/value payloads. See `reporting/01-reporting-and-telemetry.md`.

## Notifications

- **In-app account notifications** are stored server-side and surfaced via `AccountNotificationAlertService` + realtime; unread counts feed dashboards.
- HR-facing notify flows exist in migrations (`hr_in_app_notification_push`, `client_message_inbox_and_hr_notify`, banking/registration notifications).

## Startup flow & resilience

`App.xaml.cs` is written to **never deadlock the UI thread**:

```56:69:KaiFlow.Timesheets.Maui/App.xaml.cs
        window.Created += (_, _) =>
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _supabase.InitializeAsync().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Supabase init: {ex.Message}");
                }
            });
        };
```

- If `AppShell` construction throws, the app shows a diagnostic error page instead of a blank window (`StartupDiagnostics.Write`).
- Supabase `InitializeAsync()` and `RealtimeService` resolution are pushed to background tasks after the window is created, so SecureStorage / network calls never block WinUI window creation.
- `AppShell.xaml.cs` registers all push-navigation routes and defers `RealtimeService`.

## Platform notes

- **Windows** is the first-class target (`win-x64`, unpackaged `WindowsPackageType=None`), reflecting a desktop-primary management deployment.
- Mobile targets (Android/iOS) share the same MVVM/services and are where field-worker offline capture and geolocation matter most.

---

_Next: `03-navigation-and-module-hierarchy.md`._
