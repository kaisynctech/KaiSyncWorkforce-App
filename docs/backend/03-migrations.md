# Backend — Migration History

161 SQL migrations under `KaiFlow.Timesheets.Maui/supabase/migrations`, named `YYYYMMDDHHMMSS_description.sql` (apply order = timestamp order). They fall into three eras.

## Phase A — Pre-UUID legacy (Apr 28 – May 12, 2026)

The original bigint-keyed schema. Notable groups:

| Theme | Representative migrations |
|-------|---------------------------|
| Auth bootstrap | `..._remote_schema.sql`, `..._employee_email_auth.sql` (`employee_profiles`, `profile_id`, `link_employee_profile`) |
| Property / modules | `..._module_flags_and_property_management.sql`, `..._client_types_and_cascading_units.sql` |
| Assets / inventory | `..._asset_register.sql`, `..._inventory_allocations.sql`, `..._inventory_item_costs.sql` |
| Notifications | `..._app_notifications.sql`, `..._notification_delivery_channels.sql` |
| Contractors | `..._contractors_parent_and_members.sql`, `..._employee_contractor_scope_jobs.sql`, `..._contractor_visibility_and_member_scope.sql` |
| Ops / leave / messaging | `..._leave_requests_core.sql`, `..._ops_phase_next_clocking_costing_messages.sql`, `..._messaging_threads_direct_groups.sql` |
| Worker anon RPCs (bigint) | `..._employee_worker_leave_messaging_directory.sql` (establishes the "anon workers need RPCs" pattern) |
| Permissions & visibility | `..._role_permissions_matrix.sql`, `..._visibility_grants.sql`, `..._permissions_matrix_hardening_phase2.sql` |
| RLS recursion fixes | `..._fix_hr_users_rls_recursion.sql`, `..._fix_employees_policy_recursion.sql` |

## Phase B — UUID schema v2 cutover (May 15, 2026)

The pivotal day. **`..._uuid_schema_v2_drop_legacy.sql` CASCADE-drops the bigint world**, then seven batch migrations rebuild it in UUID with RLS:

| Batch | Establishes |
|-------|-------------|
| `batch1_core` | `companies`, `employees`, `company_relationships` (uuid; `owner_user_id`→`auth.users`) |
| `batch2_sites_jobs` | `clients`, `sites`, `units`, `residents`, `jobs` |
| `batch3_job_detail_contractors` | `job_cards`, `job_checklist_items`, `job_codes`, `contractors`, `contractor_member_links` |
| `batch4_attendance_payroll` | `time_punches`, `labor_entries`, `leave_requests`, `payment_approvals` |
| `batch5_inventory_assets_compliance` | `inventory_items`, `inventory_usage`, `assets`, `compliance_entries`, `incident_reports` |
| `batch6_tasks_workflows_messaging` | `pa_tasks`, `workflow_form_*`, `message_threads`, `app_messages`, `work_teams`, `calendar_events` |
| `batch7_rls_and_policies` | RLS on all v2 tables; `user_company_ids()` |

## Phase C — Post-UUID product expansion (May 18 – May 29, 2026)

Feature build-out on the uuid foundation:

| Theme | Migrations |
|-------|------------|
| Tenant membership helper | `..._add_user_company_ids_function_and_trigger.sql` (re-sources `user_company_ids()` from `company_relationships`) |
| Punch / leave / absence RPCs | `..._employee_punch_rpcs.sql`, `..._leave_requests_anon_rpc_and_attachment.sql`, `..._punch_block_leave_absence.sql` |
| Code login | `..._employee_code_login_supabase_sessions.sql` |
| Payroll engine | `..._flexible_payroll_engine.sql`, `..._payroll_upgrade_phase1.sql`, `..._payroll_hardening.sql`, `..._pay_full_salary_payslip_release.sql`, `..._employee_payroll_deductions.sql` |
| CRM / client portal | `..._client_deals_uuid_foundation.sql`, `..._clients_portal_code.sql`, `..._client_portal_rpc.sql`, `..._client_portal_in_app_messaging.sql` |
| Contractor portal | `..._multi_job_contractor_portal_site_visits.sql`, `..._partners_inventory_supplier_uuid.sql` |
| UUID RPC parity | `..._uuid_rpc_parity_jobs_messaging_inventory.sql`, `..._employee_jobs_uuid_rpc_and_visibility_user_id.sql`, `..._employee_job_card_persistence.sql` |
| Telemetry | `..._app_events_telemetry.sql`, `..._phase3_worker_rpc_telemetry_and_parity.sql` |
| Incidents / jobs enterprise | `..._employee_insert_incident.sql`, `..._enterprise_incident_module.sql`, `..._employee_create_job_enterprise.sql`, `..._phase32_job_parity_worker_rpcs.sql`, `..._phase33_job_creator_ownership_backfill.sql` |
| My PA | `..._my_pa_uuid_and_job_manager_notify.sql`, `..._my_pa_rich_schema_and_sync.sql`, `..._my_pa_tier_features.sql` |

## The most important migrations (and what each establishes)

| Migration | Establishes |
|-----------|-------------|
| `..._uuid_schema_v2_drop_legacy.sql` | **Destructive reset** of the bigint schema before the uuid rebuild |
| `..._uuid_v2_batch1_core.sql` … `batch7_rls_and_policies.sql` | The entire uuid domain + RLS |
| `..._add_user_company_ids_function_and_trigger.sql` | Tenant gate sourced from `company_relationships` |
| `..._employee_code_login_supabase_sessions.sql` | Field-worker code login (`employee_code_sessions` + resolve/sign-in/refresh/revoke RPCs) |
| `..._employee_worker_leave_messaging_directory.sql` | The anon-worker-RPC pattern |
| `..._employee_punch_rpcs.sql` | UUID punch RPCs granted to anon |
| `..._punch_block_leave_absence.sql` | Server-side clock-in blocking on leave/absence |
| `..._uuid_rpc_parity_jobs_messaging_inventory.sql` | Mass bigint-overload drop + uuid worker RPCs (jobs/messaging/inventory) |
| `..._client_deals_uuid_foundation.sql` | CRM project entity in uuid + job link |
| `..._multi_job_contractor_portal_site_visits.sql` | Contractor portal + `job_site_visits` + contractor codes |
| `..._client_portal_in_app_messaging.sql` | Client ↔ HR deal messaging + HR notify |
| `..._app_events_telemetry.sql` | Telemetry `app_events` table + RLS + retention |
| `..._phase3_worker_rpc_telemetry_and_parity.sql` | `employee_log_app_event` + calendar/workflow/contractor parity |
| `..._enterprise_incident_module.sql` | Incident comments, status history, full incident RPC API |
| `..._employee_create_job_enterprise.sql` | `employee_create_job`, `created_by_employee_id`, PGRST203 cleanup |
| `..._flexible_payroll_engine.sql` | Itemized payroll breakdown + employee statutory fields |
| `..._payroll_upgrade_phase1.sql` | `payroll_period_locks`, `employee_salary_history`, YTD, payslip-release trigger |
| `..._multi_company_memberships_notifications.sql` | UUID `app_notifications` + membership RPCs |

## May 29, 2026 — Finance + production hardening (deployed)

| Migration | Establishes |
|-----------|-------------|
| `20260529100000_app_events_hr_read.sql` | HR `app_events` read policy via `user_company_ids()` |
| `20260529200000_finance_module_foundation.sql` | Enterprise finance schema; `project_id` → `client_deals(id)` |
| `20260529210000_finance_approvals_audit.sql` | Finance audit log + approval workflow columns |
| `20260529220000_finance_portal_rpcs.sql` | Portal finance read RPCs |
| `20260529230000_inventory_usage_stock_fix.sql` | Inventory stock atomicity fix |
| `20260529240000_punch_idempotency.sql` | Offline punch idempotency |
| `20260529250000_worker_session_validation.sql` | Worker session hardening |
| `20260529300000_saas_platform_foundation.sql` | SaaS plans, subscriptions, feature flags, platform admin RPCs |
| `20260529310000_saas_employee_count_sync.sql` | Trigger: sync `saas_company_subscriptions.current_employee_count` from `employees` |
| `20260529320000_production_ops_foundation.sql` | App versions, feature flags, company settings, backups, application errors |
| `20260529330000_platform_saas_admin_billing.sql` | `company_subscriptions`, `platform_feedback`, billing RPCs, platform admin dashboard, health scoring, owner seed |
| `20260529340000_website_app_versions_public.sql` | `list_public_app_versions` RPC for website release history |
| `20260529350000_app_versions_download_url_aliases.sql` | RPC aliases `windows_download_url`, `android_download_url` |

## Operational artifacts

- Pre-deploy snapshots / rollback notes live under `supabase/snapshots/` (e.g. `20260528-pre-parity-deploy/ROLLBACK.md`, `20260528-phase3-enterprise-readiness/PHASE3_REPORT.md`).
- Several migrations are explicit **smoke tests** (`..._client_deals_smoke_test.sql`, `..._client_portal_rpc_smoke_test.sql`) and **fix-ups** (`fix_*`, `sanitize_*`).

## Migration discipline rules (for new work)

1. **Never reintroduce a bigint RPC overload** next to a uuid function of the same name (PGRST203).
2. **Forward-only:** the schema assumes the uuid cutover has been applied. Don't write migrations that depend on dropped bigint tables (`hr_users`, bigint `company_role_permissions`).
3. **Keep `GRANT EXECUTE … TO anon`** on any new worker/portal RPC, and validate scope with `_employee_valid` / assignment helpers.
4. **Company-scope every new table** with `company_id uuid REFERENCES companies(id)` and add `user_company_ids()`-based RLS.
5. **Pair sensitive changes (payroll, punches) with a snapshot/rollback note.**

---

_See `security/01-authentication.md` for how these RPCs are reached at runtime._
