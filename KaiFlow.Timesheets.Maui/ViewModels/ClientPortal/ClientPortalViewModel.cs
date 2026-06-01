using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.ClientPortal;

public partial class ClientPortalViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _clientName = "";
    [ObservableProperty] private string _companyCode = "";
    [ObservableProperty] private string _clientCode = "";
    [ObservableProperty] private ObservableCollection<ClientDeal> _projects = [];
    [ObservableProperty] private ObservableCollection<ClientPortalMessageInboxItem> _messageInbox = [];
    [ObservableProperty] private ObservableCollection<FinanceInvoice> _invoices = [];
    [ObservableProperty] private string _portalTab = "projects";
    [ObservableProperty] private int _unreadMessageCount;
    [ObservableProperty] private string _outstandingBalanceDisplay = "R0.00";

    public bool IsProjectsTab => PortalTab == "projects";
    public bool IsMessagesTab => PortalTab == "messages";
    public bool IsInvoicesTab => PortalTab == "invoices";
    public bool HasUnreadMessages => UnreadMessageCount > 0;
    public string MessagesTabLabel => UnreadMessageCount > 0 ? $"Messages ({UnreadMessageCount})" : "Messages";

    public ClientPortalViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Client Portal";
    }

    partial void OnPortalTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsProjectsTab));
        OnPropertyChanged(nameof(IsMessagesTab));
        OnPropertyChanged(nameof(IsInvoicesTab));
    }

    partial void OnUnreadMessageCountChanged(int value)
    {
        OnPropertyChanged(nameof(HasUnreadMessages));
        OnPropertyChanged(nameof(MessagesTabLabel));
    }

    public async Task LoadAsync()
    {
        if (ClientPortalSessionStore.IsSigningOut)
            return;

        var session = ClientPortalSessionStore.Get();
        if (session == null)
        {
            await ClientPortalNavigation.ExitToLoginAsync(_state);
            return;
        }

        await RunAsync(async () =>
        {
            ClientName = session.Value.ClientName;
            CompanyCode = session.Value.CompanyCode;
            ClientCode = session.Value.ClientCode;
            Title = ClientName;

            var projects = await _storage.GetClientPortalProjectsAsync(
                session.Value.CompanyCode,
                session.Value.ClientCode);
            Projects = new ObservableCollection<ClientDeal>(projects);

            await LoadMessageInboxAsync(session.Value.CompanyCode, session.Value.ClientCode);
            await LoadInvoicesAsync(session.Value.CompanyCode, session.Value.ClientCode);
        });
    }

    private async Task LoadInvoicesAsync(string companyCode, string clientCode)
    {
        var invoices = await _storage.GetClientPortalInvoicesAsync(companyCode, clientCode);
        Invoices = new ObservableCollection<FinanceInvoice>(invoices);
        var outstanding = invoices.Where(i => i.IsOutstanding).Sum(i => i.BalanceDue);
        OutstandingBalanceDisplay = $"R{outstanding:N2}";
    }

    private async Task LoadMessageInboxAsync(string companyCode, string clientCode)
    {
        var inbox = await _storage.GetClientPortalMessageInboxAsync(companyCode, clientCode);
        foreach (var item in inbox)
        {
            if (!item.LastFromHr || item.LastMessageAt == null)
            {
                item.HasUnread = false;
                continue;
            }

            var readAt = ClientPortalSessionStore.GetDealMessagesReadAtUtc(item.DealId);
            item.HasUnread = readAt == null || item.LastMessageAt > readAt;
        }

        MessageInbox = new ObservableCollection<ClientPortalMessageInboxItem>(inbox);
        UnreadMessageCount = inbox.Count(i => i.HasUnread);
    }

    [RelayCommand]
    private void ShowProjectsTab() => PortalTab = "projects";

    [RelayCommand]
    private void ShowMessagesTab() => PortalTab = "messages";

    [RelayCommand]
    private void ShowInvoicesTab() => PortalTab = "invoices";

    [RelayCommand]
    private async Task OpenProjectAsync(ClientDeal deal)
    {
        if (deal == null) return;
        await ShellNavigation.GoToAsync(ClientPortalNavigation.ProjectDetailRoute(deal.Id));
    }

    [RelayCommand]
    private async Task OpenMessageThreadAsync(ClientPortalMessageInboxItem item)
    {
        if (item == null) return;
        ClientPortalSessionStore.MarkDealMessagesRead(item.DealId, item.LastMessageAt ?? DateTime.UtcNow);
        item.HasUnread = false;
        UnreadMessageCount = MessageInbox.Count(i => i.HasUnread);
        await ShellNavigation.GoToAsync(ClientPortalNavigation.ProjectDetailRoute(item.DealId, openMessages: true));
    }

    [RelayCommand]
    private async Task SignOutAsync() => await ClientPortalNavigation.ExitToLoginAsync(_state);

    [RelayCommand]
    private async Task ExitToMainMenuAsync() => await ClientPortalNavigation.ExitToLoginAsync(_state);

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
