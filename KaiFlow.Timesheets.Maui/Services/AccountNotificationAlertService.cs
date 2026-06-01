using CommunityToolkit.Maui.Alerts;
using CommunityToolkit.Maui.Core;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

/// <summary>Shows in-app toast when realtime delivers a new app_notification (not SMS).</summary>
public class AccountNotificationAlertService
{
    private readonly IStorageService _storage;
    private readonly HashSet<long> _toastedIds = [];

    public AccountNotificationAlertService(IStorageService storage)
    {
        _storage = storage;
    }

    public async Task<int> RefreshUnreadCountAsync()
    {
        var notes = await _storage.GetMyNotificationsAsync();
        return notes.Count(n => !n.IsRead);
    }

    public async Task OnRealtimeNotificationAsync()
    {
        var notes = await _storage.GetMyNotificationsAsync();
        var latest = notes
            .Where(n => !n.IsRead)
            .OrderByDescending(n => n.CreatedAt)
            .FirstOrDefault();

        if (latest == null || _toastedIds.Contains(latest.Id))
            return;

        _toastedIds.Add(latest.Id);
        if (_toastedIds.Count > 200)
            _toastedIds.Clear();

        var text = string.IsNullOrWhiteSpace(latest.Body)
            ? latest.Title
            : $"{latest.Title}\n{latest.Body}";

        await MainThread.InvokeOnMainThreadAsync(async () =>
        {
            var toast = Toast.Make(text, ToastDuration.Long, 14);
            await toast.Show();
        });
    }

    public static bool OpensMessageThread(AppNotification n) =>
        n.Type == "client_portal_message" &&
        n.RefType == "message_thread" &&
        Guid.TryParse(n.RefId, out _);
}
