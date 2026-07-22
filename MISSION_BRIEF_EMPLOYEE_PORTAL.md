# MISSION BRIEF — Employee Self-Service Portal
**Project:** kaisync-web (Next.js)  
**Prepared by:** KEES Architect  
**Date:** 2026-07-16  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Source:** MAUI ViewModels read directly — `EmployeeDashboardViewModel.cs`, `MyJobsViewModel.cs`, `MyLeaveViewModel.cs`, `AppShell.xaml.cs`  
**Status:** READY FOR ENGINEERING EXECUTION

> **Zero assumptions. Every feature in this brief is sourced directly from the MAUI app ViewModels. No guessing.**

---

## SCOPE

This brief covers the complete employee self-service layer in kaisync-web. It does NOT cover contractor portal, client portal, or HR dashboard unaudited pages — those are separate briefs.

The employee portal must be functionally identical to the MAUI `EmployeeDashboardViewModel` + related Employee views.

---

## PART A — ROUTING GUARD

**File:** `src/middleware.ts` (the Next.js middleware, currently called `proxy.ts`)

The current middleware only checks for a Supabase session. It needs to additionally check the employee's `access_level` and redirect accordingly.

### Logic

```typescript
// After confirming Supabase session exists and user is authenticated:

// 1. Get employee record for this user
const { data: emp } = await supabase
  .from('employees')
  .select('access_level, is_active, registration_status')
  .eq('user_id', session.user.id)
  .eq('is_active', true)
  .maybeSingle()

const isEmployee = emp?.access_level === 'employee'
const isHR = emp?.access_level && ['owner', 'hr_admin', 'admin', 'hr', 'manager'].includes(emp.access_level)

// 2. Route enforcement
if (isEmployee && pathname.startsWith('/dashboard') 
    && !pathname.startsWith('/dashboard/employee')
    && !pathname.startsWith('/dashboard/profile')
    && !pathname.startsWith('/dashboard/messages')) {
  return NextResponse.redirect(new URL('/dashboard/employee/overview', request.url))
}

if (isHR && pathname.startsWith('/dashboard/employee')) {
  return NextResponse.redirect(new URL('/dashboard/overview', request.url))
}
```

**Key rules:**
- `access_level = 'employee'` → `/dashboard/employee/*` routes only. Shared pages (`/dashboard/profile`, `/dashboard/messages`) accessible to both.
- HR/owner/manager → `/dashboard/*` HR routes only. Cannot access `/dashboard/employee/*`.
- `registration_status = 'pending'` employees: allow through — the employee dashboard handles pending state with a banner.

---

## PART B — EMPLOYEE SIDEBAR

**File:** `src/components/EmployeeSidebar.tsx` (new file)

The employee sidebar is a separate component from the HR `Sidebar.tsx`. It has fewer items — only the employee-relevant modules.

```typescript
const EMP_NAV_ITEMS = [
  { label: 'Dashboard',      href: '/dashboard/employee/overview',     icon: 'home' },
  { label: 'My Jobs',        href: '/dashboard/employee/jobs',         icon: 'work' },
  { label: 'My Leave',       href: '/dashboard/employee/leave',        icon: 'beach_access' },
  { label: 'Attendance',     href: '/dashboard/employee/attendance',   icon: 'schedule' },
  { label: 'My Incidents',   href: '/dashboard/employee/incidents',    icon: 'warning' },
  { label: 'My Tasks',       href: '/dashboard/employee/tasks',        icon: 'check_circle' },
  { label: 'Messages',       href: '/dashboard/messages',              icon: 'chat' },   // shared page
  { label: 'Notifications',  href: '/dashboard/employee/notifications',icon: 'notifications' },
  { label: 'My Profile',     href: '/dashboard/profile',               icon: 'person' }, // shared page
]
```

The sidebar component is structurally identical to the HR `Sidebar.tsx` — collapsed/expanded states, same design tokens — just with different `NAV_ITEMS`. Engineer should copy Sidebar.tsx and replace NAV_ITEMS.

**Layout file:** `src/app/dashboard/employee/layout.tsx` — this must render `<EmployeeSidebar>` instead of the HR sidebar. The HR `layout.tsx` already wraps all `/dashboard/*` routes. Engineer must ensure `/dashboard/employee/*` uses `EmployeeSidebar` and NOT the HR sidebar.

---

## PART C — EMPLOYEE DASHBOARD

**File:** `src/app/dashboard/employee/overview/page.tsx`  
**Source:** `EmployeeDashboardViewModel.cs` (read in full)

### What the MAUI dashboard loads

1. **Last punch** → determines clock status (in/out) and `lastPunchTime`
2. **My punches (last 30 days)** → builds attendance sessions for display
3. **My open jobs** → filtered to `IsOpen` status
4. **PA tasks (today strip)** → today's tasks only
5. **My work teams** → filtered to teams where employee is a member
6. **Colleagues on leave today** → company-wide approved leave, excluding self
7. **Daily absences** → check if self is marked absent today
8. **Is on leave today** (`employee_is_on_leave_today`)
9. **Notification count** (unread from `employee_get_my_notifications_for_employee`)
10. **Recent activity** → last 5 leave requests + last 3 incidents, merged and sorted

### Confirmed RPCs and their signatures

```
employee_get_last_punch(p_employee_id uuid)
  → Returns last time_punch row for employee

employee_get_my_punches(p_company_id uuid, p_employee_id uuid, p_from date, p_to date)
  → Returns time_punches array for date range

employee_get_jobs_for_employee(p_company_id uuid, p_employee_id uuid)
  → Returns all jobs assigned to or created by this employee

employee_get_work_teams(p_company_id uuid, p_employee_id uuid)
  → Returns work_teams where employee is a member

employee_get_company_approved_leave(p_company_id uuid, p_employee_id uuid)
  → Returns all approved leave for company (employee_id param = self, used for exclusion)

employee_get_daily_absences(p_company_id uuid, p_employee_id uuid, p_from date, p_to date)
  → Returns daily_absences rows for this employee in date range

employee_is_on_leave_today(p_company_id uuid, p_employee_id uuid)
  → Returns boolean

employee_get_my_notifications_for_employee(p_employee_id uuid)
  → Returns app_notifications for this employee

employee_get_leave_requests(p_company_id uuid, p_employee_id uuid)
  → Returns leave_requests for this employee

employee_get_incidents(p_company_id uuid, p_employee_id uuid)
  → Returns incidents for this employee

employee_insert_punch(p_company_id uuid, p_employee_id uuid, p_type text, 
  p_date_time timestamptz, p_latitude float8, p_longitude float8, 
  p_address text, p_job_id uuid, p_notes text, p_punched_by_manager_id uuid,
  p_idempotency_key uuid)
  → Inserts and returns new time_punch row

employee_report_absence(p_company_id uuid, p_employee_id uuid, p_date date,
  p_reason text, p_note text)
  → Marks employee absent for date
```

### Clock In / Clock Out logic (from MAUI source)

**Cannot clock in if:**
- `isOnLeaveToday = true`
- `isAbsentToday = true`

**Clock In flow:**
1. Ask: "Is this shift associated with a job?" → Yes → show open jobs picker → set `jobId`
2. Ask for optional note (prompt dialog)
3. Get geolocation (lat/lng)
4. Reverse geocode to get `address`
5. Insert punch via `employee_insert_punch`
6. Update UI optimistically if offline fallback needed

**Clock Out flow:**
1. Ask for optional note
2. Get geolocation
3. Insert punch with `type = 'out'`

**Web implementation note:** The MAUI app uses native dialogs for job selection and notes. On web, use inline UI: a modal or inline card that opens when "Clock In" is pressed, showing job selector (dropdown) and notes field.

### Attendance session building

The MAUI builds `PunchSession` objects by pairing `type='in'` and `type='out'` punches. For the web:

```typescript
type AttendanceSession = {
  date:        string      // 'DD MMM YYYY'
  timeIn:      string      // 'HH:mm'
  timeOut:     string      // 'HH:mm' or '—'
  durationMs:  number
  inAddress:   string | null
  outAddress:  string | null
  notes:       string | null
}

function buildSessions(punches: TimePunch[]): AttendanceSession[] {
  const sessions: AttendanceSession[] = []
  let openIn: TimePunch | null = null
  for (const p of punches.sort((a, b) => 
    new Date(a.date_time).getTime() - new Date(b.date_time).getTime())) {
    if (p.type === 'in') {
      openIn = p
    } else if (p.type === 'out' && openIn) {
      sessions.push({
        date:       new Date(openIn.date_time).toLocaleDateString('en-ZA', 
                      { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
        timeIn:     new Date(openIn.date_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
        timeOut:    new Date(p.date_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
        durationMs: new Date(p.date_time).getTime() - new Date(openIn.date_time).getTime(),
        inAddress:  openIn.address ?? null,
        outAddress: p.address ?? null,
        notes:      openIn.notes ?? null,
      })
      openIn = null
    }
  }
  // Open session (still clocked in)
  if (openIn) {
    sessions.push({
      date:       new Date(openIn.date_time).toLocaleDateString('en-ZA',
                    { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
      timeIn:     new Date(openIn.date_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
      timeOut:    '—',
      durationMs: Date.now() - new Date(openIn.date_time).getTime(),
      inAddress:  openIn.address ?? null,
      outAddress: null,
      notes:      openIn.notes ?? null,
    })
  }
  return sessions.reverse() // Most recent first
}
```

### Page layout spec

```
┌────────────────────────────────────────────┐
│  Good morning, [Name]    [🔔 3]            │  ← header + notification badge
├────────────────────────────────────────────┤
│  CLOCK STATUS CARD                         │
│  ● Clocked In / ● Clocked Out             │
│  Last punch: Mon, 16 Jul 2026 08:30        │
│  [Clock In] or [Clock Out] button          │  ← disabled if on leave / absent
│  On Leave banner (if applicable)           │
│  Absent Today banner (if applicable)       │
├────────────────────────────────────────────┤
│  MY JOBS (open only)                       │
│  [Job title] · Priority · Due date →      │  ← tap → job card
│  [View all jobs →]                         │
├────────────────────────────────────────────┤
│  ATTENDANCE — [Today|Week|Month|Custom]    │
│  [Session row] Date  In  Out  Duration     │
│  [Session row] ...                         │
├────────────────────────────────────────────┤
│  TODAY'S TASKS (PA tasks, if any)          │
│  [Task] Due today                          │
├────────────────────────────────────────────┤
│  COLLEAGUES ON LEAVE TODAY (if any)        │
│  [Name] · Annual until 20 Jul              │
├────────────────────────────────────────────┤
│  RECENT ACTIVITY (leave + incidents)       │
│  [Leave] Annual – pending  01 Jul–05 Jul   │
│  [Incident] Low severity   15 Jul          │
└────────────────────────────────────────────┘
```

### Pending membership state

If `employee.registration_status === 'pending'` OR `employee.is_active === false`:
- Show a full-width banner: "Awaiting HR approval at [Company Name]. You can upload documents while you wait."
- Clock card shows "Awaiting approval" (disabled)
- Jobs, attendance, teams all empty/hidden
- My Profile and Documents still accessible

---

## PART D — MY JOBS

**File:** `src/app/dashboard/employee/jobs/page.tsx`  
**Source:** `MyJobsViewModel.cs` (read in full)

### Scope tabs (from MAUI source)
- `assigned` — jobs assigned by HR/managers to this employee (not created by self)
- `created` — jobs this employee created
- `all` — both combined

### Status filter pills
`all | open | scheduled | inProgress | completed | cancelled`

### RPC
`employee_get_jobs_for_employee(p_company_id, p_employee_id)` — returns all jobs in scope for this employee

### What to show per job row
- Title
- Status badge (open = green, inProgress = blue, scheduled = amber, completed = grey, cancelled = red)
- Priority badge
- Due date (if set)
- Assigned by / Created by label
- Tap → Job Card detail page

### Empty messages (from MAUI source — verbatim)
- Assigned: "No jobs assigned to you by HR or your manager yet."
- Created: "You have not created any jobs yet. Tap + Job to add one."
- All: "No jobs yet — assigned jobs and jobs you create will appear here."

### Create job
A "+ Job" button navigates to a job request form (simplified `EmployeeJobRequestPage` equivalent):
**RPC:** `employee_create_job(p_company_id, p_creator_employee_id, p_title, p_description, p_priority, p_scheduled_start, p_scheduled_end)`

---

## PART E — MY LEAVE

**File:** `src/app/dashboard/employee/leave/page.tsx`  
**Source:** `MyLeaveViewModel.cs` (read in full)

### Leave types (from MAUI `LeavePolicy.TypeKeys`)
Annual Leave, Sick Leave, Family Responsibility, Unpaid Leave, Maternity Leave, Paternity Leave

### What to display

**Leave balances section** (computed from this year's requests):
For each leave type: Total annual days | Taken (approved) | Pending | Remaining

```typescript
type LeaveBalance = {
  type:        string   // 'Annual Leave'
  annualDays:  number   // e.g. 15
  taken:       number   // sum of approved requests this year
  pending:     number   // sum of pending requests this year
  remaining:   number   // annualDays - taken
}
```

Annual day allowances (from MAUI `LeavePolicy.Types`):
- Annual Leave: 15 days
- Sick Leave: 10 days
- Family Responsibility: 3 days
- Unpaid Leave: unlimited (show as ∞)
- Maternity Leave: 120 days
- Paternity Leave: 10 days

**Leave request list** — sorted: pending first, then by `created_at` desc

Per request row:
- Leave type badge (coloured)
- Status badge (pending amber / approved green / rejected red / cancelled grey)
- Date range: `1 Jul 2026 – 5 Jul 2026`
- Total days
- Reason (if present)
- HR decision note (if present, shown in amber/green/red tinted box)
- **Edit button** — only shown for `status = 'pending'` requests

### Apply for leave form (inline toggle, matches MAUI `ShowForm` pattern)

Fields:
- Leave Type (select from leave types list)
- Start Date (date picker)
- End Date (date picker)
- Reason (textarea, optional)
- Attachment (file upload — image/PDF/DOC, optional)

**Total days calculation:** `(endDate.dayNumber - startDate.dayNumber) + 1`

**Submit RPC:**
```
employee_submit_leave_request(
  p_company_id uuid,
  p_employee_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_total_days float8,
  p_reason text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL
)
```

**Edit RPC (for pending requests only):**
```
employee_update_leave_request(
  p_id uuid,
  p_employee_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_total_days float8,
  p_reason text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL
)
```

**Attachment upload:** Upload file to `workforce-media` bucket at path `leave-attachments/{companyId}/{employeeId}/{timestamp}_{filename}`, then pass the storage path as `p_attachment_url`.

**Validation:**
- `end_date` cannot be before `start_date` → show error "End date cannot be before start date."

---

## PART F — MY ATTENDANCE

**File:** `src/app/dashboard/employee/attendance/page.tsx`

### Data source
`employee_get_my_punches(p_company_id, p_employee_id, p_from date, p_to date)`

### Date range filters (from MAUI source)
- Today
- Last 7 days (default)
- Last 30 days
- Custom (date picker: from → to)

### Display
Build `AttendanceSession` objects using the `buildSessions()` logic from Part C.

Per session row:
- Date (weekday + date)
- Time In
- Location In (address if available, else "—")
- Time Out (or "Still clocked in" if open session)
- Location Out
- Duration formatted as `Xh Ym`

### Export buttons
Two buttons at the top: "Export Excel" and "Export PDF"
- Generate `.xlsx` / `.pdf` using SheetJS (xlsx) and a simple print-to-PDF approach
- Columns: Date | Time In | In Location | Time Out | Out Location | Total hrs | Notes

---

## PART G — MY INCIDENTS

**File:** `src/app/dashboard/employee/incidents/page.tsx`  
**File:** `src/app/dashboard/employee/incidents/new/page.tsx`  
**File:** `src/app/dashboard/employee/incidents/[id]/page.tsx`

### List page — RPCs
```
employee_get_own_incidents(p_company_id uuid, p_employee_id uuid)
  → Returns incidents filed by or involving this employee
```

Per incident row:
- Title (or first 60 chars of description)
- Severity badge: low (green) / medium (amber) / high (red) / critical (dark red)
- Category
- Status: open (amber) / in_progress (blue) / closed (grey)
- Created date

### New incident form — RPC
```
employee_insert_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_description text,
  p_severity text DEFAULT 'low',
  p_job_id uuid DEFAULT NULL,
  p_site_id uuid DEFAULT NULL,
  p_assignee_id uuid DEFAULT NULL,
  p_photo_urls text[] DEFAULT '{}',
  p_reported_by_name text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_category text DEFAULT 'general',
  p_occurred_at timestamptz DEFAULT NULL,
  p_latitude float8 DEFAULT NULL,
  p_longitude float8 DEFAULT NULL,
  p_location_text text DEFAULT NULL
)
```

Form fields:
- Title (optional)
- Description (required)
- Severity (low / medium / high / critical)
- Category (general / safety / equipment / property / other)
- Occurred at (datetime picker, defaults to now)
- Location (auto-captured or text entry)
- Photos (multi-file upload → `workforce-media` bucket → pass URLs as `p_photo_urls`)
- Job association (optional — select from own open jobs)

### Incident detail — RPCs
```
employee_get_incident(p_company_id, p_employee_id, p_incident_id)
employee_get_incident_comments(p_company_id, p_employee_id, p_incident_id)
employee_get_incident_status_history(p_company_id, p_employee_id, p_incident_id)
employee_add_incident_comment(p_company_id, p_employee_id, p_incident_id, p_body)
employee_append_incident_photos(p_company_id, p_employee_id, p_incident_id, p_photo_urls)
```

Incident detail shows:
- Header: title, severity, category, status, occurred at, location
- Photos grid (signed URLs from `workforce-media`)
- Status history timeline
- Comments thread (add comment input at bottom)
- Add more photos button

---

## PART H — MY NOTIFICATIONS

**File:** `src/app/dashboard/employee/notifications/page.tsx`

### RPCs
```
employee_get_my_notifications_for_employee(p_employee_id uuid)
  → Returns app_notifications for this employee

employee_mark_notification_read_for_employee(p_employee_id uuid, p_notification_id bigint)
  → Marks a notification as read
```

### Display
Per notification row:
- Icon (derived from `type` — same `TYPE_COLORS` map as HR notifications page)
- Title
- Body
- Time ago
- Unread dot (if not in `read_by_ids` or equivalent read flag)
- Tap → mark as read

Mark all read button at top.

---

## PART I — SHARED PAGES (employee-accessible, already built)

These pages work for all authenticated users regardless of `access_level`. No changes needed:
- `/dashboard/messages` — Messages (DM + threads) ✅ Wave 3
- `/dashboard/profile` — My Profile ✅ Wave 3
- `/dashboard/profile/payslips` — My Payslips ⏳ Wave 4 brief written
- `/dashboard/profile/leave` — My Leave (view only) ⏳ Wave 4 brief written
- `/dashboard/profile/documents` — My Documents ⏳ Wave 4 brief written

---

## PART J — EXECUTION ORDER

Execute in this exact order. Each step must `tsc --noEmit` clean before moving to the next.

1. **Routing guard** — update `proxy.ts` / `middleware.ts` with access_level check (Part A). Test: employee login redirects to `/dashboard/employee/overview`. HR login stays on `/dashboard/overview`.

2. **Employee sidebar + layout** — create `EmployeeSidebar.tsx` and `src/app/dashboard/employee/layout.tsx` (Part B). Test: sidebar renders for `/dashboard/employee/*` routes.

3. **Employee overview** — `src/app/dashboard/employee/overview/page.tsx` (Part C). This is the most complex page — Clock card, jobs strip, attendance sessions, activity feed.

4. **My Jobs** — `src/app/dashboard/employee/jobs/page.tsx` (Part D). Scope tabs + status filters.

5. **My Leave** — `src/app/dashboard/employee/leave/page.tsx` (Part E). Balances + list + inline form.

6. **My Attendance** — `src/app/dashboard/employee/attendance/page.tsx` (Part F).

7. **My Incidents** — 3 files (Part G): list + new form + detail.

8. **My Notifications** — `src/app/dashboard/employee/notifications/page.tsx` (Part H).

9. **Ship Wave 4 MY RECORD** — `profile/payslips`, `profile/leave`, `profile/documents` (already briefed).

10. **TypeScript clean check** — `npx tsc --noEmit` must return zero errors across ALL files.

11. **Commit** — `feat: employee portal — routing guard, dashboard, jobs, leave, attendance, incidents, notifications`

---

## PART K — VERIFICATION CHECKLIST

| # | Test | Expected |
|---|------|----------|
| 1 | Login as employee account | Redirected to `/dashboard/employee/overview`, NOT HR dashboard |
| 2 | Login as HR/owner | Stays on `/dashboard/overview`, NOT employee dashboard |
| 3 | Employee navigates to `/dashboard/employees` | Redirected back to `/dashboard/employee/overview` |
| 4 | HR navigates to `/dashboard/employee/overview` | Redirected to `/dashboard/overview` |
| 5 | Employee dashboard — clock status | Shows "Clocked In" or "Clocked Out" based on last punch |
| 6 | Clock In — confirm job association | Prompt appears, selecting a job links punch to job |
| 7 | Clock In — on leave today | Button shows "On Leave", clicking shows alert, punch NOT inserted |
| 8 | Clock In — marked absent | Button shows "Absent Today", clicking shows alert, punch NOT inserted |
| 9 | Clock In — with optional note | Note saved on punch |
| 10 | Clock Out | Status flips to Clocked Out, last punch time updates |
| 11 | Dashboard attendance strip | Shows recent sessions with date/in/out/duration |
| 12 | Dashboard jobs strip | Shows open jobs assigned to this employee |
| 13 | Dashboard — colleagues on leave | Shows names if any approved leave today |
| 14 | Dashboard — absent today banner | Appears if employee has reported absence for today |
| 15 | My Jobs — scope: Assigned | Only shows jobs assigned by others |
| 16 | My Jobs — scope: Created | Only shows jobs created by this employee |
| 17 | My Jobs — status filter: Open | Only open jobs shown |
| 18 | My Jobs — tap job | Navigates to job card detail (stub ok for now) |
| 19 | My Leave — balances section | Shows correct annual/taken/pending/remaining per type |
| 20 | My Leave — list | Pending requests shown first |
| 21 | My Leave — apply form | All fields present, submits via RPC, new request appears in list |
| 22 | My Leave — edit pending | Edit button shown only on pending requests, form pre-populated |
| 23 | My Leave — validation | "End date cannot be before start date" shown when violated |
| 24 | Attendance page — default view | Last 7 days of sessions shown |
| 25 | Attendance page — date filter | Switching range reloads correct data |
| 26 | Attendance page — open session | Shows current session with "—" for time out |
| 27 | My Incidents — list | Own incidents shown with severity badges |
| 28 | File new incident | Form submits, incident appears in list |
| 29 | Incident detail — comments | Can add comment, comment appears |
| 30 | Notifications — unread | Blue dot on unread items |
| 31 | Notifications — mark as read | Dot disappears on tap |
| 32 | Pending employee | Dashboard shows approval-pending banner, clock disabled |
| 33 | Employee sidebar | Shows only employee-relevant items (no Employees, Payroll, etc.) |
| 34 | `npx tsc --noEmit` | Zero errors |

---

## APPENDIX — HR DASHBOARD REMAINING PAGES (separate briefs)

The following HR Dashboard pages exist in the MAUI app but have NOT been audited in kaisync-web. Each needs its own brief before the engineer can implement. Brief these in priority order after the employee portal ships:

| Priority | MAUI Page | kaisync-web Route | Brief Status |
|----------|-----------|-------------------|--------------|
| 1 | `HrApplyLeavePage` / Leave list | `/dashboard/leave` + `/leave/apply` | ❌ Not written |
| 2 | `HrPaymentsPage` + `HrPayslipDetailPage` + `HrPayrollSettingsPage` | `/dashboard/payroll/*` | ❌ Not written |
| 3 | `HrJobDetailsPage` | `/dashboard/jobs/[id]` | ❌ Not written |
| 4 | `HrIncidentsPage` + `HrIncidentDetailsPage` | `/dashboard/incidents/*` | ❌ Not written |
| 5 | `HrContractorDetailsPage` + `HrJobContractorDocsPage` | `/dashboard/contractors/[id]` | ❌ Not written |
| 6 | `ClientDetailPage` | `/dashboard/clients/[id]` | ❌ Not written |
| 7 | `HrProjectDetailPage` | `/dashboard/projects/[id]` | ❌ Not written |
| 8 | `HrWorkTeamsPage` + `HrWorkTeamDetailsPage` | `/dashboard/work-teams/*` | ❌ Not written |
| 9 | `HrSchedulingPage` | `/dashboard/scheduling` | ❌ Not written |
| 10 | `HrShiftTemplatesPage` + `HrCreateTimeTemplatePage` | `/dashboard/time-templates/*` | ❌ Not written |
| 11 | `HrInventoryPage` + `HrInventoryDetailPage` | `/dashboard/inventory/*` | ❌ Not written |
| 12 | `HrCompliancePacksPage` | `/dashboard/compliance-packs` | ❌ Not written |
| 13 | `HrSuppliersPage` | `/dashboard/suppliers` | ❌ Not written |
| 14 | `HrPropertiesPage` + `HrResidentsPage` | `/dashboard/properties` + `/residents` | ❌ Not written |
| 15 | `HrAssetsPage` | `/dashboard/assets` | ❌ Not written |
| 16 | `HrReportsPage` | `/dashboard/reports` | ❌ Not written |
| 17 | `HrSettingsPage` | `/dashboard/settings` | ❌ Not written |
| 18 | `HrActivityLogPage` | `/dashboard/activity-log` | ❌ Not written |
| 19 | `HrActiveSessionsPage` | `/dashboard/active-sessions` | ❌ Not written |
| 20 | `HrTeamPunchPage` | `/dashboard/team-punch` | ❌ Not written |
| 21 | `HrSimpleThreadChatPage` | `/dashboard/jobs/[id]/chat` | ❌ Not written |
