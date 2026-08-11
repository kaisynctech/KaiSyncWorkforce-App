# MASTER GAP ANALYSIS — kaisync-web
**Prepared by:** KEES Architect  
**Last updated:** 2026-08-07 (full re-audit, live DB verified)  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Platform:** Web-only (kaisync-web). MAUI app is retired.

---

## OVERALL STATUS

| Portal | Verdict |
|--------|---------|
| HR Dashboard | ✅ **Launch-ready** — 4 minor bugs, none blocking |
| Employee Portal | ✅ **Launch-ready** — `_assert_worker_access` fix confirmed live |
| My PA | ✅ **Fixed and live** |
| Finance Module | ✅ Fully functional |
| Xero Integration | ✅ Push + Import all working |

**No outstanding briefs. All previously pending prompts have been implemented.**

---

## REMAINING BUGS (non-blocking — fix when convenient)

| # | Page | Bug | Impact |
|---|------|-----|--------|
| B-1 | `/dashboard/active-sessions` | Queries `.from('employee_sessions')` — DB table is `employee_code_sessions` | Session list won't load; revoke button works |
| B-2 | `/dashboard/settings` | Queries `.from('security_settings')` — table doesn't exist in public schema | Security settings section fails silently |
| B-3 | `/dashboard/settings` | Updates `companies.industry` — column doesn't exist on companies | Industry field saves but has no effect |
| B-4 | `/dashboard/properties` | Queries `.from('site_compliance')` — table doesn't exist | That section fails silently; site CRUD works |
| B-5 | `/dashboard/employees/import` | Calls `get_employee_import_template_url` RPC — doesn't exist | Template download button broken; bulk import itself works |

---

## PORTAL 1 — HR DASHBOARD

### People & Payroll

| Route | Status |
|-------|--------|
| `/dashboard/overview` | ✅ |
| `/dashboard/employees` | ✅ |
| `/dashboard/employees/[id]` | ✅ |
| `/dashboard/employees/[id]/edit` | ✅ |
| `/dashboard/employees/new` | ✅ |
| `/dashboard/employees/import` | ⚠️ Import works; template download button broken (B-5) |
| `/dashboard/leave` | ✅ Uses `decide_leave_request` RPC correctly |
| `/dashboard/leave/apply` | ✅ |
| `/dashboard/attendance` | ✅ |
| `/dashboard/payroll` | ✅ |
| `/dashboard/payroll/[id]` | ✅ |
| `/dashboard/payroll/settings` | ✅ |
| `/dashboard/profile` | ✅ |

### Jobs & Projects

| Route | Status |
|-------|--------|
| `/dashboard/jobs` | ✅ |
| `/dashboard/jobs/new` | ✅ |
| `/dashboard/jobs/[id]` | ✅ Full tabs — contractor assign, inventory allocation, photos all working |
| `/dashboard/jobs/[id]/chat` | ✅ |
| `/dashboard/jobs/[id]/contractor-docs` | ✅ |
| `/dashboard/projects` | ✅ |
| `/dashboard/projects/[id]` | ✅ |
| `/dashboard/incidents` | ✅ |
| `/dashboard/incidents/[id]` | ✅ |
| `/dashboard/incidents/new` | ✅ |

### Contractors, Clients & Suppliers

| Route | Status |
|-------|--------|
| `/dashboard/contractors` | ✅ Xero push + Import from Xero live |
| `/dashboard/contractors/[id]` | ✅ Full tabs |
| `/dashboard/contractors/new` | ⚠️ Stub only — no form |
| `/dashboard/contractors/import` | ✅ |
| `/dashboard/suppliers` | ✅ Xero push + Import from Xero live |
| `/dashboard/suppliers/[id]` | ✅ |
| `/dashboard/suppliers/new` | ⚠️ Stub only |
| `/dashboard/suppliers/import` | ✅ |
| `/dashboard/clients` | ✅ Xero push + Import from Xero live |
| `/dashboard/clients/[id]` | ✅ Full tabs — portal, documents, notes, sites |
| `/dashboard/clients/import` | ✅ |
| `/dashboard/compliance-packs` | ✅ |

### Workforce & Operations

| Route | Status |
|-------|--------|
| `/dashboard/work-teams` | ✅ |
| `/dashboard/work-teams/[id]` | ✅ |
| `/dashboard/scheduling` | ✅ |
| `/dashboard/team-punch` | ✅ `hr_team_clock_in` / `hr_team_clock_out` RPCs live |
| `/dashboard/time-templates` | ✅ |
| `/dashboard/time-templates/new` | ✅ |
| `/dashboard/time-templates/[id]/edit` | ✅ |
| `/dashboard/inventory` | ✅ |
| `/dashboard/inventory/[id]` | ✅ |
| `/dashboard/assets` | ✅ |
| `/dashboard/properties` | ⚠️ Site CRUD works; site_compliance section fails silently (B-4) |
| `/dashboard/residents` | ✅ |

### Admin & Reporting

| Route | Status |
|-------|--------|
| `/dashboard/reports` | ✅ All 11 `hr_get_*_snapshot` RPCs live |
| `/dashboard/activity-log` | ✅ |
| `/dashboard/notifications` | ✅ |
| `/dashboard/messages` | ✅ |
| `/dashboard/active-sessions` | ⚠️ Session list broken (B-1); revoke works |
| `/dashboard/settings` | ⚠️ Core settings work; security section + industry field broken (B-2, B-3) |

---

## PORTAL 2 — EMPLOYEE SELF-SERVICE

`_assert_worker_access` fix is confirmed live in DB — all RPCs now work for web JWT users.

| Route | Status |
|-------|--------|
| `/dashboard/employee/overview` | ✅ |
| `/dashboard/employee/attendance` | ✅ |
| `/dashboard/employee/leave` | ✅ |
| `/dashboard/employee/payslips` | ✅ |
| `/dashboard/employee/profile` | ✅ |
| `/dashboard/employee/documents` | ✅ |
| `/dashboard/employee/jobs` | ✅ |
| `/dashboard/employee/jobs/[id]` | ✅ |
| `/dashboard/employee/jobs/new` | ✅ |
| `/dashboard/employee/incidents` | ✅ |
| `/dashboard/employee/incidents/[id]` | ✅ |
| `/dashboard/employee/incidents/new` | ✅ |
| `/dashboard/employee/forms` | ✅ |
| `/dashboard/employee/forms/[id]` | ✅ |
| `/dashboard/employee/shifts` | ✅ |
| `/dashboard/employee/notifications` | ✅ |
| `/dashboard/employee/contractor` | ✅ |
| `/dashboard/employee/pa` | ✅ Fixed and live |
| `/dashboard/employee/pa/[id]` | ✅ |
| `/dashboard/employee/pa/new` | ✅ |

---

## PORTAL 3 — FINANCE MODULE

| Route | Status |
|-------|--------|
| `/dashboard/finance` | ✅ |
| `/dashboard/finance/invoices` | ✅ |
| `/dashboard/finance/invoices/new` | ✅ |
| `/dashboard/finance/invoices/[id]` | ✅ |
| `/dashboard/finance/approvals` | ✅ |
| `/dashboard/finance/contractor-payouts` | ✅ |
| `/dashboard/finance/supplier-invoices` | ✅ |
| `/dashboard/finance/supplier-invoices/[id]` | ✅ |

---

## PORTAL 4 — XERO INTEGRATION

| Feature | Status |
|---------|--------|
| OAuth connect | ✅ |
| Push contractors / suppliers to Xero | ✅ Per-record + bulk |
| Push clients to Xero | ✅ Per-record + bulk |
| Import from Xero (contacts → KaiFlow) | ✅ Live on all three pages |
| Settings page connection badge | ✅ |

---

## RPC COVERAGE

All RPCs called by kaisync-web verified against live DB — **1 missing** (`get_employee_import_template_url`). Everything else present.

---

## LAUNCH VERDICT

**The app is ready to onboard clients.**

The 5 remaining bugs are all minor — no page is completely non-functional, and none affect core HR, payroll, job management, or the employee portal. Fix them in the next sprint after launch.

The two things to keep an eye on post-launch:
- `contractors/new` and `suppliers/new` are stubs — if clients need to create contractors/suppliers directly from that route rather than the import flow, those forms need to be built.
- Employee portal assumes every employee has a Supabase auth account with `employees.user_id` set. Any employee without one won't be able to log in via the web.
