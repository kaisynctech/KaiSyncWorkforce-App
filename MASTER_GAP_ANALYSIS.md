# MASTER GAP ANALYSIS — kaisync-web vs Full System
**Prepared by:** KEES Architect  
**Date:** 2026-07-16  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Source of truth:** Live DB RPC catalogue + confirmed table schema  

> **Mandate:** "Everything, every portal, every function needs to be exactly the same." This document is the definitive gap register. Nothing ships until every row in this document is ✅.

---

## HOW TO READ THIS DOCUMENT

**Status key:**
- ✅ **BUILT** — confirmed in kaisync-web, verified against live DB
- ⚠️ **PARTIAL** — page exists but has confirmed gaps (separate brief exists or needed)
- ❌ **MISSING** — not built at all
- 🔐 **AUTH NOTE** — this portal uses a different authentication mechanism

---

## PORTAL 1 — HR / MANAGEMENT DASHBOARD
**Auth:** Supabase Auth (email + password)  
**Route prefix:** `/dashboard/`  
**Who uses it:** Owners, HR admins, managers  

| # | Feature | Route | Status | Brief |
|---|---------|-------|--------|-------|
| 1 | Overview — KPIs, clock in/out, team attendance | `/dashboard/overview` | ⚠️ | Wave 3 shipped timer fix + realtime + progress bar |
| 2 | Employees — list, pending, search | `/dashboard/employees` | ✅ | Wave 1 fixed |
| 3 | Employee detail — 5 tabs | `/dashboard/employees/[id]` | ✅ | Wave 1 fixed |
| 4 | Employee edit | `/dashboard/employees/[id]/edit` | ✅ | Bank fix applied |
| 5 | Employee new | `/dashboard/employees/new` | ✅ | |
| 6 | Employee import | `/dashboard/employees/import` | ✅ | Wave 1 fixed |
| 7 | Leave — list, approve/reject | `/dashboard/leave` | ❌ | **Not audited — brief needed** |
| 8 | Leave apply | `/dashboard/leave/apply` | ❌ | **Not audited — brief needed** |
| 9 | Attendance — company-wide view | `/dashboard/attendance` | ✅ | Wave 1 fixed |
| 10 | Payroll — list, approve, pay | `/dashboard/payroll` | ❌ | **Not audited — brief needed** |
| 11 | Payroll detail | `/dashboard/payroll/[id]` | ❌ | **Not audited — brief needed** |
| 12 | Payroll settings | `/dashboard/payroll/settings` | ❌ | **Not audited — brief needed** |
| 13 | Jobs — list, filter | `/dashboard/jobs` | ✅ | Wave 1 fixed |
| 14 | Job new | `/dashboard/jobs/new` | ✅ | |
| 15 | Job detail — full tabs | `/dashboard/jobs/[id]` | ❌ | **Not audited — brief needed** |
| 16 | Job chat | `/dashboard/jobs/[id]/chat` | ❌ | **Not audited — brief needed** |
| 17 | Projects (client_deals) — list | `/dashboard/projects` | ✅ | Wave 1 fixed |
| 18 | Project detail | `/dashboard/projects/[id]` | ❌ | **Not audited — brief needed** |
| 19 | Incidents — list | `/dashboard/incidents` | ❌ | **Not audited — brief needed** |
| 20 | Incident detail | `/dashboard/incidents/[id]` | ❌ | **Not audited — brief needed** |
| 21 | Notifications | `/dashboard/notifications` | ✅ | Wave 1 fixed |
| 22 | My Profile — edit form | `/dashboard/profile` | ⚠️ | Wave 3 shipped photo/dirty/DOB/bank timestamp |
| 23 | My Profile — MY RECORD (payslips/leave/docs) | `/dashboard/profile/*` | ❌ | Wave 4 brief written — not yet shipped |
| 24 | Messages (DM + threads) | `/dashboard/messages` | ⚠️ | Wave 3 shipped unread/startDM/textarea |
| 25 | Contractors — list | `/dashboard/contractors` | ✅ | Bank fix applied |
| 26 | Contractor detail — tabs | `/dashboard/contractors/[id]` | ❌ | **Not audited — brief needed** |
| 27 | Contractor new | `/dashboard/contractors/new` | ❌ | Stub only |
| 28 | Clients — list | `/dashboard/clients` | ❌ | **Not audited — brief needed** |
| 29 | Client detail | `/dashboard/clients/[id]` | ❌ | **Not audited — brief needed** |
| 30 | Work Teams — list | `/dashboard/work-teams` | ❌ | **Not audited — brief needed** |
| 31 | Work Team detail | `/dashboard/work-teams/[id]` | ❌ | **Not audited — brief needed** |
| 32 | Scheduling | `/dashboard/scheduling` | ❌ | **Not audited — brief needed** |
| 33 | Team Punch | `/dashboard/team-punch` | ❌ | **Not audited — brief needed** |
| 34 | Time Templates — list | `/dashboard/time-templates` | ❌ | **Not audited — brief needed** |
| 35 | Time Template new/edit | `/dashboard/time-templates/new` + `/[id]/edit` | ❌ | **Not audited — brief needed** |
| 36 | Inventory — list | `/dashboard/inventory` | ❌ | **Not audited — brief needed** |
| 37 | Inventory detail | `/dashboard/inventory/[id]` | ❌ | **Not audited — brief needed** |
| 38 | Compliance Packs | `/dashboard/compliance-packs` | ❌ | **Not audited — brief needed** |
| 39 | Suppliers | `/dashboard/suppliers` | ❌ | **Not audited — brief needed** |
| 40 | Properties | `/dashboard/properties` | ❌ | **Not audited — brief needed** |
| 41 | Residents | `/dashboard/residents` | ❌ | **Not audited — brief needed** |
| 42 | Assets | `/dashboard/assets` | ❌ | **Not audited — brief needed** |
| 43 | Reports | `/dashboard/reports` | ❌ | **Not audited — brief needed** |
| 44 | Activity Log | `/dashboard/activity-log` | ❌ | **Not audited — brief needed** |
| 45 | Active Sessions | `/dashboard/active-sessions` | ❌ | **Not audited — brief needed** |
| 46 | Settings | `/dashboard/settings` | ❌ | **Not audited — brief needed** |

**HR Dashboard: 11 ✅ / 3 ⚠️ / 32 ❌**

---

## PORTAL 2 — EMPLOYEE SELF-SERVICE
**Auth:** Supabase Auth (same login as HR, role-based routing)  
**Route prefix:** `/dashboard/employee/` (needs to be created)  
**Who uses it:** employees with `access_level = 'employee'`  
**Current state:** ❌ DOES NOT EXIST — no routing, no sidebar, no pages  

| # | Feature | Route | DB RPC | Status |
|---|---------|-------|--------|--------|
| 1 | **Routing guard** — detect `access_level`, redirect employees away from HR dashboard | `proxy.ts` middleware | n/a | ❌ MISSING |
| 2 | **Employee sidebar** — different nav from HR | `Sidebar.tsx` or new `EmployeeSidebar.tsx` | n/a | ❌ MISSING |
| 3 | Employee Overview — own clock status, today's jobs | `/dashboard/employee/overview` | `employee_get_last_punch`, `employee_get_jobs_for_employee` | ❌ MISSING |
| 4 | Clock In / Clock Out | (part of overview) | `employee_insert_punch` | ❌ MISSING |
| 5 | My Jobs — list of own assigned jobs | `/dashboard/employee/jobs` | `employee_get_jobs_for_employee` | ❌ MISSING |
| 6 | Job detail — job card, checklist, photos, status | `/dashboard/employee/jobs/[id]` | `employee_get_job_for_employee`, `employee_get_job_card_for_employee`, `employee_get_checklist_for_job`, `employee_get_job_photo_urls` | ❌ MISSING |
| 7 | Job card — fill in work performed, materials, sign-off | `/dashboard/employee/jobs/[id]` | `employee_upsert_job_card`, `employee_update_job_status` | ❌ MISSING |
| 8 | Job checklist — tick off items | (part of job detail) | `employee_insert_checklist_item`, `employee_update_checklist_item` | ❌ MISSING |
| 9 | Job photos — upload before/during/after photos | (part of job detail) | `employee_append_job_photo`, `employee_get_job_photo_urls` | ❌ MISSING |
| 10 | Job site sign-in / sign-out | (part of job detail) | `employee_job_site_sign_in`, `employee_job_site_sign_out`, `employee_job_site_switch_to_job` | ❌ MISSING |
| 11 | Job feedback — rate & comment on job | (part of job detail) | `employee_submit_job_feedback` | ❌ MISSING |
| 12 | Job documents — view & upload | (part of job detail) | `employee_get_job_documents`, `employee_insert_job_document` | ❌ MISSING |
| 13 | My Leave — list own requests | `/dashboard/profile/leave` | `employee_get_leave_requests` | ⚠️ Wave 4 brief covers VIEW only |
| 14 | Apply for leave | `/dashboard/employee/leave/apply` | `employee_submit_leave_request` | ❌ MISSING |
| 15 | Edit pending leave request | `/dashboard/employee/leave/[id]/edit` | `employee_update_leave_request` | ❌ MISSING |
| 16 | My Attendance — own punch history | `/dashboard/employee/attendance` | `employee_get_my_punches` | ❌ MISSING |
| 17 | My Incidents — own filed incidents | `/dashboard/employee/incidents` | `employee_get_own_incidents` | ❌ MISSING |
| 18 | Incident detail | `/dashboard/employee/incidents/[id]` | `employee_get_incident`, `employee_get_incident_comments`, `employee_get_incident_status_history` | ❌ MISSING |
| 19 | File new incident | `/dashboard/employee/incidents/new` | `employee_insert_incident`, `employee_append_incident_photos` | ❌ MISSING |
| 20 | My Notifications | `/dashboard/employee/notifications` | `employee_get_my_notifications_for_employee`, `employee_mark_notification_read_for_employee` | ❌ MISSING |
| 21 | Messages (DM + threads) | `/dashboard/messages` | same RPCs as HR — already built | ✅ Reuse existing |
| 22 | Company Feed — company-wide broadcast thread | `/dashboard/employee/feed` | `employee_get_company_feed_thread`, `employee_get_company_messages_for_worker`, `employee_send_company_feed_message`, `employee_mark_company_feed_read_for_worker` | ❌ MISSING |
| 23 | My Calendar — events, RSVP | `/dashboard/employee/calendar` | `employee_get_calendar_events_for_worker`, `employee_update_calendar_event_attendance` | ❌ MISSING |
| 24 | My Tasks (PA Tasks) — personal task manager | `/dashboard/employee/tasks` | `employee_get_pa_tasks`, `employee_insert_pa_task`, `employee_update_pa_task`, `employee_update_pa_task_status`, `employee_delete_pa_task` | ❌ MISSING |
| 25 | My Work Teams — teams the employee belongs to | `/dashboard/employee/teams` | `employee_get_work_teams` | ❌ MISSING |
| 26 | Workflow Forms — fill in company forms | `/dashboard/employee/forms` | `employee_get_workflow_form_templates`, `employee_get_workflow_form_submissions`, `employee_submit_workflow_form` | ❌ MISSING |
| 27 | My Profile — edit + MY RECORD | `/dashboard/profile` | already built + Wave 4 brief | ⚠️ Reuse — Wave 4 ships MY RECORD |
| 28 | My Inventory — view & log usage on jobs | (part of job detail) | `employee_get_inventory_items`, `employee_set_inventory_usage_for_job` | ❌ MISSING |

**Employee Portal: 1 ✅ / 2 ⚠️ / 25 ❌**

---

## PORTAL 3 — CONTRACTOR PORTAL
**Auth:** 🔐 CODE-BASED — uses `p_company_code` + `p_contractor_code`. NOT Supabase Auth.  
**Route prefix:** `/portal/contractor/` (needs to be created — completely separate from `/dashboard/`)  
**Who uses it:** External contractors logging in with their company code + contractor code  
**Current state:** ❌ DOES NOT EXIST  

> **Critical auth note:** All `contractor_portal_*` RPCs take `p_company_code text` and `p_contractor_code text` — plain text identifiers, no Supabase session. The login screen for this portal does NOT use Supabase GoTrue. It calls the RPCs directly with the codes. The contractor's session is maintained via URL params or local state, not a Supabase JWT.

| # | Feature | Route | DB RPC | Status |
|---|---------|-------|--------|--------|
| 1 | **Contractor login** — enter company code + contractor code | `/portal/contractor/login` | (direct RPC call to get profile — validate codes) | ❌ MISSING |
| 2 | Contractor Dashboard / Home | `/portal/contractor` | n/a | ❌ MISSING |
| 3 | My Profile — view and edit | `/portal/contractor/profile` | `contractor_portal_get_profile`, `contractor_portal_update_profile` | ❌ MISSING |
| 4 | My Jobs — list of assigned jobs | `/portal/contractor/jobs` | `contractor_portal_list_jobs` | ❌ MISSING |
| 5 | Job detail — site sign-in/out, visit history | `/portal/contractor/jobs/[id]` | `contractor_portal_site_sign_in`, `contractor_portal_site_sign_out`, `contractor_portal_open_visit`, `contractor_portal_visit_history` | ❌ MISSING |
| 6 | Job photos — upload | (part of job detail) | `contractor_portal_append_job_photo` | ❌ MISSING |
| 7 | Job messages | (part of job detail) | `contractor_portal_get_job_messages`, `contractor_portal_send_job_message` | ❌ MISSING |
| 8 | File incident on job | (part of job detail) | `contractor_portal_create_incident` | ❌ MISSING |
| 9 | My Banking — view + submit/update banking details | `/portal/contractor/banking` | `contractor_portal_get_banking`, `contractor_portal_submit_banking`, `contractor_portal_get_pending_banking`, `contractor_portal_get_latest_banking_decision` | ❌ MISSING |
| 10 | My Documents — view + upload compliance docs | `/portal/contractor/documents` | `contractor_portal_get_documents`, `contractor_portal_insert_document` | ❌ MISSING |
| 11 | Compliance Pack — view required docs + status | `/portal/contractor/compliance` | `contractor_portal_get_compliance_pack` | ❌ MISSING |
| 12 | Quotes — list | `/portal/contractor/quotes` | `contractor_portal_list_quotes` | ❌ MISSING |
| 13 | Quote detail — view, edit draft, submit | `/portal/contractor/quotes/[id]` | `contractor_portal_get_quote`, `contractor_portal_save_quote_draft`, `contractor_portal_submit_quote`, `contractor_portal_resubmit_quote`, `contractor_portal_delete_draft` | ❌ MISSING |
| 14 | Upload quote PDF (alternative to line-item builder) | (part of quotes) | `contractor_portal_upload_quote` | ❌ MISSING |
| 15 | Payouts / Invoices — list | `/portal/contractor/payouts` | `contractor_portal_list_payouts` | ❌ MISSING |
| 16 | Submit invoice on job | (part of job detail) | `contractor_portal_submit_invoice`, `contractor_portal_resubmit_payout` | ❌ MISSING |

**Contractor Portal: 0 ✅ / 0 ⚠️ / 16 ❌**

---

## PORTAL 4 — CLIENT PORTAL
**Auth:** 🔐 CODE-BASED — uses `p_company_code` + `p_client_code`. NOT Supabase Auth.  
**Route prefix:** `/portal/client/` (needs to be created)  
**Who uses it:** External clients logging in to view their projects, invoices, and communicate with the company  
**Current state:** ❌ DOES NOT EXIST  

> **Critical auth note:** Same pattern as contractor portal. No Supabase session. Codes are passed directly to each RPC.

| # | Feature | Route | DB RPC | Status |
|---|---------|-------|--------|--------|
| 1 | **Client login** — enter company code + client code | `/portal/client/login` | (validate via `client_portal_list_projects` — if it returns data, codes are valid) | ❌ MISSING |
| 2 | Client Dashboard / Home | `/portal/client` | n/a | ❌ MISSING |
| 3 | My Projects — list of projects | `/portal/client/projects` | `client_portal_list_projects` | ❌ MISSING |
| 4 | Project detail — progress, docs, messages | `/portal/client/projects/[id]` | `client_portal_get_project` | ❌ MISSING |
| 5 | Project messages — discuss project with company | (part of project detail) | `client_portal_get_deal_messages`, `client_portal_send_message` | ❌ MISSING |
| 6 | Project documents — upload/link documents | (part of project detail) | `client_portal_register_document`, `client_portal_add_document_link` | ❌ MISSING |
| 7 | Messages inbox — all project conversations | `/portal/client/messages` | `client_portal_list_message_inbox` | ❌ MISSING |
| 8 | Invoices — list of invoices | `/portal/client/invoices` | `client_portal_list_invoices` | ❌ MISSING |

**Client Portal: 0 ✅ / 0 ⚠️ / 8 ❌**

---

## OVERALL SUMMARY

| Portal | Built | Partial | Missing | Total |
|--------|-------|---------|---------|-------|
| HR Dashboard | 11 | 3 | 32 | 46 |
| Employee Self-Service | 1 | 2 | 25 | 28 |
| Contractor Portal | 0 | 0 | 16 | 16 |
| Client Portal | 0 | 0 | 8 | 8 |
| **TOTAL** | **12** | **5** | **81** | **98** |

**12 out of 98 features confirmed working. 81 features missing entirely.**

---

## RECOMMENDED BUILD ORDER

### Phase A — Critical routing fix (blocks everything else)
1. Role-based routing in `proxy.ts` — employees go to `/dashboard/employee/`, HR stays on `/dashboard/`
2. Employee sidebar

### Phase B — Complete HR Dashboard (finish what's started)
Audit each remaining HR page in priority order:
1. Leave management (HR side — approve/reject)
2. Payroll (HR side — compute, approve, pay)
3. Job detail (full tabs — most complex)
4. Incidents (HR view)
5. Contractor detail (full tabs)
6. Client detail
7. Work Teams detail
8. Scheduling / Team Punch
9. All remaining stub pages (Properties, Residents, Assets, Inventory, Compliance, Suppliers, Reports, Settings, Activity Log, Active Sessions)

### Phase C — Employee Self-Service
1. Employee Overview + Clock In/Out
2. My Jobs (with job card, checklist, photos, site sign-in)
3. My Leave (view + apply + edit)
4. My Attendance history
5. My Incidents
6. My Notifications
7. Company Feed
8. My Calendar
9. My Tasks (PA)
10. My Work Teams
11. Workflow Forms

### Phase D — Contractor Portal
1. Login (code-based auth, no Supabase session)
2. Home / Profile
3. Jobs + site sign-in/out
4. Banking
5. Documents + Compliance
6. Quotes (most complex — line item builder + PDF upload)
7. Payouts / Invoices

### Phase E — Client Portal
1. Login (code-based auth)
2. Projects list + detail
3. Project messages
4. Documents
5. Invoices

---

## NOTES FOR MISSION BRIEF WRITING

**Contractor and Client portals use code-based auth** — the login flow must:
1. Accept company_code + contractor_code (or client_code) as form inputs
2. Call a portal RPC with those codes — if it returns data, codes are valid
3. Store the codes in a React context / localStorage for use on all subsequent pages
4. Pass codes to every RPC call (no Authorization header needed — the RPC itself validates)
5. The `proxy.ts` middleware must NOT intercept `/portal/*` routes with a Supabase session check — those routes are auth-exempt from Supabase but use their own code validation

**Employee portal reuses:**
- `/dashboard/profile` (My Profile + MY RECORD) — already built and role-agnostic
- `/dashboard/messages` (Messages) — already built and role-agnostic
- The same Supabase Auth session as HR users — only routing differs

**Each Mission Brief must include:**
- Full DB schema for every table queried
- Confirmed RPC signatures (args + return shape)
- Complete TypeScript implementation
- Zero assumptions, zero `// TODO` comments
- TypeScript verification step
- Manual verification checklist
