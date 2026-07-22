# MISSION BRIEF — EMPLOYEE PORTAL WAVE 5: BUG FIXES + MISSING PAGES

**Classification:** KEES Standard Mission Brief  
**Date:** 2026-07-16  
**Source of Truth:** KaiFlow.Timesheets.Maui ViewModels + Supabase DB (project: vcivtjwreybaxgtdhtou)  
**Mandate:** Zero assumptions. Match MAUI exactly. Every bug fixed. Every missing page built.

---

## SCOPE

This brief covers **8 files to modify** and **2 new files to create**:

| # | File | Action |
|---|------|--------|
| 1 | `src/app/dashboard/employee/overview/page.tsx` | MODIFY — 6 bugs + missing features |
| 2 | `src/app/dashboard/employee/incidents/page.tsx` | MODIFY — field name bugs + missing filters |
| 3 | `src/app/dashboard/employee/incidents/new/page.tsx` | MODIFY — near-rewrite, wrong validation + params |
| 4 | `src/app/dashboard/employee/notifications/page.tsx` | MODIFY — missing 2 of 3 data sources |
| 5 | `src/app/dashboard/employee/payslips/page.tsx` | CREATE NEW |
| 6 | `src/app/dashboard/employee/documents/page.tsx` | CREATE NEW |
| 7 | `src/app/dashboard/employee/attendance/page.tsx` | MODIFY — add export |
| 8 | `src/components/layout/EmployeeSidebar.tsx` | MODIFY — add Payslips + Documents nav links |

---

## VERIFIED DB FACTS (do not deviate)

### Punch table: `time_punches`
Columns: `id (uuid), company_id (uuid), employee_id (uuid), type (text: 'in'|'out'), date_time (timestamptz), latitude (float8), longitude (float8), address (text), job_id (uuid), notes (text), created_at (timestamptz), punched_by_manager_id (uuid), idempotency_key (uuid)`

### RPC: `employee_get_last_punch`
```
employee_get_last_punch(p_employee_id uuid, p_session_token text DEFAULT NULL)
```
Returns `row_to_json(tp.*)` from `time_punches` — exact column names above. **No `punch_type` field. No `punched_at` field. No `job_title` field.** The field is `type` ('in'|'out') and `date_time`.

### RPC: `employee_insert_punch`
```
employee_insert_punch(
  p_company_id uuid,
  p_employee_id uuid,
  p_type text,              ← 'in' or 'out' ONLY
  p_date_time timestamptz,
  p_latitude float8,
  p_longitude float8,
  p_address text,
  p_job_id uuid,
  p_notes text,
  p_punched_by_manager_id uuid,
  p_idempotency_key uuid,
  p_session_token text
)
```
`employee_clock_in` and `employee_clock_out` **DO NOT EXIST**. Any call to them will always return an RPC error. Clock in/out is currently completely broken in production.

### RPC: `employee_get_my_punches`
```
employee_get_my_punches(p_company_id uuid, p_employee_id uuid, p_from date, p_to date, p_session_token text DEFAULT NULL)
```
`p_from` and `p_to` are type **date** (not timestamptz). Pass as `'YYYY-MM-DD'` string.

### RPC: `employee_get_my_notifications_for_employee`
```
employee_get_my_notifications_for_employee(p_employee_id uuid, p_session_token text DEFAULT NULL)
```
**No `p_company_id` parameter.** Passing it causes the call to fail.

### RPC: `employee_mark_notification_read_for_employee`
```
employee_mark_notification_read_for_employee(p_employee_id uuid, p_notification_id bigint, p_session_token text DEFAULT NULL)
```
`p_notification_id` is **bigint**, not uuid. The `app_notifications` table uses bigint IDs.

### RPC: `employee_insert_incident`
```
employee_insert_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_description text,       ← REQUIRED (not optional)
  p_severity text,
  p_job_id uuid,
  p_site_id uuid,
  p_assignee_id uuid,
  p_photo_urls ARRAY,
  p_reported_by_name text,
  p_title text,             ← OPTIONAL
  p_category text,
  p_occurred_at timestamptz,
  p_latitude float8,
  p_longitude float8,
  p_location_text text,     ← NOT `p_location`
  p_session_token text
)
```
The field for location is `p_location_text` (not `p_location`).  
The field for date/time is `p_occurred_at` (not `p_incident_date`).

### `incident_reports` table columns (for list queries):
`id, company_id, employee_id, job_id, site_id, description, severity, photo_urls (ARRAY), is_closed, resolution_notes, created_at, assignee_id, contractor_id, reported_by_name, title, category, status, occurred_at, updated_at, latitude, longitude, location_text, deal_id`

Note: display field for date is `occurred_at`, for location is `location_text`. The web currently references `incident_date` and `location` — both will always be null.

### RPC: `employee_get_payslips`
```
employee_get_payslips(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL)
```

### `payment_approvals` table columns (payslip display fields):
`id, company_id, employee_id, period_start (date), period_end (date), regular_hours (float8), overtime_hours (float8), gross_pay (float8), deductions (float8), net_pay (float8), status (text), approved_by (uuid), approved_at (timestamptz), paid_at (timestamptz), notes (text), created_at (timestamptz), working_days (int), leave_days (float8), absent_days (int)`

### RPC: `employee_get_documents`
```
employee_get_documents(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL)
```

### `employee_documents` table columns:
`id (uuid), company_id (uuid), employee_id (uuid), document_type (text), document_name (text), file_url (text), uploaded_by_role (text), created_at (timestamptz)`

### RPC: `employee_submit_document`
```
employee_submit_document(p_company_id uuid, p_employee_id uuid, p_document_type text, p_document_name text, p_file_url text, p_session_token text DEFAULT NULL)
```

### RPC: `employee_update_document`
```
employee_update_document(p_document_id uuid, p_company_id uuid, p_employee_id uuid, p_document_type text, p_document_name text, p_file_url text, p_session_token text DEFAULT NULL)
```

### RPC: `employee_report_absence`
```
employee_report_absence(p_company_id uuid, p_employee_id uuid, p_date date, p_reason text, p_note text DEFAULT NULL, p_session_token text DEFAULT NULL)
```

### RPC: `employee_get_pa_tasks`
```
employee_get_pa_tasks(p_company_id uuid, p_employee_id uuid, p_session_token text DEFAULT NULL)
```

### `leave_requests` table columns (for colleagues-on-leave query):
`id, company_id, employee_id, leave_type, start_date (date), end_date (date), total_days, status, reason, decision_note, decided_at, created_at, attachment_url`

---

## FILE 1 — OVERVIEW PAGE

**Path:** `src/app/dashboard/employee/overview/page.tsx`

### Bug 1 — CRITICAL: `employee_clock_in` / `employee_clock_out` don't exist

Replace the entire `submitClock` function. The new implementation must:

1. Get session token before calling the RPC:
```ts
const { data: { session } } = await supabase.auth.getSession()
```

2. Call `employee_insert_punch` (NOT `employee_clock_in` / `employee_clock_out`):
```ts
const { error } = await rpc('employee_insert_punch', {
  p_company_id:            compId,
  p_employee_id:           empId,
  p_type:                  isClockedIn ? 'out' : 'in',
  p_date_time:             new Date().toISOString(),
  p_latitude:              geoLat,
  p_longitude:             geoLng,
  p_address:               null,
  p_job_id:                clockJobId || null,
  p_notes:                 clockNote || null,
  p_punched_by_manager_id: null,
  p_idempotency_key:       crypto.randomUUID(),
  p_session_token:         session?.access_token ?? null,
})
```

### Bug 2 — `employee_get_last_punch` wrong params + wrong field names

Current call (WRONG):
```ts
rpc('employee_get_last_punch', { p_employee_id: ..., p_company_id: ... })
```

Correct call:
```ts
rpc('employee_get_last_punch', { p_employee_id: member.employeeId, p_session_token: session?.access_token ?? null })
```

The return is a single JSON object (not an array). Access as:
```ts
const lp = lastPunchRes.data as LastPunch | null
```

**Fix the TypeScript interface:**
```ts
interface LastPunch {
  id: string
  type: 'in' | 'out'      // was: punch_type: 'clock_in' | 'clock_out'
  date_time: string        // was: punched_at
  job_id: string | null
  notes: string | null
}
```

**Fix isClockedIn detection:**
```ts
// was: lp?.punch_type === 'clock_in'
if (lp?.type === 'in') {
  setIsClockedIn(true)
  clockInTimeRef.current = lp.date_time    // was: lp.punched_at
  ...
}
```

**Fix timer start time reference:**
```ts
// anywhere lp.punched_at is used → replace with lp.date_time
```

### Bug 3 — `employee_get_my_punches` wrong param types

`p_from` and `p_to` must be **date strings** (`'YYYY-MM-DD'`), not ISO timestamps.

```ts
const todayDate = new Date().toISOString().split('T')[0]
rpc('employee_get_my_punches', {
  p_company_id:   member.companyId,
  p_employee_id:  member.employeeId,
  p_from:         todayDate,
  p_to:           todayDate,
  p_session_token: session?.access_token ?? null,
})
```

### Bug 4 — `employee_get_my_notifications_for_employee` wrong params

Remove `p_company_id`. Correct:
```ts
rpc('employee_get_my_notifications_for_employee', {
  p_employee_id:  member.employeeId,
  p_session_token: session?.access_token ?? null,
})
```

### Bug 5 — Missed sign-out recovery banner

After loading last punch, add this check: if the employee is still clocked in (`type === 'in'`) AND `date_time` date is before today → set a `hasMissedSignOut` flag and show a warning banner on the overview:

```
"You forgot to clock out yesterday. Your last punch was [date]. Please clock out now."
```

The banner should be displayed at the top (below the pending/on-leave banner), styled with `bg-warning/10 border-warning/30`, and the Clock Out button in the modal should still function normally.

### Missing Feature 1 — Today's PA Tasks strip

After loading, also call:
```ts
rpc('employee_get_pa_tasks', {
  p_company_id:   member.companyId,
  p_employee_id:  member.employeeId,
  p_session_token: session?.access_token ?? null,
})
```

Filter result to tasks where `due_date` is today (or no due date) AND `status !== 'done'` AND `status !== 'snoozed'`.

Display as a horizontal scrollable strip of task chips between the clock card and the KPI grid. Each chip shows:
- Task title (truncated)
- Priority badge: `low` = grey, `medium` = blue, `high` = orange, `urgent` = red

Tap a chip → navigate to `/dashboard/employee/my-pa`.

If no tasks today, do not show the strip.

Section label above strip: **"Today's Tasks"**

### Missing Feature 2 — Colleagues on Leave

After loading, query directly:
```ts
const todayStr = new Date().toISOString().split('T')[0]
const { data: colleaguesData } = await supabase
  .from('leave_requests')
  .select('employee_id, leave_type, end_date, employees!inner(full_name)')
  .eq('company_id', member.companyId)
  .eq('status', 'approved')
  .lte('start_date', todayStr)
  .gte('end_date', todayStr)
  .neq('employee_id', member.employeeId)
  .limit(10)
```

Display as a section below the KPI grid titled **"Colleagues on Leave"**. Each row shows:
- Employee name (`employees.full_name`)
- Leave type (formatted, e.g. `annual_leave` → `Annual Leave`)
- End date (`Back: [date]`)

If none, do not show this section.

### Missing Feature 3 — Report Absence button

Add a **"Report Absence"** button to the overview. Place it in the clock card, below the today's punches line, only visible when `!isClockedIn`.

Button label: **"Report Absence"**, icon: `sick`, style: outlined/secondary.

Tapping it opens a modal with:
- Date picker (defaults to today)
- Reason dropdown: `sick`, `personal`, `family_emergency`, `other`
- Notes text input (optional)
- Submit button

On submit, call:
```ts
await rpc('employee_report_absence', {
  p_company_id:    companyId,
  p_employee_id:   empId,
  p_date:          selectedDate,   // 'YYYY-MM-DD'
  p_reason:        selectedReason,
  p_note:          note || null,
  p_session_token: session?.access_token ?? null,
})
```

On success, show alert "Absence reported." and close modal.

### Missing Feature 4 — Active Jobs as tappable strip

The current KPI card shows `activeJobs` as a count. Replace this card with a tappable element: tapping the "Active Jobs" KPI card navigates to `/dashboard/employee/jobs`.

Additionally, below the KPI grid, add a horizontal scrollable strip of the employee's active job cards (jobs where `status !== 'completed'` AND `status !== 'cancelled'`). Each card shows job title + status badge. Tap → navigate to `/dashboard/employee/jobs/[id]`. Max 5 shown; if more, show a "View all" chip at the end.

If no active jobs, show nothing (no strip).

Section label: **"Active Jobs"**

### Missing Feature 5 — RecentActivity mixed feed

The current page shows only leave requests. Replace the "Recent Leave Requests" section with a **"Recent Activity"** feed that combines:

- Leave requests (from `leaveRes.data`): show as `"Leave: [type]"` with status badge and date range
- Incidents (from `incRes.data`): show as `"Incident: [title or 'Untitled']"` with severity badge and `occurred_at` date

Merge both arrays, sort descending by date (`start_date` for leave, `occurred_at` or `created_at` for incidents), show max 5 total.

Section label: **"Recent Activity"**

---

## FILE 2 — INCIDENTS LIST PAGE

**Path:** `src/app/dashboard/employee/incidents/page.tsx`

### Bug 1 — Wrong field names

The `Incident` interface and all references must use the correct `incident_reports` column names:

```ts
interface Incident {
  id: string
  title: string | null      // optional — may be null
  description: string       // required — show as fallback if title is null
  severity: string | null
  status: string | null
  occurred_at: string | null   // was: incident_date
  location_text: string | null // was: location
  created_at: string
  job_id: string | null
}
```

In the list item rendering:
- Primary text: `inc.title ?? inc.description` (show description as fallback if no title)
- Date: `inc.occurred_at ?? inc.created_at`
- Location: `inc.location_text`

### Missing Feature 1 — Scope filter

Add a segmented control (pill tabs) below the header:

`All` | `Standalone` | `Job-linked`

Default: `All`

Logic:
- `All`: show all incidents (no filter)
- `Standalone`: show only incidents where `job_id IS NULL`
- `Job-linked`: show only incidents where `job_id IS NOT NULL`

Filter client-side after fetching all.

### Missing Feature 2 — Status filter

Add a dropdown or segmented control: `Open` | `Closed`

Default: `Open`

Logic:
- `Open`: show incidents where `status !== 'closed'` and `is_closed !== true`
- `Closed`: show incidents where `status === 'closed'` or `is_closed === true`

### Missing Feature 3 — Search

Add a search input below the filters. Search applies to: `title`, `description`, `location_text` (case-insensitive, client-side).

### Missing Feature 4 — Export CSV

Add an export button in the header (icon: `file_download`). On tap, export visible (filtered) incidents to a CSV file and trigger download. CSV columns: Title, Description, Severity, Status, Occurred At, Location.

### Missing Feature 5 — Correct empty state messages

Match MAUI exactly:
- When scope = `Standalone` and list is empty: `"No standalone incidents. Tap New to report one."`
- When scope = `Job-linked` and list is empty: `"No job-linked incidents yet."`
- All other cases: `"No incidents found."`

---

## FILE 3 — NEW INCIDENT FORM

**Path:** `src/app/dashboard/employee/incidents/new/page.tsx`

This file needs a near-complete rewrite. Every field, every validation, every RPC param must match MAUI's `IncidentReportViewModel`.

### Bug 1 — Validation reversed

Current: `if (!title.trim()) { setError('Title is required.') }` — WRONG.

Correct:
```ts
if (!description.trim()) {
  setError('Description is required.')
  return
}
```

Title is **optional**. Description is **required**.

### Bug 2 — Wrong RPC parameter names

| Current (WRONG) | Correct |
|----------------|---------|
| `p_location` | `p_location_text` |
| `p_incident_date` | `p_occurred_at` (must be timestamptz) |
| (missing) | `p_session_token` |
| (missing) | `p_category` |
| (missing) | `p_assignee_id` |
| (missing) | `p_reported_by_name` |
| (missing) | `p_job_id` |
| (missing) | `p_site_id` |

### Complete field list (match MAUI's IncidentReportViewModel)

Build the form with these fields in order:

**Section: "Incident Details"**
1. **Title** — text input, optional. Placeholder: "Brief title (optional)"
2. **Description** — textarea (4 rows), **REQUIRED**. Placeholder: "What happened? Include all relevant details." Label shows asterisk: `Description *`
3. **Severity** — dropdown: `low` | `medium` | `high` | `critical`. Default: `medium`
4. **Category** — dropdown. Options: `injury` | `property_damage` | `near_miss` | `environmental` | `security` | `other`. No default (blank/"Select category").
5. **Occurred Date** — date input. Default: today
6. **Occurred Time** — time input. Default: current time (HH:MM)
7. **Location** — text input. Placeholder: "Where did this happen?"

**Section: "Assignment" (optional)**
8. **Assigned To (Manager)** — dropdown of company employees with leadership/manager role. Load via:
   ```ts
   // Direct query — get employees where role is 'manager' or 'hr' or 'owner' in same company
   const { data: managers } = await supabase
     .from('employees')
     .select('id, full_name, position')
     .eq('company_id', member.companyId)
     .in('access_level', ['manager', 'hr', 'owner'])
     .order('full_name')
   ```
   Include a "None" option at the top. Default: None.

9. **Job** (optional) — dropdown of employee's active jobs (reuse `employee_get_jobs_for_employee`). Include "None" option. Default: None.

**Section: "GPS Location"**
10. GPS capture button (as current — keep as is)

**Section: "Photos"**
11. Photo file input (as current — keep as is, allow multiple)

### Complete RPC call

```ts
// Get session and employee name
const { data: { session } } = await supabase.auth.getSession()
const { data: empData } = await supabase
  .from('employees')
  .select('full_name')
  .eq('id', member.employeeId)
  .single()

// Combine date + time into timestamptz
const occurredAt = occurredDate && occurredTime
  ? new Date(`${occurredDate}T${occurredTime}:00`).toISOString()
  : new Date().toISOString()

const { error: rpcErr } = await rpc('employee_insert_incident', {
  p_company_id:       member.companyId,
  p_employee_id:      member.employeeId,
  p_description:      description.trim(),
  p_severity:         severity,
  p_job_id:           selectedJobId || null,
  p_site_id:          null,
  p_assignee_id:      selectedManagerId || null,
  p_photo_urls:       photoUrls.length > 0 ? photoUrls : null,
  p_reported_by_name: empData?.full_name ?? null,
  p_title:            title.trim() || null,
  p_category:         category || null,
  p_occurred_at:      occurredAt,
  p_latitude:         geoLat,
  p_longitude:        geoLng,
  p_location_text:    location.trim() || null,
  p_session_token:    session?.access_token ?? null,
})
```

---

## FILE 4 — NOTIFICATIONS PAGE

**Path:** `src/app/dashboard/employee/notifications/page.tsx`

### Bug 1 — Extra `p_company_id` param

Remove `p_company_id` from the `employee_get_my_notifications_for_employee` call. Correct:
```ts
rpc('employee_get_my_notifications_for_employee', {
  p_employee_id:   member.employeeId,
  p_session_token: session?.access_token ?? null,
})
```

### Bug 2 — `p_notification_id` is bigint, not uuid

The `app_notifications` table uses **bigint** IDs. The current code calls `markRead(n.id)` where `id` is typed as `string`. This call silently fails because `p_notification_id` expects a bigint.

Fix the interface and mark-read call:
```ts
interface Notification {
  id: number           // bigint — use number in TS
  title: string
  body: string | null
  created_at: string
  is_read: boolean
  notification_type: string | null
}

// In markRead:
await rpc('employee_mark_notification_read_for_employee', {
  p_employee_id:      empId,
  p_notification_id:  notifId,    // now typed as number
  p_session_token:    session?.access_token ?? null,
})
```

### Missing Feature — Three data sources (match MAUI exactly)

MAUI's `EmployeeNotificationsViewModel` combines THREE sources into one unified list. The web must do the same.

**Source 1: `app_notifications`** (current — keep, fix params as above)

**Source 2: Leave requests** (last 20, ordered by `created_at` desc)

Query:
```ts
const { data: leaveData } = await supabase
  .from('leave_requests')
  .select('id, leave_type, status, decided_at, created_at, start_date, end_date')
  .eq('company_id', member.companyId)
  .eq('employee_id', member.employeeId)
  .order('created_at', { ascending: false })
  .limit(20)
```

Convert each leave request into a synthetic notification item:
```ts
type SyntheticNotif = {
  id: string           // `leave-${leave.id}`
  title: string
  body: string | null
  created_at: string
  is_read: boolean
  notification_type: string
  color: string        // hex color for the dot/icon
  source: 'leave' | 'incident' | 'app'
}
```

Map status to title + color:
- `approved` → title: `"Leave Approved"`, color: `#22C55E`
- `rejected` → title: `"Leave Declined"`, color: `#EF4444`
- `pending` → title: `"Leave Pending Review"`, color: `#94A3B8`

Body: `"[formatted leave_type] — [start_date] to [end_date]"`

`is_read`: `false` if `decided_at` is within the last 7 days (i.e. `new Date(leave.decided_at) > sevenDaysAgo`). Pending leave without `decided_at` is always `is_read: false` only if `created_at` is within 7 days.

**Source 3: Incidents** (last 10, ordered by `created_at` desc)

Query:
```ts
const { data: incData } = await (supabase.rpc as any)('employee_get_own_incidents', {
  p_company_id:    member.companyId,
  p_employee_id:   member.employeeId,
  p_session_token: session?.access_token ?? null,
})
// then take the last 10 by created_at desc
```

Map each incident to a synthetic notification:
- `is_closed = true` OR `status = 'closed'` → title: `"Incident Closed"`, color: `#22C55E`
- Otherwise → title: `"Incident Reported"`, color: `#94A3B8`

Body: `incident.title ?? incident.description ?? "Incident report"`

`is_read`: `false` if `created_at` is within 7 days.

### Merged display

Merge all three arrays, sort descending by `created_at`. Display them in a single unified list.

`app_notifications` items that have `notification_type = 'registration_approved'` or `notification_type = 'registration_rejected'` should show a "Company Picker" chevron and navigate to the company picker page on tap.

The existing mark-as-read interaction should only fire for real `app_notifications` (source = 'app'). Synthetic leave/incident items are read-only.

---

## FILE 5 — MY PAYSLIPS PAGE (NEW)

**Path:** `src/app/dashboard/employee/payslips/page.tsx`

**MAUI source:** `MyPayslipsViewModel` — simple list + download PDF per item.

### Page title: "My Payslips"

### Load data

```ts
const { data } = await rpc('employee_get_payslips', {
  p_company_id:    member.companyId,
  p_employee_id:   member.employeeId,
  p_session_token: session?.access_token ?? null,
})
```

TypeScript interface:
```ts
interface Payslip {
  id: string
  period_start: string    // date
  period_end: string      // date
  gross_pay: number | null
  deductions: number | null
  net_pay: number | null
  status: string          // 'pending' | 'approved' | 'paid'
  paid_at: string | null  // timestamptz
  regular_hours: number | null
  overtime_hours: number | null
  working_days: number | null
}
```

### List display

Sort by `period_start` descending (most recent first).

Each row shows:
- **Period**: `[period_start] – [period_end]` formatted as `"01 Jun 2026 – 30 Jun 2026"`
- **Net Pay**: `R [net_pay?.toFixed(2) ?? '—']` (large, bold)
- **Status badge**: `pending` → warning/orange, `approved` → blue/primary, `paid` → success/green
- **Download PDF** icon button (icon: `download`) — on tap, open the payslip PDF

### PDF download

The PDF is stored in the `workforce-media` Supabase storage bucket. The path convention is:
`payslips/[company_id]/[employee_id]/[payslip_id].pdf`

Generate a signed URL:
```ts
const { data: urlData } = await supabase.storage
  .from('workforce-media')
  .createSignedUrl(`payslips/${companyId}/${employeeId}/${payslip.id}.pdf`, 60)

if (urlData?.signedUrl) {
  window.open(urlData.signedUrl, '_blank')
} else {
  // show toast: "PDF not available yet"
}
```

If the signed URL fails (file not found), show a toast: "PDF not available yet."

### Empty state

Icon: `payments` (Material Icons)  
Text: `"No payslips yet."`

---

## FILE 6 — MY DOCUMENTS PAGE (NEW)

**Path:** `src/app/dashboard/employee/documents/page.tsx`

**MAUI source:** `MyDocumentsViewModel` — list with Submit / Open / Download / Replace actions.

### Page title: "My Documents"

### Load data

```ts
const { data } = await rpc('employee_get_documents', {
  p_company_id:    member.companyId,
  p_employee_id:   member.employeeId,
  p_session_token: session?.access_token ?? null,
})
```

TypeScript interface:
```ts
interface EmployeeDocument {
  id: string
  document_type: string
  document_name: string
  file_url: string        // storage path in workforce-media bucket
  uploaded_by_role: string  // 'employee' | 'hr' | 'admin'
  created_at: string
}
```

### List display

Each document row shows:
- **Name**: `document_name`
- **Type**: `document_type` formatted (e.g., `id_document` → `ID Document`)
- **Subtitle**: company name + `" (pending review)"` if `uploaded_by_role === 'employee'` (means HR has not yet verified it)
- **Date uploaded**: `created_at` formatted
- Three action buttons per row:
  - **Open** (icon: `open_in_new`) — creates signed URL and opens in new tab
  - **Download** (icon: `download`) — creates signed URL and triggers download
  - **Replace** (icon: `swap_horiz`) — opens replace modal (see below)

### Header — Upload button

Add a `"+ Upload"` button in the page header.

On tap, open an **Upload modal** with:
- Document Type dropdown: `id_document` | `contract` | `certificate` | `payslip` | `other`. Required.
- Document Name text input. Required.
- File picker (accept all file types). Required.
- Submit button

On submit:
1. Upload file to `workforce-media` bucket:
   ```ts
   const path = `employee-documents/${member.companyId}/${member.employeeId}/${Date.now()}_${file.name}`
   await supabase.storage.from('workforce-media').upload(path, file, { upsert: false })
   ```
2. Call:
   ```ts
   await rpc('employee_submit_document', {
     p_company_id:    member.companyId,
     p_employee_id:   member.employeeId,
     p_document_type: documentType,
     p_document_name: documentName.trim(),
     p_file_url:      path,
     p_session_token: session?.access_token ?? null,
   })
   ```
3. Reload documents list.

### Replace action

On tap of **Replace**, open a **Replace modal** with:
- New Document Name (pre-filled with current `document_name`, editable)
- File picker (required — must select a replacement file)
- Submit button

On submit:
1. Upload new file to `workforce-media` at same path pattern as Upload.
2. Call:
   ```ts
   await rpc('employee_update_document', {
     p_document_id:   doc.id,
     p_company_id:    member.companyId,
     p_employee_id:   member.employeeId,
     p_document_type: doc.document_type,
     p_document_name: newDocumentName.trim(),
     p_file_url:      newPath,
     p_session_token: session?.access_token ?? null,
   })
   ```
3. Reload documents list.

### Open / Download signed URL pattern

```ts
const { data: urlData } = await supabase.storage
  .from('workforce-media')
  .createSignedUrl(doc.file_url, 60)

if (urlData?.signedUrl) {
  // Open: window.open(urlData.signedUrl, '_blank')
  // Download: create <a href=signedUrl download=doc.document_name> and click()
}
```

### Empty state

Icon: `folder_open`  
Text: `"No documents uploaded yet."`

---

## FILE 7 — ATTENDANCE PAGE

**Path:** `src/app/dashboard/employee/attendance/page.tsx`

### Missing Feature — Export (Excel + PDF)

Add two export buttons in the page header:
- **Export Excel** (icon: `table_chart`) — exports the visible punch records to `.xlsx` format
- **Export PDF** (icon: `picture_as_pdf`) — exports visible punch records to `.pdf` format

**Excel export:** Use the `xlsx` npm package (already available in the project or add it). Build a worksheet with columns: Date, Time, Type (In/Out), Job, Notes, Location.

**PDF export:** Use `jsPDF` or `@react-pdf/renderer`. Generate a table with the same columns. Header includes employee name and export date range.

Both exports should apply to the currently visible/filtered data (respect any date filter already on the page).

---

## FILE 8 — EMPLOYEE SIDEBAR

**Path:** `src/components/layout/EmployeeSidebar.tsx`

Ensure the following nav links exist and are correctly placed in the "More" section (matching the MAUI "More" tab order):

- My PA → `/dashboard/employee/my-pa`
- Leave → `/dashboard/employee/leave`
- My Shifts → `/dashboard/employee/shifts`
- Jobs → `/dashboard/employee/jobs`
- Incidents → `/dashboard/employee/incidents`
- Contractor Profile → `/dashboard/employee/contractor-profile`
- **My Payslips → `/dashboard/employee/payslips`** ← ADD IF MISSING
- **My Documents → `/dashboard/employee/documents`** ← ADD IF MISSING
- Forms → `/dashboard/employee/forms`

If these links already exist, skip. If missing, add them with appropriate Material Icons:
- Payslips icon: `payments`
- Documents icon: `folder`

---

## COMPLETION CHECKLIST

Before marking this brief complete, the engineer must confirm:

- [ ] `employee_clock_in` / `employee_clock_out` calls removed — zero occurrences in codebase
- [ ] Clock in/out tested and working (no RPC error)
- [ ] `employee_get_last_punch` returns `type: 'in'|'out'` and `date_time` — isClockedIn detection correct
- [ ] Incidents list shows `occurred_at` and `location_text` (not null)
- [ ] New incident form validates `description` as required (not title)
- [ ] New incident form calls `employee_insert_incident` with `p_location_text` and `p_occurred_at`
- [ ] Notifications page: 3 sources merged, mark-read uses bigint ID
- [ ] Payslips page created and fetches from `payment_approvals` via `employee_get_payslips`
- [ ] Documents page created with Upload + Open + Download + Replace
- [ ] Sidebar has My Payslips and My Documents links
- [ ] No `.catch(() => null)` patterns — all RPCs wrapped in `try/catch`
- [ ] All RPCs that have `p_session_token` pass `session?.access_token ?? null`

---

*Brief authored by KEES Architect — 2026-07-16*  
*Source of truth: MAUI ViewModels + DB schema. Zero assumptions made.*
