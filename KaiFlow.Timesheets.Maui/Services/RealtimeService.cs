using KaiFlow.Timesheets.Models;
using Supabase.Realtime;
using Supabase.Realtime.PostgresChanges;

namespace KaiFlow.Timesheets.Services;

public class RealtimeService : IDisposable
{
    private readonly Supabase.Client _supabase;
    private readonly TimesheetStateService _state;
    private readonly AppTelemetry _telemetry;

    private RealtimeChannel? _punchChannel;
    private RealtimeChannel? _leaveChannel;
    private RealtimeChannel? _incidentChannel;
    private RealtimeChannel? _employeeChannel;
    private RealtimeChannel? _accountNotificationChannel;
    private bool _connected;
    private Guid _subscribedCompanyId;
    private Guid _subscribedUserId;

    // Desired (intended) subscription state — what we want to be connected to.
    // Distinct from the *_subscribed* fields which track what is actually live.
    private Guid _desiredCompanyId;
    private Guid _desiredUserId;

    // Reconnect supervisor state.
    private readonly object _reconnectLock = new();
    private CancellationTokenSource? _reconnectCts;
    private bool _reconnecting;
    private int _reconnectAttempt;

    private const int MaxBackoffSeconds = 60;

    public event EventHandler? PunchChanged;
    public event EventHandler? LeaveChanged;
    public event EventHandler? IncidentChanged;
    public event EventHandler? MembershipChanged;
    public event EventHandler? AccountNotificationChanged;

    /// <summary>Whether the Supabase realtime socket is connected.</summary>
    public bool IsConnected => _connected;

    /// <summary>Whether the reconnect supervisor is actively retrying.</summary>
    public bool IsReconnecting => _reconnecting;

    public string StatusLabel => IsReconnecting ? "Reconnecting" : IsConnected ? "Connected" : "Offline";

    /// <summary>Raises <see cref="PunchChanged"/> after a punch is saved locally (team, self, or employee).</summary>
    public void NotifyPunchChanged() => Raise(PunchChanged);

    public void NotifyIncidentChanged() => Raise(IncidentChanged);

    public RealtimeService(Supabase.Client supabase, TimesheetStateService state, AppTelemetry telemetry)
    {
        _supabase = supabase;
        _state = state;
        _telemetry = telemetry;
        _state.StateChanged += OnStateChanged;
        Connectivity.ConnectivityChanged += OnConnectivityChanged;
    }

    // ── Event raising — always marshalled to the main thread so subscribers can
    //    touch UI safely regardless of which thread the realtime socket fired on. ──
    private static void Raise(EventHandler? handler)
    {
        if (handler is null) return;
        if (MainThread.IsMainThread)
            handler.Invoke(null, EventArgs.Empty);
        else
            MainThread.BeginInvokeOnMainThread(() => handler.Invoke(null, EventArgs.Empty));
    }

    private void OnStateChanged(object? sender, EventArgs e)
    {
        var company = _state.CurrentCompany;
        if (company != null && company.Id != _subscribedCompanyId)
            _ = SubscribeAsync(company.Id);
        else if (company == null && _subscribedCompanyId != Guid.Empty)
            _ = UnsubscribeAsync();
    }

    private void OnConnectivityChanged(object? sender, ConnectivityChangedEventArgs e)
    {
        // When the network returns, proactively heal subscriptions rather than waiting
        // for the next StateChanged / app foreground.
        if (e.NetworkAccess == NetworkAccess.Internet
            && (_desiredCompanyId != Guid.Empty || _desiredUserId != Guid.Empty))
        {
            ScheduleReconnect("connectivity_restored");
        }
    }

    private async Task SubscribeAsync(Guid companyId)
    {
        _desiredCompanyId = companyId;
        await UnsubscribeChannelsAsync();

        try
        {
            await EnsureConnectedAsync(companyId);

            var cid = companyId.ToString();

            _punchChannel = _supabase.Realtime.Channel("realtime", "public", "time_punches", "company_id", cid);
            _punchChannel.AddPostgresChangeHandler(
                PostgresChangesOptions.ListenType.Inserts,
                (_, _) => Raise(PunchChanged));
            await _punchChannel.Subscribe();

            _leaveChannel = _supabase.Realtime.Channel("realtime", "public", "leave_requests", "company_id", cid);
            _leaveChannel.AddPostgresChangeHandler(
                PostgresChangesOptions.ListenType.All,
                (_, _) => Raise(LeaveChanged));
            await _leaveChannel.Subscribe();

            _incidentChannel = _supabase.Realtime.Channel("realtime", "public", "incident_reports", "company_id", cid);
            _incidentChannel.AddPostgresChangeHandler(
                PostgresChangesOptions.ListenType.All,
                (_, _) => Raise(IncidentChanged));
            await _incidentChannel.Subscribe();

            _subscribedCompanyId = companyId;
            OnReconnectSucceeded();
            _telemetry.LogSuccess("realtime_subscribed", nameof(SubscribeAsync), new Dictionary<string, string>
            {
                ["company_id"] = companyId.ToString(),
            });
        }
        catch (Exception ex)
        {
            _telemetry.LogWarning(
                "realtime company subscribe failed",
                nameof(SubscribeAsync),
                new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["error"] = ex.Message,
                });
            ScheduleReconnect("company_subscribe_failed");
        }
    }

    private async Task EnsureConnectedAsync(Guid companyId)
    {
        if (_connected) return;
        await _supabase.Realtime.ConnectAsync();
        _connected = true;
        _telemetry.LogEvent("realtime_connected", new Dictionary<string, string>
        {
            ["company_id"] = companyId.ToString(),
        });
    }

    private async Task UnsubscribeChannelsAsync()
    {
        try
        {
            if (_punchChannel != null) { _supabase.Realtime.Remove(_punchChannel); _punchChannel = null; }
            if (_leaveChannel != null) { _supabase.Realtime.Remove(_leaveChannel); _leaveChannel = null; }
            if (_incidentChannel != null) { _supabase.Realtime.Remove(_incidentChannel); _incidentChannel = null; }
        }
        catch (Exception ex)
        {
            _telemetry.LogWarning("realtime unsubscribe failed", nameof(UnsubscribeChannelsAsync),
                new Dictionary<string, string> { ["error"] = ex.Message });
        }

        if (_subscribedCompanyId != Guid.Empty)
        {
            _telemetry.LogEvent("realtime_unsubscribed", new Dictionary<string, string>
            {
                ["company_id"] = _subscribedCompanyId.ToString(),
            });
        }

        _subscribedCompanyId = Guid.Empty;
        await Task.CompletedTask;
    }

    private async Task UnsubscribeAsync()
    {
        _desiredCompanyId = Guid.Empty;
        await UnsubscribeChannelsAsync();
        CancelReconnectIfIdle();
    }

    public async Task EnsureAccountSubscriptionAsync()
    {
        var userIdRaw = _supabase.Auth.CurrentUser?.Id;
        if (string.IsNullOrWhiteSpace(userIdRaw) || !Guid.TryParse(userIdRaw, out var userId))
        {
            await UnsubscribeAccountAsync();
            return;
        }

        _desiredUserId = userId;

        if (userId == _subscribedUserId)
            return;

        await UnsubscribeAccountChannelsAsync();

        try
        {
            if (!_connected)
            {
                await _supabase.Realtime.ConnectAsync();
                _connected = true;
            }

            var uid = userId.ToString();

            _employeeChannel = _supabase.Realtime.Channel(
                "employee_memberships", "public", "employees", "user_id", uid);
            _employeeChannel.AddPostgresChangeHandler(
                PostgresChangesOptions.ListenType.All,
                (_, _) => Raise(MembershipChanged));
            await _employeeChannel.Subscribe();

            _accountNotificationChannel = _supabase.Realtime.Channel(
                "account_notifications", "public", "app_notifications", "recipient_auth_user_id", uid);
            _accountNotificationChannel.AddPostgresChangeHandler(
                PostgresChangesOptions.ListenType.All,
                (_, _) => Raise(AccountNotificationChanged));
            await _accountNotificationChannel.Subscribe();

            _subscribedUserId = userId;
            OnReconnectSucceeded();
            _telemetry.LogSuccess("realtime_account_subscribed", nameof(EnsureAccountSubscriptionAsync));
        }
        catch (Exception ex)
        {
            _telemetry.LogWarning(
                "realtime account subscribe failed",
                nameof(EnsureAccountSubscriptionAsync),
                new Dictionary<string, string> { ["error"] = ex.Message });
            ScheduleReconnect("account_subscribe_failed");
        }
    }

    private async Task UnsubscribeAccountChannelsAsync()
    {
        try
        {
            if (_employeeChannel != null)
            {
                _supabase.Realtime.Remove(_employeeChannel);
                _employeeChannel = null;
            }

            if (_accountNotificationChannel != null)
            {
                _supabase.Realtime.Remove(_accountNotificationChannel);
                _accountNotificationChannel = null;
            }
        }
        catch { /* ignore */ }

        _subscribedUserId = Guid.Empty;
        await Task.CompletedTask;
    }

    private async Task UnsubscribeAccountAsync()
    {
        _desiredUserId = Guid.Empty;
        await UnsubscribeAccountChannelsAsync();
        CancelReconnectIfIdle();
    }

    public async Task UnsubscribeAccountOnlyAsync() => await UnsubscribeAccountAsync();

    // ── Reconnect supervisor ────────────────────────────────────────────────
    /// <summary>
    /// Public hook so app-foreground / connectivity flows can request a heal.
    /// Safe to call repeatedly; only one reconnect loop ever runs at a time.
    /// </summary>
    public Task ReconnectAsync()
    {
        ScheduleReconnect("manual");
        return Task.CompletedTask;
    }

    private void ScheduleReconnect(string reason)
    {
        lock (_reconnectLock)
        {
            if (_reconnecting) return;
            if (_desiredCompanyId == Guid.Empty && _desiredUserId == Guid.Empty) return;
            _reconnecting = true;
            _reconnectCts?.Cancel();
            _reconnectCts = new CancellationTokenSource();
        }
        _ = ReconnectLoopAsync(reason, _reconnectCts.Token);
    }

    private async Task ReconnectLoopAsync(string reason, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested
                   && (_desiredCompanyId != Guid.Empty || _desiredUserId != Guid.Empty))
            {
                _reconnectAttempt++;
                var delay = ComputeBackoff(_reconnectAttempt);

                _telemetry.LogEvent("realtime_reconnect_attempt", new Dictionary<string, string>
                {
                    ["attempt"] = _reconnectAttempt.ToString(),
                    ["reason"] = reason,
                    ["delay_ms"] = delay.TotalMilliseconds.ToString("F0"),
                });

                try { await Task.Delay(delay, ct); }
                catch (OperationCanceledException) { return; }
                if (ct.IsCancellationRequested) return;

                try
                {
                    // Force a fresh socket + channel set.
                    _connected = false;
                    var ok = true;

                    if (_desiredCompanyId != Guid.Empty)
                    {
                        var target = _desiredCompanyId;
                        await SubscribeAsync(target);
                        ok &= _subscribedCompanyId == target;
                    }

                    if (_desiredUserId != Guid.Empty)
                    {
                        var target = _desiredUserId;
                        _subscribedUserId = Guid.Empty; // force re-subscribe
                        await EnsureAccountSubscriptionAsync();
                        ok &= _subscribedUserId == target;
                    }

                    if (ok)
                    {
                        _telemetry.LogSuccess("realtime_reconnect_success", nameof(ReconnectLoopAsync),
                            new Dictionary<string, string> { ["attempts"] = _reconnectAttempt.ToString() });
                        _reconnectAttempt = 0;
                        return;
                    }

                    _telemetry.LogWarning("realtime_reconnect_failed", nameof(ReconnectLoopAsync),
                        new Dictionary<string, string>
                        {
                            ["attempt"] = _reconnectAttempt.ToString(),
                            ["reason"] = reason,
                        });
                }
                catch (Exception ex)
                {
                    _telemetry.LogWarning("realtime_reconnect_failed", nameof(ReconnectLoopAsync),
                        new Dictionary<string, string>
                        {
                            ["attempt"] = _reconnectAttempt.ToString(),
                            ["error"] = ex.Message,
                        });
                }
            }
        }
        finally
        {
            lock (_reconnectLock) { _reconnecting = false; }
        }
    }

    // Successful (re)subscribe resets backoff and stops any pending reconnect loop.
    private void OnReconnectSucceeded()
    {
        lock (_reconnectLock)
        {
            _reconnectAttempt = 0;
            _reconnectCts?.Cancel();
        }
    }

    private void CancelReconnectIfIdle()
    {
        lock (_reconnectLock)
        {
            if (_desiredCompanyId == Guid.Empty && _desiredUserId == Guid.Empty)
                _reconnectCts?.Cancel();
        }
    }

    private static TimeSpan ComputeBackoff(int attempt)
    {
        // Exponential 2s, 4s, 8s, 16s, 32s, capped at 60s, with light jitter to avoid thundering herds.
        var exp = Math.Min(attempt - 1, 5);
        var baseMs = Math.Min(MaxBackoffSeconds * 1000.0, 2000.0 * Math.Pow(2, exp));
        var jitter = Random.Shared.Next(0, 750);
        return TimeSpan.FromMilliseconds(baseMs + jitter);
    }

    public void Dispose()
    {
        _state.StateChanged -= OnStateChanged;
        Connectivity.ConnectivityChanged -= OnConnectivityChanged;
        lock (_reconnectLock) { _reconnectCts?.Cancel(); }
        _ = UnsubscribeChannelsAsync();
        _ = UnsubscribeAccountChannelsAsync();
    }
}
