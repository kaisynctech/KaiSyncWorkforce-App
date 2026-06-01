using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models.Production;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Production;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Production;

[QueryProperty(nameof(IsMandatoryParam), "mandatory")]
public partial class UpdateViewModel : BaseViewModel
{
    private readonly IVersionService _versions;

    [ObservableProperty] private UpdateCheckResult? _updateInfo;
    [ObservableProperty] private string _releaseNotes = "";
    [ObservableProperty] private bool _isMandatory;
    [ObservableProperty] private string _installedVersion = "";
    [ObservableProperty] private string _latestVersion = "";

    public string IsMandatoryParam { get; set; } = "false";

    public bool CanSkip => !IsMandatory && UpdateInfo?.UpdateAvailable == true;
    public bool HasStoreUrl => !string.IsNullOrWhiteSpace(UpdateInfo?.StoreUrl);

    public UpdateViewModel(IVersionService versions)
    {
        _versions = versions;
        Title = "App Update";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            IsMandatory = bool.TryParse(IsMandatoryParam, out var m) && m;
            var (ver, build) = _versions.GetInstalledVersion();
            InstalledVersion = $"{ver} (build {build})";

            UpdateInfo = await _versions.CheckForUpdateAsync();
            if (UpdateInfo?.Latest is { } latest)
            {
                LatestVersion = $"{latest.Version} (build {latest.BuildNumber})";
                ReleaseNotes = string.IsNullOrWhiteSpace(latest.ReleaseNotes)
                    ? "Bug fixes and performance improvements."
                    : latest.ReleaseNotes;
                IsMandatory = IsMandatory || UpdateInfo.IsMandatory;
            }

            OnPropertyChanged(nameof(CanSkip));
            OnPropertyChanged(nameof(HasStoreUrl));
        });
    }

    [RelayCommand]
    private async Task OpenStoreAsync()
    {
        var url = UpdateInfo?.StoreUrl;
        if (string.IsNullOrWhiteSpace(url)) return;
        await Launcher.Default.OpenAsync(new Uri(url));
    }

    [RelayCommand]
    private async Task ContinueAsync()
    {
        if (IsMandatory && UpdateInfo?.UpdateAvailable == true)
        {
            ErrorMessage = "This update is required before you can continue.";
            return;
        }
        await ShellNavigation.GoToAsync("//IdEntry");
    }
}
