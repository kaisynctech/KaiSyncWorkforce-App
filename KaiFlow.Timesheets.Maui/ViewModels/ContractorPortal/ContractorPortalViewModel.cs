using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.ContractorPortal;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.ContractorPortal;

public partial class ContractorPortalViewModel : BaseViewModel
{
    private readonly IStorageService _storage;

    [ObservableProperty] private string _contractorName = "";
    [ObservableProperty] private string _companyCode = "";
    [ObservableProperty] private string _contractorCode = "";
    [ObservableProperty] private string _onSiteBanner = "";
    [ObservableProperty] private ObservableCollection<Job> _jobs = [];
    [ObservableProperty] private ObservableCollection<ContractorPayout> _payouts = [];
    [ObservableProperty] private string _portalTab = "jobs";
    [ObservableProperty] private string _outstandingPayoutsDisplay = "R0.00";

    public bool IsJobsTab => PortalTab == "jobs";
    public bool IsPayoutsTab => PortalTab == "payouts";

    public ContractorPortalViewModel(IStorageService storage)
    {
        _storage = storage;
        Title = "Contractor Portal";
    }

    partial void OnPortalTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsJobsTab));
        OnPropertyChanged(nameof(IsPayoutsTab));
    }

    public async Task LoadAsync()
    {
        var session = ContractorPortalSessionStore.Get();
        if (session == null)
        {
            await ShellNavigation.GoToAsync("//IdEntry");
            return;
        }

        await RunAsync(async () =>
        {
            ContractorName = session.Value.ContractorName;
            CompanyCode = session.Value.CompanyCode;
            ContractorCode = session.Value.ContractorCode;
            Title = ContractorName;

            var open = await _storage.ContractorPortalOpenVisitAsync(CompanyCode, ContractorCode);
            OnSiteBanner = open != null
                ? $"On site · job in progress since {open.SignInAt.ToLocalTime():h:mm tt}"
                : "Not signed in on a job";

            var jobs = await _storage.GetContractorPortalJobsAsync(CompanyCode, ContractorCode);
            Jobs = new ObservableCollection<Job>(jobs);

            var payouts = await _storage.GetContractorPortalPayoutsAsync(CompanyCode, ContractorCode);
            Payouts = new ObservableCollection<ContractorPayout>(payouts);
            var outstanding = payouts.Where(p => p.PayoutStatusRaw != "paid").Sum(p => p.NetPayable);
            OutstandingPayoutsDisplay = $"R{outstanding:N2}";
        });
    }

    [RelayCommand]
    private void ShowJobsTab() => PortalTab = "jobs";

    [RelayCommand]
    private void ShowPayoutsTab() => PortalTab = "payouts";

    [RelayCommand]
    private async Task OpenJobAsync(Job job)
    {
        if (job == null) return;
        await ShellNavigation.GoToAsync(
            nameof(ContractorPortalJobDetailPage),
            new Dictionary<string, object> { ["JobId"] = job.Id.ToString() });
    }

    [RelayCommand]
    private async Task SignOutAsync()
    {
        ContractorPortalSessionStore.Clear();
        await ShellNavigation.GoToAsync("//IdEntry");
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
