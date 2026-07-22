# KaiFlow Web Platform — Phase 2 Architecture Specification

**Version:** 1.0  
**Date:** 2026-07-09  
**Scope:** Create Employee · Employee Detail · Edit Employee · Jobs list · Create Job  
**Depends on:** Phase 1 complete (design tokens, sidebar, auth, dashboard shell)

---

## 0. Pre-work — Move the Project Folder

Before starting Phase 2, move `kaisync-web` inside the shared workspace so it lives alongside the other KaiFlow projects:

```powershell
Move-Item "C:\Users\NN\Documents\KaiFlow\kaisync-web" `
           "C:\Users\NN\Documents\KaiFlow\Workforce App\kaisync-web"
```

After moving, verify the dev server still starts:
```powershell
cd "C:\Users\NN\Documents\KaiFlow\Workforce App\kaisync-web"
npm run dev
```

No code changes are needed — Next.js has no dependency on its parent directory path.

---

## 1. New Routes

```
/dashboard/employees/new          → Create Employee form
/dashboard/employees/[id]         → Employee Detail (Overview / Payments / Leave / Documents tabs)
/dashboard/employees/[id]/edit    → Edit Employee form
/dashboard/jobs                   → Jobs list (full page — replaces Phase 1 stub)
/dashboard/jobs/new               → Create Job form
```

All routes sit inside the existing `dashboard/layout.tsx` shell (sidebar + top bar).

---

## 2. Create Employee (`/dashboard/employees/new`)

**Source:** `Views/Hr/HrCreateEmployeePage.xaml`

Single-column scrollable page, `padding: 16px`, `gap: 16px`. Page title: `"New Employee"`.

### 2.1 Layout

```tsx
<div className="p-4 space-y-4 max-w-2xl">
  {/* Section cards stacked vertically */}
  <PersonalInfoCard />
  <EmploymentCard />
  <RatesHoursCard />
  <InviteToggleCard />
  {errorMessage && <p className="text-error text-[13px]">{errorMessage}</p>}
  <button className="w-full h-[52px] bg-primary text-white rounded-md font-semibold">
    Create Employee
  </button>
</div>
```

### 2.2 Section: PERSONAL INFO

Card (`bg-surface border border-divider rounded-lg p-4 space-y-3`):

| Field | Type | Placeholder |
|-------|------|-------------|
| First name * | text input | `First name` |
| Last name * | text input | `Last name` |
| Email | email input | `employee@email.com` |
| Phone | tel input | `+27...` |
| ID / Passport number | text input | `e.g. 9001015009087` |

Below the ID field, hint text: `"The employee uses this + company code to sign in."` — 11px, text-secondary.

All inputs use the standard DarkEntry class: `h-12 px-3 rounded-sm bg-surface-elevated border border-border text-body-md`.

### 2.3 Section: EMPLOYMENT

Card (`space-y-3`):

| Field | Type | Options / Placeholder |
|-------|------|----------------------|
| Position / Role | text input | `e.g. Cleaner, Guard, Technician` |
| Branch | `<select>` | Populated from `branches` table |
| Time Template | `<select>` | Populated from `shift_templates` table; when selected, show summary chip below in primary colour |
| Employment type | `<select>` | Permanent / Contract / Part-Time / Student |
| Worker type | `<select>` | DB-driven |
| Access level | `<select>` | employee / manager / hr / owner |
| Reports to (manager) | `<select>` | Employees with manager/hr/owner access |
| Employment date | `<input type="date">` | Styled to match — `dd MMM yyyy` display format |

Below "Reports to": hint text `"Links this person to a manager for attendance, teams, and project visibility."` — 11px, text-secondary.

Shift template summary chip (shown when template selected):
```tsx
<div className="bg-surface rounded-sm px-[10px] py-[6px] border-0">
  <p className="text-body-sm text-primary">{shiftTemplateSummary}</p>
</div>
```

### 2.4 Section: RATES & HOURS

Card (`space-y-3`):

- **Monthly salary (R)** — numeric input, placeholder `0.00`
- **Pay type display** — shown when `usesAutomaticMonthlyPay`: 14px medium, primary colour (read-only label)
- **"Pay by hour/day instead"** toggle row — full-width flex between label and `<Toggle />`
- **Pay basis** `<select>` — shown only when toggle is on
- **PAYE rate %** — numeric input, placeholder `Company default`
- **Exempt from UIF** — toggle row

**Monthly deductions sub-section** label: `"MONTHLY DEDUCTIONS (R)"` (LabelSection)

2-column grid:
- Medical aid + Pension (row 1)
- Union (row 2, col 0 only)

All numeric inputs.

**Work schedule:**
- Work days per week — numeric, placeholder `5`
- Daily hours — numeric, placeholder `8`

**Auto-calculated (read-only):**

Divider → caption: `"Auto-calculated from monthly salary"` → 2-column grid:
- Daily rate (R) — read-only input, text-primary colour
- Hourly rate (R) — read-only input, text-primary colour

Read-only styling:
```tsx
<input readOnly className="... bg-surface-elevated text-primary cursor-default" />
```

### 2.5 Section: INVITE TOGGLE

Card:
```tsx
<div className="flex items-center justify-between">
  <div>
    <p className="text-body-lg">Send email invite</p>
    <p className="text-caption text-text-secondary">Employee will receive a login link</p>
  </div>
  <Toggle checked={sendInvite} onChange={setSendInvite} />
</div>
```

### 2.6 Supabase Call

```typescript
// INSERT into employees, then optionally trigger invite email
const { data, error } = await supabase
  .from('employees')
  .insert({
    company_id: currentCompanyId,
    name: firstName,
    surname: lastName,
    email,
    phone,
    id_number: idNumber,
    position,
    branch_id: selectedBranch?.id,
    shift_template_id: selectedTemplate?.id,
    employment_type: employmentType,
    worker_type: workerType,
    access_level: accessLevel,
    manager_id: selectedManager?.id,
    employment_date: employmentDate,
    monthly_salary: monthlySalary,
    // ... deductions, rates
    is_active: true,
  })
  .select()
  .single()

// On success → router.push(`/dashboard/employees/${data.id}`)
// If sendInvite → supabase.auth.admin is not available client-side;
//   call existing invite RPC: supabase.rpc('send_employee_invite', { employee_id: data.id })
```

---

## 3. Employee Detail (`/dashboard/employees/[id]`)

**Source:** `Views/Hr/HrEmployeeDashboardPage.xaml`

Two-part layout: **sticky header** (hero + info chips + tab bar) + **scrollable tab content**.

```tsx
<div className="flex flex-col h-full overflow-hidden">
  <EmployeeHeroHeader employee={employee} />       {/* sticky */}
  <EmployeeTabBar tab={tab} setTab={setTab} />     {/* sticky */}
  <div className="flex-1 overflow-y-auto p-4 space-y-4">
    {tab === 'overview'  && <OverviewTab />}
    {tab === 'payments'  && <PaymentsTab />}
    {tab === 'leave'     && <LeaveTab />}
    {tab === 'documents' && <DocumentsTab />}
  </div>
</div>
```

### 3.1 Hero Header

`bg-white border-b border-divider`

```tsx
<div className="px-4 pt-[18px] pb-4 flex items-start gap-[14px]">
  {/* Avatar — 72×72 circle, bg-primary, initials 24px bold white */}
  <div className="w-18 h-18 rounded-full bg-primary flex items-center justify-center shrink-0">
    <span className="text-[24px] font-bold text-white">{employee.initials}</span>
  </div>

  {/* Name + badges */}
  <div className="flex-1 space-y-[5px]">
    <p className="text-[19px] font-bold text-text-primary truncate">{employee.fullName}</p>
    {employee.position && (
      <p className="text-[13px] text-text-secondary">{employee.position}</p>
    )}
    <div className="flex gap-[6px]">
      {/* Active/Inactive badge */}
      <span className={cn(
        "text-[11px] font-semibold px-2 py-[3px] rounded-[10px]",
        employee.isActive
          ? "bg-[#DCFCE7] text-[#166534]"
          : "bg-[#FEE2E2] text-[#991B1B]"
      )}>
        {employee.isActive ? 'Active' : 'Inactive'}
      </span>
      {/* Employment type badge */}
      <span className="text-[11px] text-text-secondary bg-surface-elevated border border-divider px-2 py-[3px] rounded-[10px]">
        {employee.employmentType}
      </span>
    </div>
  </div>

  {/* Edit Profile button */}
  <a href={`/dashboard/employees/${employee.id}/edit`}
     className="border border-primary text-primary rounded-sm h-10 px-[14px] text-[13px] font-medium flex items-center whitespace-nowrap">
    Edit Profile
  </a>
</div>
```

**Payroll readiness banner** (shown to payroll-permitted users only):
```tsx
<div className={cn(
  "mx-4 mb-2 px-3 py-[10px] rounded-[10px] bg-surface-elevated border",
  payrollReady ? "border-success" : "border-warning"
)}>
  <p className={cn("text-[13px] font-semibold", payrollReady ? "text-success" : "text-warning")}>
    Payroll: {payrollReadiness.statusLabel}
  </p>
  {!payrollReady && payrollReadiness.issues.map(issue => (
    <p key={issue} className="text-[12px] text-text-secondary">• {issue}</p>
  ))}
</div>
```

**Info chips row** — horizontal scroll, `px-4 pb-[10px] gap-2`:

Each chip: `bg-surface-elevated border border-divider rounded-sm px-2 py-[5px] flex items-center gap-[5px]`

Chips (shown when value present): ID · Access · Since (employment date) · Branch · Email · Phone

```tsx
{employee.idNumber && (
  <div className="chip">
    <span className="text-[11px] text-text-secondary">ID</span>
    <span className="text-[11px] font-medium text-text-primary">{employee.idNumber}</span>
  </div>
)}
```

### 3.2 Tab Bar

`bg-white border-b border-divider px-3 py-2` — 4-column grid, gap-[6px]:

Tabs: `Overview | Payments | Leave | Documents`

Active: `bg-primary text-white`, inactive: `bg-[#F3F5FB] text-text-secondary`, both: `rounded-sm h-10 font-medium text-[12px]`

Payments tab only shown to users with payroll permission.

### 3.3 Overview Tab Content

**KPI Row** (3 cols):

| Label | Value | Colour |
|-------|-------|--------|
| Hours / Month | `{x:F1}h` | primary |
| Pay Due | `R{x:N0}` | success (#22C55E) |
| Punches | count | text-primary |

Each KPI: white card, value 18px bold, label 10px regular text-secondary, centred.

**Banking Details section:**

Section label + card:
- 2-col grid: Account (masked) · Bank · Branch code
- `"Edit Banking"` button (`bg-surface-elevated text-primary h-9 px-[14px] rounded-sm`)
- If no banking: `"No banking details on file yet."` caption

**Attendance section:**

Period pills: `Today | This Week | This Month | Custom`

Custom range row (when "Custom" active): two `<input type="date">` fields + dash separator + `Apply` button

Period totals (3-col KPI): Sessions · Hours · Late count

Attendance table below (same shared `AttendanceSessionTable` component from Phase 1).

### 3.4 Payments Tab Content

Leave as a table matching the payroll table from Phase 1 (§10) but filtered to this employee. Add month picker at the top.

### 3.5 Leave Tab Content

Same leave request list from Phase 1 §7.5 — filtered to this employee. Include `"Apply Leave"` primary button at the top.

### 3.6 Documents Tab Content

List of employee documents. For Phase 2: show `"No documents yet."` empty state with `"Upload Document"` button (file upload — defer to Phase 3 if file handling is not ready).

---

## 4. Edit Employee (`/dashboard/employees/[id]/edit`)

**Source:** `Views/Hr/HrEditEmployeePage.xaml`

Two-part layout: **sticky header** + **scrollable form**.

### 4.1 Sticky Header

`bg-white border-b border-divider`:

```tsx
{/* Top row: name + active/inactive toggle */}
<div className="flex items-center justify-between px-4 pt-4 pb-[10px] gap-3">
  <div>
    <p className="text-[19px] font-bold text-text-primary truncate">{employeeFullName}</p>
    <p className="text-[12px] text-text-secondary">Editing employee record</p>
  </div>
  {/* Active toggle chip */}
  <div className={cn(
    "flex items-center gap-2 px-[10px] py-[6px] rounded-[10px]",
    isActive ? "bg-[#DCFCE7]" : "bg-[#FEE2E2]"
  )}>
    <span className={cn("text-[12px] font-semibold", isActive ? "text-[#166534]" : "text-[#991B1B]")}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
    <Toggle checked={isActive} onChange={setIsActive} />
  </div>
</div>

{/* Action buttons row: 3 cols */}
<div className="grid grid-cols-3 gap-2 px-4 pb-[14px]">
  <button className="bg-primary text-white h-11 rounded-sm font-semibold text-[13px]">
    Save Changes
  </button>
  <button className="border border-primary text-primary h-11 rounded-sm font-medium text-[13px]">
    Send Invite
  </button>
  <button className="bg-error text-white h-11 rounded-sm font-semibold text-[13px]">
    Archive
  </button>
</div>

{errorMessage && (
  <p className="px-4 pb-[10px] text-error text-[13px]">{errorMessage}</p>
)}
```

### 4.2 Scrollable Form

Same section cards as Create Employee (§2.2–2.4) with one addition — **Banking Details** section at the end:

```
Section: BANKING DETAILS
  - Bank name (text input)
  - Account number (text input)
  - Branch code (text input)
  - Account type (select: Cheque / Savings / Transmission)
```

Pre-populated with existing employee data. On save: `supabase.from('employees').update({...}).eq('id', employeeId)` then navigate back to `/dashboard/employees/[id]`.

**Archive action:** confirmation dialog (`"This will deactivate the employee. Continue?"`) → set `is_active = false`.

---

## 5. Jobs List Page (`/dashboard/jobs`)

**Source:** `Views/Hr/HrJobsPage.xaml`

Replaces the Phase 1 stub. Full implementation.

### 5.1 Layout

```tsx
<div className="p-3 flex flex-col gap-3">
  <ScopeToggle />       {/* All / Mine */}
  <ListSummary />       {/* "X jobs" caption */}
  <FilterToolbar />     {/* search + filter drawer */}
  <JobsTable />         {/* horizontally scrollable */}
</div>
```

### 5.2 Scope Toggle

2-col grid, full width:
```tsx
{['all', 'mine'].map(scope => (
  <button
    key={scope}
    className={cn(
      "h-9 rounded-[10px] text-[12px] font-medium",
      activeScope === scope ? "bg-primary text-white" : "bg-white text-text-secondary"
    )}
  >
    {scope === 'all' ? allLabel : mineLabel}
  </button>
))}
```

### 5.3 Filter Toolbar

Search input + collapsible filter drawer (click a "Filter" button to expand):

**Inside filter drawer:**
- Date filter toggle (switch)
- When on: From date + To date pickers (side by side)
- Status pills (horizontal scroll): `Open | All | Scheduled | In Progress | Completed | Cancelled`

Active pill: `bg-primary text-white`, inactive: `bg-white text-[#6B7280]`, all: `rounded-full h-8 px-[14px] text-[11px]`

### 5.4 Jobs Table

Horizontally scrollable, min-width 980px:

| Col | Header | Width |
|-----|--------|-------|
| Code | 90px |
| Title | 180px |
| Client | 140px |
| Status | 100px |
| Priority | 90px |
| Start | 110px |
| End | 110px |
| Assigned | 120px |
| Cost | 90px right-aligned |

**Status badge colours:**
- `open` → `bg-[#DBEAFE] text-[#1D4ED8]`
- `scheduled` → `bg-[#FEF3C7] text-[#92400E]`
- `in_progress` → `bg-[#DCFCE7] text-[#166534]`
- `completed` → `bg-surface-elevated text-text-secondary`
- `cancelled` → `bg-[#FEE2E2] text-[#991B1B]`

**Priority badge colours:**
- `high` → `bg-[#FEE2E2] text-error`
- `medium` → `bg-[#FEF3C7] text-[#92400E]`
- `low` → `bg-surface-elevated text-text-secondary`

Header buttons (right of top bar): `Export` (surface-elevated) + `+ New Job` (primary) → navigates to `/dashboard/jobs/new`.

Row click → navigate to job detail (Phase 3 scope — show as non-clickable for now, or navigate to a "Coming soon" placeholder at `/dashboard/jobs/[id]`).

### 5.5 Supabase Call

```typescript
const { data } = await supabase
  .from('jobs')
  .select('*, clients(name)')
  .eq('company_id', companyId)
  .order('created_at', { ascending: false })

// Apply scope filter (mine = where assigned_employee_id = currentUser.id)
// Apply status filter
// Apply date range filter
```

---

## 6. Create Job (`/dashboard/jobs/new`)

**Source:** `Views/Hr/HrCreateJobPage.xaml`

Scrollable form, `padding: 16px`, `gap: 16px`. Page title: `"New Job"`.

### 6.1 Section: JOB DETAILS

Card:

| Field | Type | Notes |
|-------|------|-------|
| Title * | text input | Required |
| Description / Notes | `<textarea>` | Auto-grows, min-height 80px |
| Priority | `<select>` | Low / Medium / High |
| Estimated cost (R) | numeric input | Placeholder `0.00` |

### 6.2 Section: SCHEDULE

Card:

| Field | Type |
|-------|------|
| Start date | `<input type="date">` |
| Start time | `<input type="time">` |
| End date | `<input type="date">` |
| End time | `<input type="time">` |

### 6.3 Section: CLIENT

Card:
- Client `<select>` — populated from `clients` table (name + code)
- `"+ Add new client"` text link below (navigates to client create — Phase 3 scope; show as disabled for now)

### 6.4 Section: LOCATION

Card:
- Address — text input
- (Phase 3: map picker integration)

### 6.5 Section: ASSIGNMENT

Card:
- Assign to employee `<select>` — optional, populated from active employees

### 6.6 Action

```tsx
{errorMessage && <p className="text-error text-[13px]">{errorMessage}</p>}
<button className="w-full h-[52px] bg-primary text-white rounded-md font-semibold">
  Create Job
</button>
```

### 6.7 Supabase Call

```typescript
const { data, error } = await supabase
  .from('jobs')
  .insert({
    company_id: companyId,
    title,
    description,
    priority,
    estimated_cost: estimatedCost,
    scheduled_start: combinedStartDateTime,
    scheduled_end: combinedEndDateTime,
    client_id: selectedClient?.id,
    address,
    assigned_employee_id: selectedEmployee?.id,
    status: 'open',
  })
  .select()
  .single()

// On success → router.push('/dashboard/jobs')
```

---

## 7. Shared Components Added in Phase 2

These are new reusable components that multiple Phase 2 screens use:

### 7.1 `<Toggle />`

Custom toggle switch matching MAUI Switch with `OnColor="#3B82F6"`. Use a simple CSS-animated checkbox:

```tsx
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-[44px] h-[26px] rounded-full transition-colors",
        checked ? "bg-primary" : "bg-[#D1D5DB]"
      )}
    >
      <span className={cn(
        "absolute top-[3px] w-5 h-5 bg-white rounded-full shadow transition-transform",
        checked ? "translate-x-[21px]" : "translate-x-[3px]"
      )} />
    </button>
  )
}
```

### 7.2 `<FormSelect />`

Wrapper around native `<select>` with consistent styling:
```tsx
<select className="w-full h-12 px-3 rounded-sm bg-surface-elevated border border-border
                   text-body-md text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40
                   appearance-none bg-no-repeat bg-[right_12px_center]">
```

### 7.3 `<FormDateInput />`

`<input type="date">` with the DarkEntry styling, formatted display.

---

## 8. Phase 2 Delivery Checklist

| Item | Status |
|------|--------|
| Move `kaisync-web` into `Workforce App/` folder | ⬜ |
| `/dashboard/employees/new` — Create Employee (all 4 sections) | ⬜ |
| `/dashboard/employees/[id]` — Employee Detail (hero + 4 tabs) | ⬜ |
| `/dashboard/employees/[id]/edit` — Edit Employee (sticky header + form) | ⬜ |
| `/dashboard/jobs` — Full Jobs list (scope toggle + filter + table) | ⬜ |
| `/dashboard/jobs/new` — Create Job (all sections) | ⬜ |
| Shared: `<Toggle />`, `<FormSelect />`, `<FormDateInput />` | ⬜ |
| Wire "Create Employee" button in Phase 1 Employees page → `/new` | ⬜ |
| Wire employee row click → `/dashboard/employees/[id]` | ⬜ |
| Wire "+ New Job" button in Phase 1 Jobs tab → `/dashboard/jobs/new` | ⬜ |
| TypeScript check — 0 errors | ⬜ |

---

## 9. Out of Scope for Phase 2

- Job detail page (`/dashboard/jobs/[id]`) — deferred to Phase 3
- Contractors full module
- Messages / Notifications
- Employee document upload (file handling)
- Team creation / edit forms
- Leave application form (`HrApplyLeavePage`)
