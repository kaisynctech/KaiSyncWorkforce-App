using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public record NotificationItem(
    string Title,
    string Body,
    string When,
    string Color,
    bool IsUnread,
    long? AppNotificationId = null,
    string? NotificationType = null);

public partial class EmployeeNotificationsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly RealtimeService _realtime;

    [ObservableProperty] private ObservableCollection<NotificationItem> _notifications = [];

    public EmployeeNotificationsViewModel(IStorageService storage, TimesheetStateService state, RealtimeService realtime)
    {
        _storage = storage;
        _state = state;
        _realtime = realtime;
        Title = "Notifications";
    }

    public void SubscribeAccountRealtime()
    {
        _realtime.AccountNotificationChanged += OnAccountChanged;
        _realtime.MembershipChanged += OnAccountChanged;
        _ = _realtime.EnsureAccountSubscriptionAsync();
    }

    public void UnsubscribeAccountRealtime()
    {
        _realtime.AccountNotificationChanged -= OnAccountChanged;
        _realtime.MembershipChanged -= OnAccountChanged;
    }

    private async void OnAccountChanged(object? sender, EventArgs e)
    {
        try { await LoadAsync(); }
        catch { /* ignore */ }
    }

    [RelayCommand]
    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var items = new List<NotificationItem>();

            var employee = _state.CurrentEmployee;
            var appNotes = await _storage.GetMyNotificationsAsync(employee?.Id);
            foreach (var n in appNotes.OrderByDescending(x => x.CreatedAt))
            {
                items.Add(new NotificationItem(
                    n.Title,
                    n.Body,
                    n.When,
                    n.Color,
                    !n.IsRead,
                    n.Id,
                    n.Type));
            }

            if (employee != null)
            {
                var leave = await _storage.GetMyLeaveRequestsAsync(employee.CompanyId, employee.Id);
                foreach (var l in leave.OrderByDescending(x => x.CreatedAt).Take(20))
                {
                    var (title, color) = l.StatusRaw switch
                    {
                        "approved" => ("Leave Approved", "#22C55E"),
                        "declined" => ("Leave Declined", "#EF4444"),
                        _ => ("Leave Pending Review", "#94A3B8")
                    };
                    var body = $"{l.LeaveType} leave: {l.StartDate:dd MMM} → {l.EndDate:dd MMM}";
                    var when = l.DecidedAt?.ToString("dd MMM HH:mm") ?? l.CreatedAt.ToString("dd MMM");
                    var isUnread = l.StatusRaw is "approved" or "declined" &&
                        l.DecidedAt.HasValue && l.DecidedAt.Value >= DateTime.UtcNow.AddDays(-7);
                    items.Add(new NotificationItem(title, body, when, color, isUnread));
                }

                var incidents = await _storage.GetIncidentsAsync(employee.CompanyId, employee.Id);
                foreach (var i in incidents
                             .OrderByDescending(x => x.CreatedAt).Take(10))
                {
                    var title = i.IsClosed ? "Incident Closed" : "Incident Reported";
                    var body = i.Description.Length > 80 ? i.Description[..77] + "..." : i.Description;
                    var when = i.CreatedAt.ToString("dd MMM");
                    var color = i.IsClosed ? "#22C55E" : "#F59E0B";
                    items.Add(new NotificationItem(title, body, when, color, !i.IsClosed));
                }
            }

            Notifications = new ObservableCollection<NotificationItem>(
                items.OrderByDescending(n => n.IsUnread).ThenByDescending(n => n.When));
        });
    }

    [RelayCommand]
    private async Task OpenNotificationAsync(NotificationItem item)
    {
        if (item == null) return;

        if (item.AppNotificationId.HasValue && item.IsUnread)
            await _storage.MarkNotificationReadAsync(item.AppNotificationId.Value, _state.CurrentEmployee?.Id);

        if (item.NotificationType is "registration_approved" or "registration_rejected")
        {
            await EmployeeAccountRouting.GoToCompanyPickerAsync();
            return;
        }

        if (item.IsUnread)
            await LoadAsync();
    }
}
