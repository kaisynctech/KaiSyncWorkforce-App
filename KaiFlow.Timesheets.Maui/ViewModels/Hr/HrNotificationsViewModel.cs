using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record HrNotificationItem(
    string Title,
    string Body,
    string When,
    string Color,
    bool IsUnread,
    long? AppNotificationId = null,
    string? NotificationType = null,
    string? RefType = null,
    string? RefId = null);

public partial class HrNotificationsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly RealtimeService _realtime;
    private readonly AccountNotificationAlertService _notificationAlerts;

    [ObservableProperty] private ObservableCollection<HrNotificationItem> _appNotifications = [];
    [ObservableProperty] private ObservableCollection<LeaveRequest> _pendingLeave = [];
    [ObservableProperty] private ObservableCollection<IncidentReport> _openIncidents = [];
    [ObservableProperty] private ObservableCollection<PaymentApproval> _pendingPayments = [];

    public bool HasAppNotifications => AppNotifications.Count > 0;

    public HrNotificationsViewModel(
        IStorageService storage,
        TimesheetStateService state,
        RealtimeService realtime,
        AccountNotificationAlertService notificationAlerts)
    {
        _storage = storage;
        _state = state;
        _realtime = realtime;
        _notificationAlerts = notificationAlerts;
        Title = "Notifications";
    }

    public void SubscribeAccountRealtime()
    {
        _realtime.AccountNotificationChanged += OnAccountChanged;
        _ = _realtime.EnsureAccountSubscriptionAsync();
    }

    public void UnsubscribeAccountRealtime()
    {
        _realtime.AccountNotificationChanged -= OnAccountChanged;
    }

    private async void OnAccountChanged(object? sender, EventArgs e)
    {
        try { await LoadAsync(); }
        catch { /* ignore */ }
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;

            var appNotes = await _storage.GetMyNotificationsAsync();
            AppNotifications = new ObservableCollection<HrNotificationItem>(
                appNotes.OrderByDescending(n => n.CreatedAt).Select(n => new HrNotificationItem(
                    n.Type == "client_portal_message"
                        ? NotificationDisplay.ClientPortalThreadTitle(n)
                        : n.Title,
                    n.Body,
                    n.When,
                    n.Color,
                    !n.IsRead,
                    n.Id,
                    n.Type,
                    n.RefType,
                    n.RefId)));

            OnPropertyChanged(nameof(HasAppNotifications));

            var leave = await _storage.GetLeaveRequestsAsync(companyId);
            PendingLeave = new ObservableCollection<LeaveRequest>(
                leave.Where(l => l.IsPending).OrderByDescending(l => l.CreatedAt));

            var incidents = await _storage.GetIncidentsAsync(companyId);
            OpenIncidents = new ObservableCollection<IncidentReport>(
                incidents.Where(i => !i.IsClosed).OrderByDescending(i => i.CreatedAt));

            var payments = await _storage.GetPaymentsAsync(companyId);
            PendingPayments = new ObservableCollection<PaymentApproval>(
                payments.Where(p => p.Status == PaymentStatus.Pending).OrderByDescending(p => p.CreatedAt));
        });
    }

    [RelayCommand]
    private async Task OpenAppNotificationAsync(HrNotificationItem item)
    {
        if (item == null) return;

        if (item.AppNotificationId.HasValue && item.IsUnread)
            await _storage.MarkNotificationReadAsync(item.AppNotificationId.Value);

        if (item.NotificationType == "client_portal_message" &&
            item.RefType == "message_thread" &&
            Guid.TryParse(item.RefId, out var threadId))
        {
            await ShellNavigation.GoToAsync(
                $"{nameof(HrSimpleThreadChatPage)}?ThreadId={threadId}&ThreadSubject={Uri.EscapeDataString(item.Title)}");
            return;
        }

        if (item.IsUnread)
            await LoadAsync();
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
