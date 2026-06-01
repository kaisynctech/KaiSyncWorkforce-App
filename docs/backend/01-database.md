# Backend — Database (Supabase / PostgreSQL)

> Source of truth: `KaiFlow.Timesheets.Maui/supabase/migrations` (161 `.sql` files). Production project ref: `vcivtjwreybaxgtdhtou`.

## Supabase architecture

KaiFlow uses four Supabase capabilities:

| Capability | Use |
|-----------|-----|
| **PostgreSQL** | All domain data; schema is migration-versioned |
| **GoTrue Auth** | HR/email JWT sessions; anon role for code-login/portals |
| **Realtime** | Postgres-change subscriptions (punches, leave, incidents, memberships, notifications) |
| **Storage** | `workforce-media` bucket for documents and photos |

## UUID strategy & the bigint→UUID cutover

The schema went through a **hard cutover** from `bigint` primary keys to **`uuid`**, aligning the database with the MAUI `Guid` models.

1. **Pre-UUID (Apr 28 – May 12, 2026):** original schema used `bigint` PKs/FKs and bigint RPC arguments.
2. **The drop (May 15):** `20260515154722_uuid_schema_v2_drop_legacy.sql` **CASCADE-drops** the legacy bigint world (`companies`, `employees`, `hr_users`, `jobs`, `company_role_permissions`, messaging, payroll, etc.).
3. **The rebuild (May 15):** batches 1–7 recreate the domain in UUID:
   - `..._uuid_v2_batch1_core.sql` → companies, employees, company_relationships
   - `..._batch2_sites_jobs.sql`, `..._batch3_job_detail_contractors.sql`, `..._batch4_attendance_payroll.sql`, `..._batch5_inventory_assets_compliance.sql`, `..._batch6_tasks_workflows_messaging.sql`, `..._batch7_rls_and_policies.sql`
4. **Straggler conversions:** `client_deals` (`..._client_deals_uuid_foundation.sql`), `inventory_items.supplier_contractor_id` (`..._partners_inventory_supplier_uuid.sql`), `app_notifications` (`..._multi_company_memberships_notifications.sql`).
5. **RPC parity:** worker/HR functions re-declared with `uuid` args; legacy bigint overloads **explicitly dropped** to fix PostgREST `PGRST203` ambiguity (see `backend/02-rpcs.md`).

> **Documentation debt:** several pre-cutover constructs are referenced by later code/policies but were dropped — notably `hr_users` and `company_role_permissions`. See "Critical schema notes" below and `roadmap/01-risks-and-technical-debt.md`.

## Company scoping (the universal boundary)

Nearly every tenant table carries:

```sql
company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
```

This is the multi-tenant isolation key, enforced by RLS for authenticated users and inside RPCs for anon users. `companies` itself is the tenant root.

> **There is no `employee_memberships` table.** Multi-company membership is modeled as **multiple `employees` rows sharing a `user_id`/`profile_id`**, plus `company_relationships` for HR ownership/role mapping.

## Core table catalog

### Foundation / identity

| Table | Key columns | Notes |
|-------|-------------|-------|
| `companies` | `id`, `code`, `name`, `owner_user_id`→`auth.users`, `plan_code`, `enabled_modules` (jsonb), `custom_settings`, `dispatch_settings` | Tenant root |
| `employees` | `id`, `user_id`/`profile_id`→`auth.users`, `company_id`, `employee_code`, `access_level`, `worker_type`, `registration_status`, pay rates, statutory fields, banking | One row per person-per-company |
| `company_relationships` | `user_id`, `company_id`, `role`, `is_active` | Source of `user_company_ids()`; auto-created on company insert |
| `employee_profiles` | `id`(=auth user), `email`, names | Global per auth user |
| `employee_code_sessions` | `session_token`, `employee_id`, `company_id`, codes, `expires_at` (90-day) | Code-login session store; RLS on, no SELECT policy |

### Sites / property

| Table | Key columns |
|-------|-------------|
| `clients` | `name`, `client_code`, `linked_company_id` |
| `sites` | `name`, `latitude`, `longitude`, `radius_meters`, optional `client_id` |
| `units` | `unit_number`, `site_id` |
| `residents` | `name`, `unit_id`, move dates |

### Jobs / field ops

| Table | Key columns |
|-------|-------------|
| `jobs` | `title`, `status`, `assignee_employee_id`, `assigned_employee_ids[]`, `deal_id`, `contractor_id`, `visibility`, `created_by_employee_id`, `job_code`, `photo_urls[]` |
| `job_cards` | `job_id`, `employee_id`, signatures, `checklist_items` (jsonb), times |
| `job_checklist_items` | `description`, `is_checked`, `sort_order` |
| `job_codes` | `code`, `description` |
| `job_documents` | `document_name`, `file_url` |
| `job_site_visits` | `party_type` (employee/contractor), sign-in/out geo |
| `job_feedback` | ratings / comments |

### CRM / client portal

| Table | Key columns |
|-------|-------------|
| `client_deals` | `title`, `status`, `offer_amount`, `job_id`, `visibility`, `manager_employee_id` — **UI label "Projects"** |
| `client_deal_updates` | progress notes |
| `client_deal_messages` | client ↔ HR messaging |
| `project_documents`, `project_quotation_lines`, `project_client_payments` | scoped by `deal_id` |

### Contractors / inventory

| Table | Key columns |
|-------|-------------|
| `contractors` | `name`, `contractor_code`, `partner_kind` (`contractor`/`supplier`/`both`), bank/profile fields |
| `contractor_member_links` | contractor ↔ employee |
| `inventory_items` | SKU, `quantity_on_hand`, `unit_cost`, `selling_price`, `reorder_level`, `supplier_contractor_id` (uuid→contractors) |
| `inventory_usage` | qty per job |

### Attendance / payroll

| Table | Key columns |
|-------|-------------|
| `time_punches` | `type`, `date_time`, geo, `job_id` — **canonical punch table** (not `punches`) |
| `daily_absences` | absence reporting |
| `leave_requests` | dates, `status`, `leave_type`, attachment fields |
| `payment_approvals` | period, hours, gross/net, breakdown (jsonb), `policy_snapshot`, `audit_log`, `shared_with_employee`, version, YTD |
| `payroll_period_locks` | PK `(company_id, period_start, period_end)` |
| `employee_salary_history` | effective-dated salary |
| `employee_shift_templates` | paid hours, `breaks` (jsonb), `is_default` |

### Incidents

| Table | Key columns |
|-------|-------------|
| `incident_reports` | `title`, `category`, `status`, `occurred_at`, geo, `assignee_id`, `contractor_id`, `photo_urls[]`, optional `job_id`/`site_id` |
| `incident_comments` | `body`, `author_employee_id` |
| `incident_status_history` | `old_status`, `new_status` |

### Messaging / notifications

| Table | Key columns |
|-------|-------------|
| `message_threads` | `subject`, `type` (`direct`/`company_feed`/…), `participant_ids[]`, `last_message_at` |
| `app_messages` | `thread_id`, `sender_id`, `sender_contractor_id`, `body`, `attachment_urls` |
| `message_thread_reads` | read tracking (lightly used) |
| `app_notifications` | `audience`, `recipient_employee_id`, `recipient_auth_user_id`, `dedupe_key` |
| `app_notification_deliveries` | push/email channel state |

### Productivity / forms / telemetry

| Table | Key columns |
|-------|-------------|
| `pa_tasks`, `pa_task_templates` | My PA tasks |
| `employee_pa_settings`, `employee_calendar_connections` | My PA config + external calendar |
| `workflow_form_templates`, `workflow_form_submissions` | Paperless forms |
| `calendar_events` | `attendee_ids`, `attendance_responses`, `event_type`, `linked_job_id` |
| `assets`, `compliance_entries` | Asset compliance |
| `app_events` | `id`(bigserial), `company_id`, `auth_user_id`, `screen`, `action`, `level`, `meta`(jsonb), `app_version` — **telemetry sink** |

## Row Level Security (RLS) model

### Tenant gate: `user_company_ids()`

- A `SECURITY DEFINER` helper that returns the `uuid[]` of companies the caller belongs to (avoids RLS recursion on `employees`).
- Originally derived from `employees.user_id` (batch7), then **redefined (May 18)** to read from `company_relationships WHERE user_id = auth.uid()`.

### Default policy pattern (authenticated)

Most company-scoped tables use:

```sql
USING (company_id = ANY(user_company_ids()))
WITH CHECK (company_id = ANY(user_company_ids()))
```

Applied to `clients`, `sites`, `units`, `residents`, `jobs`, `job_cards`, `time_punches`, `leave_requests`, `payment_approvals`, `inventory_*`, `incident_reports`, messaging, etc. **All policies are `TO authenticated` — the anon role has zero direct table access.**

### Special cases

- **`employees`:** own row via `user_id = auth.uid()`; peer-directory select for coworkers; legacy HR-select via `hr_users` (now dropped — potential stale policy).
- **`companies`:** select/update when `id = ANY(user_company_ids())`; insert requires a signed-in auth user.
- **`app_notifications`:** split HR vs employee policies by `audience` and `recipient_*`.
- **`app_events`:** insert requires authenticated user (auth_user_id = `auth.uid()` or null, company in `user_company_ids()`); **select restricted to company owner**.
- **`employee_code_sessions`:** RLS on, accessed only via RPC.

### Why anon users go through RPCs

Code-login workers, client-portal, and contractor-portal users run as **anon** (no `auth.uid()`), so they cannot satisfy any of the above policies. All their access is mediated by `SECURITY DEFINER` RPCs that enforce scoping internally — see `backend/02-rpcs.md` and `security/01-authentication.md`.

## Critical schema notes

1. **UUID v2 is a hard cutover** — migrations dated before 2026-05-15 reference bigint tables that no longer exist after the drop. Read the schema as "post-cutover" for production.
2. **`company_role_permissions` was dropped and not recreated for uuid.** `..._projects_jobs_view_all_permissions.sql` explicitly skips when the table is absent. Production permission enforcement therefore leans on the **client-side `PermissionDefaults`** fallback; server `my_permissions`/`has_permission` may be absent. This is a **permissions-drift risk** (see roadmap).
3. **`hr_users` references** survive in some older policies/RPCs but the table was dropped — reconcile against `company_relationships` + `employees.access_level`.
4. **`user_company_ids()` source changed** (May 18) from `employees` to `company_relationships` — affects every `ANY(user_company_ids())` policy.
5. **Dual messaging lineage:** bigint-era `app_message_threads` vs uuid `message_threads`/`app_messages`; worker RPCs target the uuid tables post-`uuid_rpc_parity`.
6. **`inventory_usage` worker RPC references `stock_count` while the column is `quantity_on_hand`** — a likely live bug on the code-login allocation path (HR manual path masks it). See `modules/inventory.md`.
7. **PGRST203 hygiene is ongoing** — never reintroduce a bigint overload beside a uuid function of the same name.

## Entity-relationship overview

```
companies 1───* employees           companies 1───* company_relationships
companies 1───* clients 1───* sites 1───* units 1───* residents
companies 1───* jobs ──┬─* job_cards
                       ├─* job_checklist_items
                       ├─* job_documents
                       ├─* job_site_visits
                       ├─* inventory_usage *───1 inventory_items *───1 contractors(supplier)
                       ├─* incident_reports ──┬─* incident_comments
                       │                       └─* incident_status_history
                       └─1 client_deals ──┬─* project_quotation_lines
                                          ├─* project_client_payments
                                          ├─* project_documents
                                          └─* client_deal_messages
employees 1───* time_punches          employees 1───* leave_requests
employees 1───* payment_approvals     employees 1───* pa_tasks
companies 1───* message_threads 1───* app_messages
companies 1───* app_notifications     companies 1───* app_events
```

---

_Next: `backend/02-rpcs.md` (the RPC catalog) and `backend/03-migrations.md` (the migration history)._
