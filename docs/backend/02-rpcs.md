# Backend — RPC Catalog (Security-Definer Functions)

## Why RPCs are the backbone

KaiFlow's field workers, contractors, and clients authenticate with **codes**, not Supabase Auth, so they operate under the **anon** role with no `auth.uid()`. Every RLS policy is `TO authenticated`, so anon callers cannot read or write tables directly via PostgREST.

The solution is **`SECURITY DEFINER` RPCs**: PostgreSQL functions that run with the function owner's privileges, validate the caller's identity/scope internally (codes, explicit `(p_company_id, p_employee_id)`, assignment checks), and return only permitted data. They are `GRANT EXECUTE ... TO anon, authenticated`.

```
Anon caller ──► .Rpc("employee_get_jobs_for_employee", { p_company_id, p_employee_id })
                       │  (SECURITY DEFINER, row_security off)
                       ├─ _employee_valid(company_id, employee_id)?
                       ├─ scope/visibility filter
                       └─ returns JSON rows
```

The MAUI app picks the path in `SupabaseStorageService` based on `IsCodeLoginSession()` (true when `_supabase.Auth.CurrentSession?.User?.Id` is empty). Code-login → RPC; HR/JWT → PostgREST (with RPC where definer privileges are needed).

> **Security caveat:** the `session_token` is used for refresh/revoke only; ongoing worker RPCs trust client-supplied UUIDs validated by existence (`_employee_valid`) and business rules, not by the token. Knowledge of the anon key + valid `(company_id, employee_id)` is sufficient to call worker RPCs. Documented as a hardening item in `roadmap/01-risks-and-technical-debt.md`.

## PGRST203 — the overload problem

PostgREST resolves functions by name + argument types, and JSON bodies don't reliably disambiguate PostgreSQL overloads. When both `fn(bigint,…)` and `fn(uuid,…)` existed during the UUID migration, PostgREST returned **PGRST203 "could not choose the best candidate function."**

**Fix pattern** (applied repeatedly):

```sql
DROP FUNCTION IF EXISTS public.<name>(bigint, ...);
CREATE OR REPLACE FUNCTION public.<name>(p_... uuid, ...) ... SECURITY DEFINER ...;
GRANT EXECUTE ON FUNCTION public.<name>(...) TO anon, authenticated;
```

Migrations doing this cleanup: `..._uuid_rpc_parity_jobs_messaging_inventory.sql`, `..._fix_employee_insert_punch_overload.sql`, `..._fix_incident_jobcard_feedback_rpc.sql`, `..._employee_create_job_enterprise.sql`.

**PGRST303** (expired JWT used on an anon call) is mitigated in `InitializeSessionAsync`, which signs out an expired persisted JWT before code-login so stale tokens don't block anon RPCs.

## Internal helper functions

| Helper | Purpose |
|--------|---------|
| `_employee_valid(company_id, employee_id)` | Existence/scoping check used by worker RPCs |
| `_employee_assigned_to_job(...)` | Job-assignment gate |
| `_employee_can_view_incident`, `_employee_can_manage_incident`, `_incident_apply_status` | Incident authorization/state machine |
| `user_company_ids()` | Authenticated tenant gate (RLS) |
| `has_permission`, `my_permissions`, `has_hr_role_permission` | Permission resolution (bigint-era; may be absent on uuid-only deploys) |

## RPC catalog by domain

### A. Code login & session
`employee_resolve_by_code`, `employee_sign_in_with_code`, `employee_refresh_code_session`, `employee_revoke_code_session`, `employee_get_my_memberships_by_code`
_(migration: `..._employee_code_login_supabase_sessions.sql`)_

### B. Attendance / leave / absence
`employee_insert_punch`, `employee_get_last_punch`, `employee_get_my_punches`, `employee_update_punch_address`, `hr_get_employees_last_punch`, `employee_is_on_leave_today`, `employee_get_leave_requests`, `employee_submit_leave_request`, `employee_update_pending_leave`, `employee_get_company_approved_leave`, `employee_upsert_daily_absence`
_(migrations: `..._employee_punch_rpcs.sql`, `..._punch_block_leave_absence.sql`, `..._fix_employee_insert_punch_overload.sql`, leave RPC migrations, `..._daily_absences_and_report_rpc.sql`)_

> `employee_insert_punch` server-side **blocks `in` punches** when the employee is on approved leave or has a `daily_absences` row for `current_date`. Note it checks `current_date`, not the punch's `p_date_time` — backdated clock-ins can bypass the absence check.

### C. Jobs / job cards / site visits
`employee_get_jobs_for_employee`, `employee_get_job_for_employee`, `employee_create_job`, `employee_update_job_status`, `employee_get_job_card_for_employee`, `employee_upsert_job_card`, `employee_get_checklist_for_job`, `employee_insert_checklist_item`, `employee_get_job_documents`, `employee_insert_job_document`, `employee_get_job_thread`, `append_job_photo`, `get_job_photo_urls`, `employee_job_site_open_visit`, `employee_job_site_sign_in`, `employee_job_site_sign_out`, `hr_set_job_assignments`
_(migrations: `..._employee_jobs_uuid_rpc_and_visibility_user_id.sql`, `..._employee_create_job_enterprise.sql`, `..._employee_job_card_persistence.sql`, `..._phase32_job_parity_worker_rpcs.sql`, `..._hr_append_job_photo.sql`, `..._get_job_photo_urls.sql`, `..._phase33_job_creator_ownership_backfill.sql`)_

### D. Incidents
`employee_insert_incident`, `employee_get_incidents`, `employee_get_incident`, `employee_get_own_incidents`, `employee_update_incident`, `employee_add_incident_comment`, `employee_get_incident_comments`, `employee_get_incident_status_history`, `employee_append_incident_photos` *(defined but unused by the app)*
_(migrations: `..._employee_insert_incident.sql`, `..._fix_incident_jobcard_feedback_rpc.sql`, `..._enterprise_incident_module.sql`)_

### E. Messaging / company feed
`employee_get_message_threads_for_worker`, `employee_get_thread_messages_for_worker`, `employee_send_thread_message`, `employee_get_company_messages_for_worker`, `employee_send_company_feed_message`, `employee_get_or_create_direct_thread_peer`, `employee_get_company_feed_thread`, `ensure_job_team_message_thread`, `message_unread_counts_for_threads`, `message_company_feed_unread_count`
_(migrations: `..._uuid_rpc_parity_jobs_messaging_inventory.sql`, `..._employee_worker_leave_messaging_directory.sql`, `..._employee_get_company_feed_thread.sql`, `..._job_linked_message_threads.sql`)_

### F. Inventory / contractors / workflows / calendar (worker)
`employee_get_inventory_items`, `employee_get_inventory_usage_for_job`, `employee_set_inventory_usage_for_job`, `employee_get_linked_contractors`, `employee_get_calendar_events_for_worker`, `employee_update_calendar_event_attendance`, workflow template/submit RPCs
_(migration: `..._uuid_rpc_parity_jobs_messaging_inventory.sql`, `..._phase3_worker_rpc_telemetry_and_parity.sql`)_

> **Known bug:** `employee_set_inventory_usage_for_job` references `stock_count` but the column is `quantity_on_hand` — worker stock deduction is likely broken on the code-login path.

### G. My PA
`sync_operational_pa_tasks`, `employee_get_pa_tasks`, `employee_create_pa_task`, `upsert_employee_pa_settings`, `employee_get_pa_settings`
_(migrations: `..._my_pa_uuid_and_job_manager_notify.sql`, `..._my_pa_rich_schema_and_sync.sql`, `..._my_pa_tier_features.sql`, `..._employee_code_email_parity.sql`)_

### H. Client portal (anon, code-based)
`client_resolve_by_code`, `client_portal_list_projects`, `client_portal_get_project`, `client_portal_add_document_link`, `client_portal_send_message`, `client_portal_get_deal_messages`, `client_portal_list_message_inbox`
_(migrations: `..._clients_portal_code.sql`, `..._client_portal_rpc.sql`, `..._client_portal_project_detail.sql`, `..._client_portal_enhancements.sql`, `..._client_portal_in_app_messaging.sql`, `..._client_message_inbox_and_hr_notify.sql`)_

> Portal RPCs exclude `client_deals.visibility = 'private'`.

### I. Contractor portal (anon, code-based)
`contractor_resolve_by_code`, `contractor_portal_list_jobs`, `contractor_portal_open_visit`, `contractor_portal_site_sign_in`, `contractor_portal_site_sign_out`, `contractor_portal_visit_history`, `contractor_portal_create_incident`, `contractor_portal_append_job_photo`, `contractor_portal_get_job_message`, `contractor_portal_send_job_message`
_(migration: `..._multi_job_contractor_portal_site_visits.sql`)_

### J. HR / registration / admin
`self_register_company`, `employee_self_register`, `approve_pending_employee`, `reject_pending_employee`, `hr_delete_employee_safe`, `hr_set_default_shift_template`, shift-template RPCs, `employee_get_my_memberships`, `employee_get_my_notifications`, `employee_mark_notification_read`, `notify_hr_*` / `trg_app_message_hr_notify_client` triggers
_(migrations: `..._hr_self_register_owner_employee.sql`, `..._employee_self_registration.sql`, `..._multi_company_memberships_notifications.sql`, etc.)_

### K. Telemetry
`employee_log_app_event` (anon-safe; sets `auth_user_id = null` after `_employee_valid`), `prune_old_app_events` (`service_role` only, 90-day retention)
_(migrations: `..._app_events_telemetry.sql`, `..._phase3_worker_rpc_telemetry_and_parity.sql`)_

## Dual-path examples in the client

- **Punch:** `InsertPunchAsync` calls `employee_insert_punch` (RPC); for HR/JWT it can fall back to a direct `From<TimePunch>().Insert`. The code-login path has **no fallback** — it throws (and the offline queue catches it).
- **Telemetry:** `AppTelemetry` uses `employee_log_app_event` for code-login and a direct `app_events` insert for HR (see `reporting/01-reporting-and-telemetry.md`).
- **Permissions:** `GetMyPermissionsAsync` calls `my_permissions`; if absent/empty the app falls back to `PermissionDefaults`.

---

_Next: `backend/03-migrations.md` for the chronological history._
