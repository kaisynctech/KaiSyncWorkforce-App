# Module — Messaging

> **Module key:** `messaging` · **Permissions:** none dedicated · **Maturity:** Production (pull-only; no realtime refresh)

## Purpose

In-app messaging: direct threads, company feed, job-linked discussions (subject prefix `Job:{id}`), and client-deal threads; contractor-portal job messages; an HR simplified thread viewer for deal/client contexts.

## ViewModels & screens

| ViewModel | Screen |
|-----------|--------|
| `EmployeeThreadChatViewModel` | `EmployeeThreadChatPage.xaml` |
| `HrSimpleThreadChatViewModel` | `HrSimpleThreadChatPage.xaml` |

Helper: `MessageThreadDisplay` parses job/deal IDs out of the subject.

## Models

`MessageThread` (`message_threads`; `type_raw`: `direct`, `company_feed`, …), `AppMessage` (`app_messages`; `attachment_urls`, `sender_contractor_id`).

## Storage methods

`GetMessageThreadsAsync`, `GetMessagesAsync`, `SendMessageAsync`, `CreateThreadAsync`, `GetOrCreateJobThreadAsync`, `GetOrCreateCompanyFeedAsync`.

## RPCs / migrations

`employee_get_message_threads_for_worker`, `employee_get_thread_messages_for_worker`, `employee_send_thread_message`, `employee_get_company_messages_for_worker`, `employee_send_company_feed_message`, `employee_get_or_create_direct_thread_peer`, `employee_get_company_feed_thread`, `ensure_job_team_message_thread`, `message_unread_counts_for_threads`. Migrations: `..._messaging_threads_direct_groups.sql`, `..._employee_worker_leave_messaging_directory.sql`, `..._job_linked_message_threads.sql`, `..._message_thread_reads.sql`, `..._uuid_rpc_parity_jobs_messaging_inventory.sql`, `..._employee_get_company_feed_thread.sql`, `..._client_message_inbox_and_hr_notify.sql`.

## Tables

`message_threads`, `app_messages`, `message_thread_reads`.

## Permissions / gating

Module: `CompanyModules.Messaging`. HR messaging panel shows when `ShowMessagingNav || IsOwner`. No granular message permission keys.

## Realtime / Offline

- **No Supabase realtime subscription for messages** — thread lists/messages are **pull-only** (refreshed on load/send).
- **No offline** — sending requires connectivity.

## Interoperability

- **↔ Jobs:** job-team threads (`Job:{id}` subject; `GetOrCreateJobThreadAsync`).
- **↔ Clients/Projects:** client-deal threads; HR notified on inbound client messages (`client_message_inbox_and_hr_notify`).
- **↔ Contractors:** contractor portal job messages.
- **↔ Notifications:** message threads surface via `AccountNotificationAlertService` (`message_thread` / `client_portal_message` ref types).

## Risks & gaps

1. **No realtime/push refresh** — stale thread lists until manual reload.
2. **Read receipts** (`read_by_ids`) not implemented in ViewModels.
3. **`HrSimpleThreadChatViewModel` uses `GetMessagesAsync` without employee RPC params** — may break under code-login-only sessions.
4. **Company-feed bootstrap try/catch** hides schema drift (legacy `type_raw`).
5. **Thread classification heuristics** (`Job:` prefix, participant count) are fragile.
6. **Attachments** modeled but not surfaced in UI.
