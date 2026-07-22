# MISSION BRIEF — Module Audit Wave 1
**Project:** kaisync-web (Next.js)  
**Prepared by:** KEES Architect  
**Date:** 2026-07-16  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Status:** READY FOR ENGINEERING EXECUTION

---

## EXECUTIVE SUMMARY

A full audit of the web app's Employees, Attendance, Jobs, and Projects modules reveals systematic data layer failures. The root cause is a phantom table: the web app was written against a `timesheet_punches` schema that **does not exist** in the database. The real table is `time_punches`, with a fundamentally different schema. Additionally, the Projects module queries a `projects` table that also **does not exist** — the correct table is `client_deals`. These are not cosmetic bugs; they are the reason every attendance-related view shows nothing.

---

## DATABASE GROUND TRUTH

Confirmed live schema via Supabase MCP. Engineer must treat this as the authority.

### `time_punches` — the ONLY attendance table
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `company_id` | uuid | required |
| `employee_id` | uuid | required |
| `type` | text | `'in'` or `'out'` — separate rows per punch |
| `date_time` | timestamptz | the punch timestamp |
| `latitude` | float | nullable |
| `longitude` | float | nullable |
| `address` | text | nullable |
| `job_id` | uuid | nullable |
| `notes` | text | nullable |
| `punched_by_manager_id` | uuid | nullable |

**Does NOT have:** `punch_in`, `punch_out`, `hours_worked`  
**`timesheet_punches` DOES NOT EXIST.**

### `employees` — key fields for bug fixes
- `registration_status` text (NOT NULL) — values include `'pending'`, `'active'`
- `is_active` boolean (NOT NULL) — `false` = terminated, NOT pending

### `work_teams`
- Has `company_id` column — must always be filtered by it

### `jobs`
- Assignment columns: `assignee_employee_id` (single) + `assigned_employee_ids` (uuid[])
- There is NO column named `assigned_employee_id`

### `client_deals` — this IS the Projects table
- `projects` table **DOES NOT EXIST**
- All project data lives in `client_deals`
- Related: `project_documents`, `project_quotation_lines`, `project_client_payments`, `project_contractors`

### `payroll_settings` — does NOT exist
- The attendance page queries this table — it will silently fail

---

## MODULE 1: ATTENDANCE PAGE
**File:** `src/app/dashboard/attendance/page.tsx`

### Bugs

**BUG-ATT-1 — Wrong table name (CRITICAL, causes blank page)**  
Line 209: `from('timesheet_punches')` → must be `from('time_punches')`

**BUG-ATT-2 — Wrong column names in filter and order (CRITICAL)**  
Lines 212–214: filters on `punch_in` and orders by `punch_in` — this column does not exist.  
Replace with `date_time`.
```
// WRONG:
.gte('punch_in', `${from}T00:00:00`)
.lte('punch_in', `${to}T23:59:59`)
.order('punch_in', { ascending: false })

// CORRECT:
.gte('date_time', `${from}T00:00:00`)
.lte('date_time', `${to}T23:59:59`)
.order('date_time', { ascending: false })
```

**BUG-ATT-3 — Wrong schema model: paired rows, not paired columns (CRITICAL)**  
`time_punches` stores one row per punch with `type='in'` or `type='out'`. There are no `punch_in`/`punch_out` column pairs. The `buildSessions()` function assumes the old schema and must be completely replaced.

The correct approach:
1. Fetch all `time_punches` for the company/date range, ordered by `date_time ASC`
2. Group by `employee_id`
3. For each employee, walk the punches in order and pair each `type='in'` with the next `type='out'` to form a session
4. Hours = `(punchOut.date_time - punchIn.date_time)` in hours
5. Pay = `hours * employee.hourly_rate`
6. An open session (no matching out) = status `'active'`

**BUG-ATT-4 — Realtime subscription on wrong table**  
Line 188: `table: 'timesheet_punches'` → must be `table: 'time_punches'`

**BUG-ATT-5 — Queries non-existent `payroll_settings` table**  
Line 163: `from('payroll_settings')` — this table does not exist, query will always return null. This is non-critical (falls back to defaults) but engineer should verify what payroll settings live in and update accordingly, or hardcode defaults.

**BUG-ATT-6 — `TimesheetPunch` type in `database.ts` is wrong**  
`src/types/database.ts` line 193 defines `TimesheetPunch` with `punch_in`, `punch_out`, `hours_worked`. This type is based on the phantom schema. Engineer must:
- Delete or rename `TimesheetPunch`
- Add a correct `TimePunch` type matching the live schema
- Update all imports across the codebase

### Required `TimePunch` type
```typescript
export interface TimePunch {
  id: string
  company_id: string
  employee_id: string
  type: 'in' | 'out'
  date_time: string
  latitude: number | null
  longitude: number | null
  address: string | null
  job_id: string | null
  notes: string | null
  created_at: string
  punched_by_manager_id: string | null
}
```

### Required session-building logic
```typescript
type PunchSession = {
  employeeId: string
  employeeName: string
  employeeCode: string
  punchIn: string       // date_time of the 'in' punch
  punchOut: string | null  // date_time of the 'out' punch, or null if open
  hoursWorked: number
  pay: number
  isLate: boolean
  isOvertime: boolean
  status: 'active' | 'completed'
}

function buildSessions(
  punches: TimePunch[],
  employees: Map<string, { name: string; surname: string; employee_code: string | null; hourly_rate: number }>,
  lateThreshold: number,
  otThreshold: number
): PunchSession[] {
  // Group by employee
  const byEmployee = new Map<string, TimePunch[]>()
  for (const p of punches) {
    if (!byEmployee.has(p.employee_id)) byEmployee.set(p.employee_id, [])
    byEmployee.get(p.employee_id)!.push(p)
  }

  const sessions: PunchSession[] = []

  for (const [empId, empPunches] of byEmployee) {
    // Sort ascending to pair correctly
    empPunches.sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime())
    const emp = employees.get(empId)

    let i = 0
    while (i < empPunches.length) {
      const p = empPunches[i]
      if (p.type === 'in') {
        const nextOut = empPunches.slice(i + 1).find(x => x.type === 'out')
        const punchOut = nextOut ?? null
        const hours = punchOut
          ? (new Date(punchOut.date_time).getTime() - new Date(p.date_time).getTime()) / 3600000
          : 0
        sessions.push({
          employeeId: empId,
          employeeName: emp ? `${emp.name} ${emp.surname}` : 'Unknown',
          employeeCode: emp?.employee_code ?? '',
          punchIn: p.date_time,
          punchOut: punchOut?.date_time ?? null,
          hoursWorked: hours,
          pay: hours * (emp?.hourly_rate ?? 0),
          isLate: false, // implement shift_start comparison if shift data available
          isOvertime: hours > otThreshold,
          status: punchOut ? 'completed' : 'active',
        })
        i = punchOut ? empPunches.indexOf(punchOut) + 1 : empPunches.length
      } else {
        i++ // orphaned 'out' punch — skip
      }
    }
  }

  // Sort sessions descending by punchIn for display
  sessions.sort((a, b) => new Date(b.punchIn).getTime() - new Date(a.punchIn).getTime())
  return sessions
}
```

### Required query rewrite
```typescript
// Fetch employees for this company to join manually
const { data: empData } = await supabase
  .from('employees')
  .select('id, name, surname, employee_code, hourly_rate')
  .eq('company_id', cid)
  .eq('is_active', true)

const empMap = new Map(
  (empData ?? []).map(e => [e.id, e])
)

const { data: punchData } = await supabase
  .from('time_punches')
  .select('id, employee_id, type, date_time, created_at')
  .eq('company_id', cid)
  .gte('date_time', `${from}T00:00:00`)
  .lte('date_time', `${to}T23:59:59`)
  .order('date_time', { ascending: true })

setSessions(buildSessions(punchData ?? [], empMap, lateThreshold, otThreshold))
```

---

## MODULE 2: EMPLOYEES LIST PAGE
**File:** `src/app/dashboard/employees/page.tsx`

### Bugs

**BUG-EMP-1 — `loadTeams()` missing `company_id` filter (CRITICAL data leak)**  
Line ~220: `from('work_teams').select('*').order('name')` — fetches ALL companies' teams.

Fix:
```typescript
const { data } = await supabase
  .from('work_teams')
  .select('*')
  .eq('company_id', companyId)   // ADD THIS LINE
  .order('name')
```

**BUG-EMP-2 — "Pending" tab uses wrong filter**  
The Pending tab filters `is_active = false` which returns terminated employees as well as pending ones. The `employees` table has a `registration_status` column (confirmed in live schema).

Fix: Filter `registration_status = 'pending'` instead of (or in addition to) `is_active = false`.

```typescript
// WRONG — includes terminated employees:
.eq('is_active', false)

// CORRECT — pending registrations only:
.eq('registration_status', 'pending')
```

**BUG-EMP-3 — RPC names confirmed** ✅  
`approve_pending_employee` and `reject_pending_employee` both exist in the live database. No change needed on the RPC names.

---

## MODULE 3: EMPLOYEE DETAIL PAGE
**File:** `src/app/dashboard/employees/[id]/page.tsx`

### Bugs

**BUG-EMP-DETAIL-1 — `loadAttendance()` wrong table and wrong columns (CRITICAL, blank tab)**  
The attendance tab queries `timesheet_punches` with `punch_in` column — neither exists.

Fix: Replace the query to use `time_punches` with `date_time`, then build sessions using the paired-row logic described in BUG-ATT-3 above. The employee detail only needs this employee's punches:

```typescript
// WRONG:
from('timesheet_punches')
  .gte('punch_in', from)
  .lt('punch_in', to)
  .order('punch_in', { ascending: false })

// CORRECT:
from('time_punches')
  .eq('employee_id', employee.id)
  .eq('company_id', member.companyId)
  .gte('date_time', from)
  .lt('date_time', to)
  .order('date_time', { ascending: false })
```

After fetching raw punches, apply the pairing logic to produce session objects with `punchIn`, `punchOut`, and computed `hoursWorked`.

**BUG-EMP-DETAIL-2 — `PaymentsTab` wrong table and non-existent column (CRITICAL, blank tab)**  
The Payments tab queries `timesheet_punches` with `.not('hours_worked', 'is', null)`. Both the table name and the column are wrong. `time_punches` has no `hours_worked` column — hours must be calculated from paired in/out rows.

Fix: Same as above — fetch from `time_punches`, pair in/out rows, compute hours, then use `employee.hourly_rate * computed_hours` for pay.

---

## MODULE 4: NEW EMPLOYEE PAGE
**File:** `src/app/dashboard/employees/new/page.tsx`

### Status: NO DATA BUGS FOUND

The page correctly:
- Calls `resolveCurrentMember()` and scopes all queries to `companyId`
- Filters `branches`, `shift_templates`, and `managers` by `company_id`
- Reads `manager_user_id` — note that the DB column is `manager_user_id` (stores user UUID, not employee UUID). Verify the form is saving the correct value.

### Action Required
**Verify `manager_user_id` mapping:** The form collects a manager from the `employees` table (`id` field), but the column `manager_user_id` expects the manager's `user_id` (auth user UUID), not their `employee.id`. Engineer must confirm the save logic converts employee.id → employee.user_id before inserting.

---

## MODULE 5: EDIT EMPLOYEE PAGE
**File:** `src/app/dashboard/employees/[id]/edit/page.tsx`

### Status: NO DATA BUGS FOUND

The page correctly scopes: `.eq('id', id).eq('company_id', member.companyId)` — confirming ownership before loading.

Same `manager_user_id` verification note applies as Module 4.

---

## MODULE 6: IMPORT EMPLOYEES PAGE
**File:** `src/app/dashboard/employees/import/page.tsx`

### Bugs

**BUG-IMPORT-1 — `import_employees` RPC does not exist**  
Line 124: `supabase.rpc('import_employees', { rows: preview.map(e => e.raw) })` — this RPC was not found in the live database. The import button will throw an error silently.

**BUG-IMPORT-2 — `get_employee_import_template_url` RPC does not exist**  
Line 47: `supabase.rpc('get_employee_import_template_url')` — also missing. The code handles this gracefully by generating a client-side template, so this is non-critical.

### Resolution for BUG-IMPORT-1 (two options — architect to decide)
**Option A:** Create the `import_employees` RPC in Supabase (KEES applies migration). This is the clean solution.  
**Option B:** Replace the RPC call with a client-side loop that inserts employees one by one using the same `employees` table insert logic from the New Employee page.

**Recommendation:** Option B is faster to ship. The import page already has the parsed row data — the engineer simply reuses the same insert logic from `new/page.tsx` in a loop, one row per employee.

---

## MODULE 7: JOBS PAGE
**File:** `src/app/dashboard/jobs/page.tsx`

### Bugs

**BUG-JOBS-1 — "My Jobs" scope uses wrong column name**  
Line 69: `.eq('assigned_employee_id', member.employeeId)` — the column `assigned_employee_id` does not exist.

Live schema has two assignment columns:
- `assignee_employee_id` (single UUID) — the primary assignee
- `assigned_employee_ids` (uuid[]) — array of all assigned employees

Fix: Replace with the correct column name AND include the array check:
```typescript
if (scope === 'mine') {
  query = query
    .or(`assignee_employee_id.eq.${member.employeeId},assigned_employee_ids.cs.{${member.employeeId}}`)
}
```

### Status: Otherwise clean
- Correctly scoped to `company_id` ✅
- Job creation, filtering, CSV export work correctly ✅

---

## MODULE 8: PROJECTS PAGE
**File:** `src/app/dashboard/projects/page.tsx`

### Bugs

**BUG-PROJ-1 — Queries non-existent `projects` table (CRITICAL, entire module broken)**  
Line 44: `from('projects')` — this table does not exist. The correct table is `client_deals`.

Fix: Replace all references:
```typescript
// WRONG:
from('projects').select('*, clients(id, name), employees(id, name, surname)')

// CORRECT:
from('client_deals').select('*, clients(id, name), employees(id, name, surname)')
```

Also update the `updateStatus()` function on line 53:
```typescript
// WRONG:
from('projects').update({ status: newStatus }).eq('id', p.id)
// CORRECT:
from('client_deals').update({ status: newStatus }).eq('id', p.id)
```

**BUG-PROJ-2 — Missing `company_id` filter (CRITICAL data leak)**  
Line 44: the query has no `.eq('company_id', ...)` filter — it returns projects from ALL companies.

Fix: Add company_id scoping using `resolveCurrentMember`:
```typescript
async function load() {
  setLoading(true)
  const supabase = createClient()
  const member = await resolveCurrentMember(supabase)
  if (!member) { setLoading(false); return }
  setCurrentUserId(member.employeeId)

  const { data } = await supabase
    .from('client_deals')
    .select('*, clients(id, name), employees(id, name, surname)')
    .eq('company_id', member.companyId)      // ADD THIS
    .order('created_at', { ascending: false })

  setProjects((data ?? []) as Project[])
  setLoading(false)
}
```

**BUG-PROJ-3 — "My Projects" scope is never applied**  
The `scope` state is set when the toggle is clicked but `load()` is called only once in `useEffect` and does not respond to `scope` changes. "My Projects" always shows all projects.

Fix:
1. Add `scope` to the `useEffect` dependency array
2. In `load()`, apply filter when `scope === 'mine'`:
```typescript
useEffect(() => { load() }, [scope])  // add scope

// Inside load(), after company filter:
if (scope === 'mine') {
  query = query.eq('manager_employee_id', member.employeeId)
  // Note: verify exact column name for project manager in client_deals
}
```

**BUG-PROJ-4 — `updateStatus()` has no ownership check**  
Line 54: any authenticated user can update any project's status with no company_id guard. Fix: add `.eq('company_id', companyId)` to the update.

**BUG-PROJ-5 — Type alias `Project` is wrong**  
The `Project` type from `database.ts` was built against the non-existent `projects` table. Engineer must verify the `client_deals` schema and ensure the TypeScript type matches. Key columns to confirm: `name`, `code`, `status`, `offer_amount`, `paid_amount`, `manager_employee_id` (vs `employees` FK).

---

## SUMMARY TABLE (superseded by Updated Summary Table above — see Module 9 section)

---

## EXECUTION ORDER FOR ENGINEER

Complete in this order to restore functionality progressively:

1. **Fix `types/database.ts`** — replace `TimesheetPunch` with correct `TimePunch` type. All other fixes depend on correct types.

2. **Fix `attendance/page.tsx`** — replace table name, column names, session-building logic, and realtime subscription. This is the most impactful fix.

3. **Fix `employees/[id]/page.tsx`** — replace attendance and payments tab queries. Implement hour calculation from paired punches.

4. **Fix `employees/page.tsx`** — add `company_id` to teams query, fix pending tab filter.

5. **Fix `projects/page.tsx`** — replace `projects` with `client_deals`, add `company_id` filter, fix scope dependency, verify `Project` type.

6. **Fix `jobs/page.tsx`** — fix "My Jobs" column name.

7. **Fix `employees/import/page.tsx`** — implement client-side import loop or request RPC creation.

8. **Verify manager_user_id** in new/edit employee pages.

---

---

## MODULE 9: NOTIFICATIONS PAGE
**File:** `src/app/dashboard/notifications/page.tsx`

### Bugs

**BUG-NOTIF-1 — Queries non-existent `notifications` table (CRITICAL, entire page blank)**  
Line 30: `from('notifications')` — this table does not exist. The real table is `app_notifications`.

Fix:
```typescript
// WRONG:
supabase.from('notifications').select('*').eq('company_id', member.companyId).eq('is_read', false)

// CORRECT:
supabase.from('app_notifications').select('*')
  .eq('company_id', member.companyId)
  .eq('recipient_employee_id', member.employeeId)  // scope to this user (see BUG-NOTIF-3)
  .eq('is_read', false)
  .order('created_at', { ascending: false })
```

**BUG-NOTIF-2 — Accesses non-existent `color` column**  
Line 86: `n.color` — `app_notifications` has no `color` column. This renders as `undefined` silently, so the accent bar shows no color.

`app_notifications` schema: `id`, `company_id`, `audience`, `recipient_employee_id`, `recipient_auth_user_id`, `type`, `title`, `body`, `ref_type`, `ref_id`, `dedupe_key`, `data (jsonb)`, `is_read`, `read_at`, `created_at`

Fix: Derive display color from the `type` field instead:
```typescript
// Replace: style={{ background: n.color ?? '#3B82F6' }}
// With a type→color map, e.g.:
const TYPE_COLORS: Record<string, string> = {
  leave_request: '#F59E0B',
  incident: '#EF4444',
  payment: '#10B981',
  job: '#3B82F6',
}
// style={{ background: TYPE_COLORS[n.type] ?? '#3B82F6' }}
```

**BUG-NOTIF-3 — Notifications not scoped to current user**  
Line 30: only filters by `company_id` — returns ALL company-wide notifications, not just this user's. The MAUI app shows each employee only their own notifications.

Fix: Add `recipient_employee_id` filter as shown in BUG-NOTIF-1 fix above. Use `member.employeeId` from `resolveCurrentMember`.

**BUG-NOTIF-4 — `payment_approvals` accesses non-existent `period_label` column**  
Line 156: `p.period_label` — the `payment_approvals` table has no `period_label` column.

Actual columns available: `period_start` (date), `period_end` (date), `gross_pay`, `net_pay`, `status`, `employee_id`.

Fix: Build the label from the date range:
```typescript
// Replace: {p.period_label}
// With:
{`${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`}
```

Also update the TypeScript type for `PaymentApproval` in `database.ts` if `period_label` is declared there — remove it and add `period_start: string`, `period_end: string`.

### What IS working
- `leave_requests` query ✅ — correct table name, correct columns, correct filter
- `incident_reports` query ✅ — correct table name, `.eq('status', 'open')` is valid (schema has `status` column)
- `payment_approvals` query ✅ — correct table name and `status` filter; only `period_label` column reference is wrong

---

## MODULE 6 UPDATE — IMPORT DECISION
**Decision recorded:** Client-side loop (not RPC)

Engineer must implement `importEmployees()` in `employees/import/page.tsx` as a client-side loop:
1. For each parsed row in `preview`, construct an insert payload matching the `employees` table schema
2. Required fields: `company_id`, `name`, `surname`, `employment_type`, `access_level`, `worker_type`, `hourly_rate` (0 if not provided), `daily_rate` (0), `weekly_rate` (0), `monthly_salary` (0), `overtime_rate` (0), `double_time_rate` (0), `daily_hours` (8), `work_days_weekly` (5), `is_active` (true), `registration_status` ('active'), `uif_exempt` (false), `medical_aid_deduction` (0), `pension_deduction` (0), `union_deduction` (0), `pay_full_monthly_salary` (false), `paye_fixed_amount` (0), `uif_fixed_amount` (0), `pin_reset_required` (false), `pin_failed_attempts` (0), `login_failed_attempts` (0), `is_account_locked` (false)
3. Optional from spreadsheet: `email`, `phone`, `position`, `id_number`, `employment_type`, `access_level`
4. Insert in a loop with error collection — report partial failures to the user
5. Delete the dead `supabase.rpc('import_employees', ...)` call entirely

---

## UPDATED SUMMARY TABLE

| Module | File | Bug ID | Severity | Description |
|--------|------|--------|----------|-------------|
| Attendance | `attendance/page.tsx` | ATT-1 | 🔴 CRITICAL | Queries `timesheet_punches` (doesn't exist) |
| Attendance | `attendance/page.tsx` | ATT-2 | 🔴 CRITICAL | Filters on `punch_in` column (doesn't exist) |
| Attendance | `attendance/page.tsx` | ATT-3 | 🔴 CRITICAL | Session logic assumes paired columns, not paired rows |
| Attendance | `attendance/page.tsx` | ATT-4 | 🟠 HIGH | Realtime subscription on wrong table |
| Attendance | `attendance/page.tsx` | ATT-5 | 🟡 MEDIUM | Queries non-existent `payroll_settings` |
| Types | `types/database.ts` | ATT-6 | 🟠 HIGH | `TimesheetPunch` type based on phantom schema |
| Employees List | `employees/page.tsx` | EMP-1 | 🔴 CRITICAL | `work_teams` query missing `company_id` filter (data leak) |
| Employees List | `employees/page.tsx` | EMP-2 | 🟠 HIGH | Pending tab shows terminated employees too |
| Employee Detail | `employees/[id]/page.tsx` | EMP-DETAIL-1 | 🔴 CRITICAL | Attendance tab queries phantom table + column |
| Employee Detail | `employees/[id]/page.tsx` | EMP-DETAIL-2 | 🔴 CRITICAL | Payments tab queries phantom table + column |
| New Employee | `employees/new/page.tsx` | — | 🟡 VERIFY | `manager_user_id` mapping: employee.id vs employee.user_id |
| Edit Employee | `employees/[id]/edit/page.tsx` | — | 🟡 VERIFY | Same `manager_user_id` mapping |
| Import | `employees/import/page.tsx` | IMPORT-1 | 🟠 HIGH | Replace dead RPC call with client-side insert loop |
| Jobs | `jobs/page.tsx` | JOBS-1 | 🟠 HIGH | "My Jobs" uses wrong column name |
| Projects | `projects/page.tsx` | PROJ-1 | 🔴 CRITICAL | Queries `projects` table (doesn't exist, use `client_deals`) |
| Projects | `projects/page.tsx` | PROJ-2 | 🔴 CRITICAL | No `company_id` filter (all companies' data exposed) |
| Projects | `projects/page.tsx` | PROJ-3 | 🟠 HIGH | "My Projects" scope never applied to query |
| Projects | `projects/page.tsx` | PROJ-4 | 🟠 HIGH | `updateStatus()` has no ownership guard |
| Notifications | `notifications/page.tsx` | NOTIF-1 | 🔴 CRITICAL | Queries `notifications` (doesn't exist, use `app_notifications`) |
| Notifications | `notifications/page.tsx` | NOTIF-2 | 🟠 HIGH | Accesses non-existent `color` column |
| Notifications | `notifications/page.tsx` | NOTIF-3 | 🟠 HIGH | Not scoped to current user — shows all company notifications |
| Notifications | `notifications/page.tsx` | NOTIF-4 | 🟠 HIGH | `payment_approvals` uses non-existent `period_label` column |

---

## NOTES FOR KEES ARCHITECT

- No DB migrations required for any of the above fixes — all bugs are in the web app layer only.
- The `payroll_settings` table gap (ATT-5) will need a migration if payroll threshold settings are ever needed. Not blocking for Wave 1.
- The `import_employees` RPC gap (IMPORT-1) requires either a migration (KEES applies) or a client-side workaround (engineer implements). Architect decision needed before engineer touches that file.
- `client_deals` schema verification for the Projects `Project` type is the only unknown — engineer to check `client_deals` columns match what `projects/page.tsx` accesses (`name`, `code`, `status`, `offer_amount`, `paid_amount`, and the employee FK for manager).
