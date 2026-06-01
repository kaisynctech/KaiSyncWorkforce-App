using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class IdEntryPage : ContentPage
{
    private readonly IdEntryViewModel _vm;
    private readonly AppUpdateService _updateService;
    private bool _updateChecked;

    public IdEntryPage(IdEntryViewModel vm, AppUpdateService updateService)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
        _updateService = updateService;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        try
        {
            await Task.Yield();
            await _vm.InitializeAsync();
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Write("id-entry", "Initialize failed on appearing", ex);
            await DisplayAlertAsync("Startup error", ex.Message, "OK");
        }

        if (!_updateChecked)
        {
            _updateChecked = true;
            await RequestNotificationPermissionAsync();

            var update = await _updateService.CheckDetailedAsync();
            if (update.UpdateAvailable)
            {
                if (update.IsMandatory)
                {
                    await ShellNavigation.GoToAsync(
                        $"{nameof(Views.Production.UpdatePage)}?mandatory=true");
                    return;
                }

                var goToUpdate = await DisplayAlert(
                    "Update Available",
                    $"Version {update.Latest?.Version} is available.\n\n{update.Latest?.ReleaseNotes ?? "View release notes in the update screen."}",
                    "View update",
                    "Later");
                if (goToUpdate)
                    await ShellNavigation.GoToAsync(nameof(Views.Production.UpdatePage));
            }
        }
    }

    private static async Task RequestNotificationPermissionAsync()
    {
        try
        {
#if ANDROID
            if (OperatingSystem.IsAndroidVersionAtLeast(33))
                await Permissions.RequestAsync<Permissions.PostNotifications>();
#elif IOS
            await Permissions.RequestAsync<Permissions.PostNotifications>();
#endif
        }
        catch { /* permission API unavailable on this platform */ }
    }
}
