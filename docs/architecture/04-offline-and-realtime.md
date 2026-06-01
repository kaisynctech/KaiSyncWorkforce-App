# 04 — Offline & Realtime Architecture

KaiFlow is built for **field use on unreliable networks**. Two complementary subsystems provide responsiveness and resilience:

- **Realtime** (`RealtimeService`) — pushes server-side changes to the UI live.
- **Offline queue** (`OfflineQueueService`) — captures field actions locally and replays them when connectivity returns.

Both are registered as singletons in `MauiProgram.cs` and both route telemetry through `AppTelemetry`.

## Realtime architecture

`Services/RealtimeService.cs` wraps the Supabase Realtime client. The Supabase client is created with `AutoConnectRealtime = false` so realtime never blocks startup; `AppShell` resolves `RealtimeService` on a background task after first paint.

### Connection lifecycle

- Realtime connects **lazily** the first time a subscription is needed (`_supabase.Realtime.ConnectAsync()` guarded by a `_connected` flag).
- `RealtimeService` listens to `TimesheetStateService.StateChanged`. When the current company changes, it (re)subscribes to that company's channels; when the company clears (sign-out), it unsubscribes. This keeps subscriptions correctly scoped to the active tenant.

```41:48:KaiFlow.Timesheets.Maui/Services/RealtimeService.cs
    private void OnStateChanged(object? sender, EventArgs e)
    {
        var company = _state.CurrentCompany;
        if (company != null && company.Id != _subscribedCompanyId)
            _ = SubscribeAsync(company.Id);
        else if (company == null && _subscribedCompanyId != Guid.Empty)
            _ = UnsubscribeAsync();
    }
```

### Company-scoped channels

On `SubscribeAsync(companyId)`, three Postgres-change channels are opened, each **filtered by `company_id`**:

| Channel | Table | Listen type | Event raised |
|---------|-------|-------------|--------------|
| Punch | `time_punches` | Inserts | `PunchChanged` |
| Leave | `leave_requests` | All | `LeaveChanged` |
| Incident | `incident_reports` | All | `IncidentChanged` |

### Account-scoped channels

`EnsureAccountSubscriptionAsync()` subscribes per **authenticated user id** (`auth.uid`):

| Channel | Table (filter) | Event raised |
|---------|----------------|--------------|
| Employee/membership | `employees` (`user_id`) | `MembershipChanged` |
| Account notifications | `app_notifications` (`recipient_auth_user_id`) | `AccountNotificationChanged` |

`AccountNotificationAlertService` consumes `AccountNotificationChanged` to surface in-app alerts / unread counts.

### Consumption pattern

ViewModels subscribe to the `EventHandler` events (e.g. `PunchChanged`, `LeaveChanged`) and reload their data when fired. Because the events are plain `EventHandler`s, subscribers are responsible for **marshaling to the UI thread** when mutating bound collections, and for **unsubscribing** on teardown to avoid leaks.

### Optimistic local echo

Realtime is complemented by **manual local notifications**: after a punch or incident is saved locally, the originating flow calls `NotifyPunchChanged()` / `NotifyIncidentChanged()` so the UI updates immediately without waiting for the server round-trip.

```28:31:KaiFlow.Timesheets.Maui/Services/RealtimeService.cs
    public void NotifyPunchChanged() => PunchChanged?.Invoke(this, EventArgs.Empty);

    public void NotifyIncidentChanged() => IncidentChanged?.Invoke(this, EventArgs.Empty);
```

### Resilience

- All subscribe/unsubscribe paths are wrapped in try/catch and log warnings via telemetry rather than crashing — a realtime failure degrades to manual refresh, it does not break the app.
- `Dispose()` detaches the state handler and removes all channels.

### Known reconnect gap

There is **no explicit auto-reconnect/backoff loop** for the realtime socket itself. If the underlying websocket drops mid-session, recovery currently relies on the next `StateChanged`-driven resubscribe or app foregrounding. This is called out in `roadmap/01-risks-and-technical-debt.md` as a hardening target.

## Offline architecture

`Services/OfflineQueueService.cs` persists field actions that fail (or are made while offline) and replays them automatically.

### What is queued

Two queues, persisted to **`SecureStorage`** as JSON:

| Queue | Storage key | Model | Replay calls |
|-------|-------------|-------|--------------|
| Punches | `offline_punch_queue` | `TimePunch` | `IStorageService.InsertPunchAsync` |
| Incidents | `offline_incident_queue` | `PendingIncident` (incident + local photo paths) | `IStorageService.CreateIncidentAsync` |

> Offline support is deliberately scoped to the **two highest-value field-capture actions** — clocking and incident reporting. Other writes (jobs, payroll, etc.) are online operations.

### Enqueue → persist → replay

1. **Enqueue:** `EnqueuePunchAsync` / `EnqueueIncidentAsync` append to the in-memory list, persist to SecureStorage, and emit telemetry (`offline_punch_enqueued`, `offline_incident_enqueued`) with the new queue size.
2. **Trigger:** the service subscribes to `Connectivity.ConnectivityChanged`. When internet returns and a queue is non-empty, `ReplayQueueAsync()` runs automatically.

```161:165:KaiFlow.Timesheets.Maui/Services/OfflineQueueService.cs
    private async void OnConnectivityChanged(object? sender, ConnectivityChangedEventArgs e)
    {
        if (e.NetworkAccess == NetworkAccess.Internet && (QueuedCount > 0 || QueuedIncidentCount > 0))
            await ReplayQueueAsync();
    }
```

3. **Replay:** each item is retried individually. Successful items are dropped; failed items are **kept in a `remaining` list** and re-persisted, so replay is **idempotent-per-item and self-healing** (a poison item doesn't block the rest from replaying, and survivors are retried next time).
4. **Enrichment on replay:** queued punches missing an address are reverse-geocoded at replay time (`ILocationService.ReverseGeocodeAsync`) so the network-dependent geocode happens when connectivity is back.

### Conflict handling

- Replay is **append/insert-oriented** (punches and incidents are new rows), so there is no destructive merge. The server-side RPCs (`InsertPunchAsync`, `CreateIncidentAsync`) own validation (e.g., punch ordering, leave/absence blocking).
- There is currently **no dedup token** on queued items; if a punch both succeeds server-side and is retried due to a flaky response, a duplicate is possible. This is a known hardening item (idempotency keys) — see roadmap.

### Durability & failure modes

- Queue load happens in the constructor (`LoadQueuesAsync`); a corrupt payload is caught, logged (`LogError`), and reset to empty rather than crashing.
- `ClearQueueAsync` exists for sign-out/reset.
- Because storage is `SecureStorage`, queued field data is encrypted at rest on device.

## How realtime + offline + telemetry interlock

```
 Field action (punch / incident)
        │
        ├── online ──► IStorageService RPC ──► Postgres ──► Realtime ──► other devices update
        │                                   └─► NotifyPunchChanged() (local echo)
        │
        └── offline ─► OfflineQueueService (SecureStorage)
                           │  (Connectivity restored)
                           └─► ReplayQueueAsync ──► IStorageService RPC ──► Postgres ──► Realtime
        every step ──► AppTelemetry.LogEvent ──► app_events
```

---

_See `modules/attendance.md` and `modules/incidents.md` for the module-level flows, and `reporting/01-reporting-and-telemetry.md` for telemetry._
