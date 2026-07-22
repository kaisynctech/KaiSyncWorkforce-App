# MIS-2026-00004 — Employees Page — Missing Tabs and Filters

**Mission ID:** MIS-2026-00004  
**Priority:** High  
**Affects:** kaisync-web — `/dashboard/employees`  
**Gap reference:** GAP-08, GAP-09, GAP-10, GAP-11, GAP-24, GAP-25, GAP-26, GAP-27  

---

## Summary

The Employees page currently shows a single flat list with basic search/role/status filters. The MAUI app has four tabs (Employees, Teams, Leave, Pending), branch and employment-type filters, an on-leave-today section, full leave balance calculations, and a role-gated Leave tab. This Mission brings all of it to the web.

---

## Business Objective

Give HR managers the complete workforce overview they need: who's on leave today, which employees have leave remaining, who's waiting for registration approval, and full team management — without switching to the mobile app.

---

## Current Behaviour

- Single list view
- Filters: search, role, status only
- No tabs
- No branch filter
- No employment type filter
- No leave balance display
- No on-leave-today
- No pending registrations

---

## Expected Behaviour

Four tabs across the top:

**Tab 1 — Employees** (current list, enhanced)
- Add branch filter pill row
- Add employment type filter: Permanent / Contract / Part-time / Student
- Add "On Leave Today" section above the table — shows employees with approved leave covering today
- Existing table remains unchanged otherwise

**Tab 2 — Teams**
- List of work teams (name, member count, active/inactive status)
- "+ Create Team" button — opens an inline modal: enter team name → creates team in `work_teams` table
- Clicking a team navigates to `/dashboard/work-teams/[id]`

**Tab 3 — Leave** *(visible only to users with `CanSeeLeaveAdmin` permission)*
- Table: Employee | Leave Type | Annual Days | Used Days | Remaining | Last Request
- Annual days and used days calculated from `leave_policy` and `leave_requests`
- Search and leave-type filter on this tab

**Tab 4 — Pending**
- List of employees where `is_active = false` and `registration_status = 'pending'` (or equivalent)
- Each row: employee name, email, submitted date, Approve / Reject buttons
- "Approve All" button at top
- Approve calls `approve_pending_employee(p_employee_id)` RPC ✓
- Reject calls `reject_pending_employee(p_employee_id)` RPC ✓

---

## Architecture

### Tab state

```typescript
type Tab = 'employees' | 'teams' | 'leave' | 'pending'
const [tab, setTab] = useState<Tab>('employees')
```

Render tabs as pill buttons. Fetch data lazily per tab (only fetch when tab is first opened).

---

### Tab 1 — Employees enhancements

#### Branch filter

```typescript
// Load branches for this company
const { data: branches } = await supabase
  .from('branches')
  .select('id, name')
  .eq('company_id', companyId)
  .order('name')

// Filter employees
.eq('branch_id', selectedBranchId) // add to existing query if branch selected
```

Render as a horizontal scroll of pill chips: "All Branches" + one per branch.

#### Employment type filter

Add to existing filter toolbar. Values: `'all' | 'permanent' | 'contract' | 'part_time' | 'student'`

Map to `employees.employment_type` column (verify column name in `types/database.ts`).

#### On Leave Today

```typescript
// After loading employees, check which have approved leave covering today
const today = new Date().toISOString().split('T')[0]
const { data: onLeave } = await supabase
  .from('leave_requests')
  .select('employee_id, leave_type, end_date, employees(name, surname)')
  .eq('company_id', companyId)
  .eq('status', 'approved')
  .lte('start_date', today)
  .gte('end_date', today)
```

Render as a collapsible row above the main table:
```
📅 On Leave Today (3)  [show/hide toggle]
  → Nyarie Doe — Annual Leave (back 15 Jul)
  → John Smith — Sick Leave (back 16 Jul)
```

---

### Tab 2 — Teams

```typescript
const { data: teams } = await supabase
  .from('work_teams')
  .select('id, name, is_active, members:work_team_members(count)')
  .eq('company_id', companyId)
  .order('name')
```

Create Team modal:
```typescript
async function createTeam(name: string) {
  await supabase.from('work_teams').insert({
    company_id: companyId,
    name: name.trim(),
    is_active: true,
  })
  await loadTeams()
}
```

---

### Tab 3 — Leave balances

Leave balance logic:

```typescript
type LeaveBalance = {
  employeeId: string
  employeeName: string
  leaveType: string
  annualDays: number
  usedDays: number
  remaining: number
  lastRequestDate: string | null
}

// 1. Load payroll_settings for annual leave days
// 2. Load all approved leave_requests for this company YTD
// 3. Per employee per leave type: sum total_days where status = 'approved'
//    and start_date >= first day of current year

const yearStart = `${new Date().getFullYear()}-01-01`

const { data: leaveRequests } = await supabase
  .from('leave_requests')
  .select('employee_id, leave_type, total_days, start_date, status, employees(name, surname)')
  .eq('company_id', companyId)
  .eq('status', 'approved')
  .gte('start_date', yearStart)
  .order('start_date', { ascending: false })

// Group and sum per employee+type
// Annual days default: 15 for annual_leave, 30 for sick_leave, etc.
// Check payroll_settings for configured annual leave days
```

**CanSeeLeaveAdmin gate:**

```typescript
// Check if current user's employee has role 'admin' or 'hr_admin' or 'owner'
// Use employees.role field — if role is 'employee' or 'manager' without leave admin,
// hide the Leave tab entirely
const canSeeLeaveAdmin = ['admin', 'hr_admin', 'owner'].includes(myRole ?? '')
```

---

### Tab 4 — Pending Registrations

```typescript
const { data: pending } = await supabase
  .from('employees')
  .select('id, name, surname, email, created_at, registration_status')
  .eq('company_id', companyId)
  .eq('is_active', false)
  // Use the correct filter — check types/database.ts for the pending status column
  // Could be: .eq('registration_status', 'pending') OR .is('approved_at', null)
  .order('created_at', { ascending: false })

async function approvePending(employeeId: string) {
  await supabase.rpc('approve_pending_employee', { p_employee_id: employeeId })
  await loadPending()
}

async function rejectPending(employeeId: string) {
  await supabase.rpc('reject_pending_employee', { p_employee_id: employeeId })
  await loadPending()
}

async function approveAll() {
  for (const emp of pending) {
    await supabase.rpc('approve_pending_employee', { p_employee_id: emp.id })
  }
  await loadPending()
}
```

**Important:** Before implementing, verify the exact column/value used to identify pending employees. Check `types/database.ts` for the `Employee` type — look for `registration_status`, `pending_approval`, `is_pending`, or similar. The `approve_pending_employee` RPC exists and is confirmed working.

---

## Database Impact

None for Tab 1, 2, 4. No migrations required.

For Tab 3 (leave balances): all data is in `leave_requests` and `payroll_settings` — no new tables needed.

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/employees/page.tsx` | Full overhaul — add 4-tab structure, all features above |

---

## Regression Risks

- The existing employee list (Tab 1) must remain functionally identical — only add the new filters and on-leave section on top.
- `employees.employment_type` column name must be verified in `types/database.ts` before implementing the type filter.
- Pending employee detection logic depends on the exact column — engineer must check schema before writing the query.
- Leave balance calculation uses `total_days` on `leave_requests` — confirm this column exists.

---

## Testing Requirements

1. Tab 1: Select a branch filter — only employees in that branch shown.
2. Tab 1: Select "Contract" type filter — only contract employees shown.
3. Tab 1: On-leave-today section shows correct employees.
4. Tab 2: Create a team — appears in list; click to navigate to work-teams/[id].
5. Tab 3: Leave balances show correct used/remaining days (cross-check with a known employee's leave history).
6. Tab 3: Hidden for a user with role 'employee'.
7. Tab 4: Approve one pending employee — disappears from list, becomes active.
8. Tab 4: Reject one pending employee — disappears from list.

---

## Acceptance Criteria

- [ ] Four tabs render and switch correctly
- [ ] Branch filter works
- [ ] Employment type filter works
- [ ] On-leave-today section accurate for today's date
- [ ] Teams tab: create team, list teams, navigate to detail
- [ ] Leave tab hidden for non-admin roles
- [ ] Leave balances show annual / used / remaining per employee
- [ ] Pending tab shows unapproved employees
- [ ] Approve/Reject/Approve All work and call correct RPCs

---

## Definition of Done

- All 4 tabs functional
- No TypeScript errors
- Tested with real data from Supabase
