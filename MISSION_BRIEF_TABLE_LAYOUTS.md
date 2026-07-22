# MISSION BRIEF — Table Layouts (5 Employee Pages)
**Scope:** 5 employee portal list pages  
**Files:** 5  
**Status:** READY TO IMPLEMENT  
**Priority:** HIGH — UI layout must match MAUI app

---

## Background

The MAUI app displays Jobs, Incidents, Payslips, Leave Requests, and PA Tasks as tables/lists with defined columns. The web app renders all five as cards or divide-y rows, which do not match. The directive is: if it is a table in MAUI, it must be a `<table>` in the web app.

Additionally, DB verification revealed **two field-name bugs** and **two missing fields** that must be fixed at the same time as the layout change.

---

## DB-Verified Field Summary

These are the actual field names returned by each RPC — confirmed by live query:

| Page | RPC | Bug found |
|------|-----|-----------|
| Jobs | `employee_get_jobs_for_employee` | Interface uses `due_date`; DB returns `scheduled_end`. `scope` field doesn't exist in DB — must be computed from `created_by_employee_id` / `assigned_employee_ids` |
| Incidents | `employee_get_own_incidents` | Interface missing `category` field — DB returns it (`"general"` confirmed) |
| Leave | `employee_get_leave_requests` | Interface missing `attachment_url` field — DB returns it |
| Payslips | `employee_get_payslips` | No field bugs — layout only |
| PA | `employee_get_pa_tasks` | No field bugs — layout only (Tasks tab only) |

---

## Page 1 — My Jobs (`src/app/dashboard/employee/jobs/page.tsx`)

### Bug Fix 1 — Interface `due_date` → `scheduled_end`

Replace the `Job` interface:

```ts
// REMOVE:
interface Job {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null        // ← WRONG — DB returns scheduled_end
  description: string | null
  created_at: string
  scope?: 'assigned' | 'created' // ← NOT a DB field
}

// REPLACE WITH:
interface Job {
  id: string
  title: string
  status: string | null
  priority: string | null
  scheduled_end: string | null       // ← actual DB field
  job_code: string | null
  description: string | null
  created_at: string
  assignee_employee_id: string | null
  assigned_employee_ids: string[] | null
  created_by_employee_id: string | null
}
```

### Bug Fix 2 — Scope computation

The current code filters using `j.scope === 'created'` but `scope` is never set. Replace the `filtered` computation with:

```ts
// Replace the filtered useMemo/computation with:
const filtered = jobs.filter(j => {
  const myId = empId  // empId must be stored in state: const [empId, setEmpId] = useState<string | null>(null)
  const iAssigned = Array.isArray(j.assigned_employee_ids)
    ? j.assigned_employee_ids.includes(myId ?? '')
    : j.assignee_employee_id === myId
  const iCreated = j.created_by_employee_id === myId

  if (tab === 'assigned' && !iAssigned) return false
  if (tab === 'created'  && !iCreated)  return false
  if (tab === 'all'      && !iAssigned && !iCreated) return false
  if (statusFilter !== 'all' && j.status !== statusFilter) return false
  return true
})
```

Add `empId` state and populate it in `init()`:
```ts
const [empId, setEmpId] = useState<string | null>(null)

// Inside init(), after resolveCurrentMember:
setEmpId(member.employeeId)
```

### Layout Change — divide-y → table

Replace the list section (the `<div className="divide-y divide-divider">` block) with:

```tsx
{filtered.length === 0 ? (
  <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center text-text-secondary">
    <span className="material-icons text-[48px] text-text-disabled">work_off</span>
    <p className="text-[14px]">{EMPTY_MESSAGES[tab]}</p>
  </div>
) : (
  <div className="overflow-x-auto">
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-divider bg-surface-elevated">
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Code</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Title</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Priority</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Scheduled End</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-divider">
        {filtered.map(job => (
          <tr key={job.id} className="hover:bg-surface-elevated transition-colors">
            <td className="px-4 py-3 text-[12px] text-text-disabled whitespace-nowrap">
              {job.job_code ?? '—'}
            </td>
            <td className="px-4 py-3">
              <Link href={`/dashboard/employee/jobs/${job.id}`}
                className="text-[13px] font-semibold text-primary hover:underline">
                {job.title}
              </Link>
              {job.description && (
                <p className="text-[11px] text-text-disabled mt-0.5 line-clamp-1">{job.description}</p>
              )}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              {job.status ? (
                <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${STATUS_COLORS[job.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                  {statusLabel(job.status)}
                </span>
              ) : '—'}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              {job.priority ? (
                <span className={`text-[12px] font-medium capitalize ${PRIORITY_COLORS[job.priority] ?? 'text-text-secondary'}`}>
                  {job.priority}
                </span>
              ) : '—'}
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {job.scheduled_end
                ? new Date(job.scheduled_end).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

Also remove the reference to `job.due_date` (it no longer exists in the interface) from anywhere in the render.

---

## Page 2 — My PA (`src/app/dashboard/employee/pa/page.tsx`)

Only the **Tasks tab** changes. Today, Calendar, and Search tabs stay exactly as they are.

The `TaskRow` component (card with colored left strip) is replaced in the Tasks tab only with a table. The `TaskRow` component can remain in the file because the Today tab still uses it via `todayTasks.map(t => <TaskRow .../>)`.

### Layout Change — Tasks tab only

Find this block in the Tasks tab (`{mainTab === 'tasks' && ...}`):

```tsx
{filteredTasks.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-secondary">
    <span className="material-icons text-[48px] text-text-disabled">task_alt</span>
    <p className="text-[14px]">No tasks.</p>
  </div>
) : (
  <div className="space-y-2">
    {filteredTasks.map(t => <TaskRow key={t.id} task={t} {...rowProps} />)}
  </div>
)}
```

Replace the `<div className="space-y-2">` block only (keep the empty state as-is):

```tsx
{filteredTasks.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-secondary">
    <span className="material-icons text-[48px] text-text-disabled">task_alt</span>
    <p className="text-[14px]">No tasks.</p>
  </div>
) : (
  <div className="overflow-x-auto">
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-divider bg-surface-elevated">
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Title</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Priority</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Due</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Linked</th>
          <th className="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody className="divide-y divide-divider">
        {filteredTasks.map(t => {
          const overdue = isOverdue(t)
          return (
            <tr key={t.id} className={`hover:bg-surface-elevated transition-colors ${overdue ? 'bg-error/5' : ''}`}>
              <td className="px-4 py-3">
                <Link href={`/dashboard/employee/pa/${t.id}`}
                  className={`text-[13px] font-semibold hover:underline ${overdue ? 'text-error' : 'text-primary'}`}>
                  {t.title}
                </Link>
                {t.notes && (
                  <p className="text-[11px] text-text-disabled mt-0.5 line-clamp-1">{t.notes}</p>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className={`text-[10px] font-bold px-2 py-[2px] rounded-full capitalize ${PRIORITY_BADGE[t.priority] ?? 'bg-surface-elevated text-text-disabled'}`}>
                  {t.priority}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="text-[11px] text-text-secondary capitalize">
                  {t.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {t.due_at ? (
                  <span className={`text-[12px] font-medium ${overdue ? 'text-error' : 'text-text-secondary'}`}>
                    {fmtDue(t.due_at)}
                  </span>
                ) : '—'}
              </td>
              <td className="px-4 py-3 text-[12px] text-text-disabled">
                {t.linked_label ?? '—'}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1 justify-end">
                  <button onClick={() => {
                    const supabase = createClient()
                    ;(supabase.rpc as any)('employee_update_pa_task_status', {
                      p_company_id: companyId!, p_employee_id: empId!,
                      p_task_id: t.id, p_status: 'done', p_snoozed_until: null, p_session_token: token,
                    }).then(() => init())
                  }} title="Complete" className="p-1 rounded hover:bg-success/10">
                    <span className="material-icons text-[16px] text-success">check_circle</span>
                  </button>
                  <button onClick={async () => {
                    if (!confirm(`Delete '${t.title}'?`)) return
                    const supabase = createClient()
                    await (supabase.rpc as any)('employee_delete_pa_task', {
                      p_company_id: companyId!, p_employee_id: empId!,
                      p_task_id: t.id, p_session_token: token,
                    })
                    init()
                  }} title="Delete" className="p-1 rounded hover:bg-error/10">
                    <span className="material-icons text-[16px] text-error">delete</span>
                  </button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)}
```

---

## Page 3 — My Incidents (`src/app/dashboard/employee/incidents/page.tsx`)

### Bug Fix — Add `category` to interface

```ts
// Add category to the Incident interface:
interface Incident {
  id: string
  title: string | null
  description: string
  severity: string | null
  category: string | null     // ← ADD THIS — confirmed present in DB
  status: string | null
  occurred_at: string | null
  location_text: string | null
  created_at: string
  job_id: string | null
  is_closed: boolean | null
}
```

### Layout Change — divide-y → table

Replace the list section (the `<div className="divide-y divide-divider">` block inside `{/* List */}`):

```tsx
{filtered.length === 0 ? (
  <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
    <span className="material-icons text-[48px] text-text-disabled">report_off</span>
    <p className="text-[14px]">{emptyMessage()}</p>
  </div>
) : (
  <div className="overflow-x-auto">
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-divider bg-surface-elevated">
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Title</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Severity</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Category</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Date</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Job</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-divider">
        {filtered.map(inc => (
          <tr key={inc.id} className="hover:bg-surface-elevated transition-colors">
            <td className="px-4 py-3">
              <Link href={`/dashboard/employee/incidents/${inc.id}`}
                className="text-[13px] font-semibold text-primary hover:underline">
                {inc.title ?? inc.description}
              </Link>
              {inc.title && inc.description && (
                <p className="text-[11px] text-text-disabled mt-0.5 line-clamp-1">{inc.description}</p>
              )}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              {inc.severity ? (
                <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${SEVERITY_STYLES[inc.severity] ?? 'bg-surface-elevated text-text-secondary'}`}>
                  {inc.severity}
                </span>
              ) : '—'}
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary capitalize">
              {inc.category ?? '—'}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              {inc.status ? (
                <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[inc.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                  {inc.status.replace(/_/g, ' ')}
                </span>
              ) : '—'}
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {fmtDate(inc.occurred_at ?? inc.created_at)}
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {inc.job_id ? (
                <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-primary/10 text-primary">Linked</span>
              ) : (
                <span className="text-text-disabled">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

---

## Page 4 — My Payslips (`src/app/dashboard/employee/payslips/page.tsx`)

No interface bugs. Layout change only.

### Layout Change — divide-y → table

Replace the list section (the `<div className="divide-y divide-divider">` block inside `{/* List */}`):

```tsx
{payslips.length === 0 ? (
  <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
    <span className="material-icons text-[48px] text-text-disabled">payments</span>
    <p className="text-[14px]">No payslips yet.</p>
  </div>
) : (
  <div className="overflow-x-auto">
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-divider bg-surface-elevated">
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Period</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Gross Pay</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Deductions</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Net Pay</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Paid At</th>
          <th className="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody className="divide-y divide-divider">
        {payslips.map(p => (
          <tr key={p.id} className="hover:bg-surface-elevated transition-colors">
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {fmtPeriod(p.period_start, p.period_end)}
            </td>
            <td className="px-4 py-3 font-medium text-text-primary whitespace-nowrap">
              {fmtMoney(p.gross_pay)}
            </td>
            <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
              {fmtMoney(p.deductions)}
            </td>
            <td className="px-4 py-3 font-bold text-text-primary whitespace-nowrap">
              {fmtMoney(p.net_pay)}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[p.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                {p.status}
              </span>
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {p.paid_at
                ? new Date(p.paid_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—'}
            </td>
            <td className="px-4 py-3">
              <button onClick={() => downloadPDF(p)} disabled={downloading === p.id}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-divider text-text-secondary hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                title="Download PDF">
                {downloading === p.id
                  ? <span className="material-icons animate-spin text-[16px]">refresh</span>
                  : <span className="material-icons text-[16px]">download</span>}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

---

## Page 5 — My Leave (`src/app/dashboard/employee/leave/page.tsx`)

### Bug Fix — Add `attachment_url` to interface

```ts
// Update the LeaveRequest interface:
interface LeaveRequest {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  total_days: number
  status: string
  reason: string | null
  attachment_url: string | null   // ← ADD THIS — confirmed present in DB
  created_at: string
}
```

### Layout Change — cards → table

The **Leave Summary grid** (`{/* Leave summary */}` section with `grid grid-cols-2`) stays exactly as-is.

Replace the **Leave Requests list** section — specifically the `<div className="space-y-2">` block that renders cards. Leave the form modal (`{showForm && ...}`) completely untouched.

Replace this block:

```tsx
{sorted.map(req => (
  <div key={req.id} className="bg-surface border border-divider rounded-xl p-4 flex items-start justify-between gap-3">
    ...
  </div>
))}
```

With a table:

```tsx
{sorted.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-secondary">
    <span className="material-icons text-[48px] text-text-disabled">event_available</span>
    <p className="text-[14px]">No leave requests yet</p>
  </div>
) : (
  <div className="overflow-x-auto">
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-divider bg-surface-elevated">
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Type</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Start</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">End</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Days</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Reason</th>
          <th className="px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide text-center">Doc</th>
          <th className="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody className="divide-y divide-divider">
        {sorted.map(req => (
          <tr key={req.id} className="hover:bg-surface-elevated transition-colors">
            <td className="px-4 py-3 text-[13px] font-semibold text-text-primary whitespace-nowrap">
              {req.leave_type}
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {fmtDate(req.start_date)}
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {fmtDate(req.end_date)}
            </td>
            <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
              {req.total_days}d
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[req.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                {req.status}
              </span>
            </td>
            <td className="px-4 py-3 text-[12px] text-text-disabled max-w-[160px] truncate">
              {req.reason ? <span className="italic">"{req.reason}"</span> : '—'}
            </td>
            <td className="px-4 py-3 text-center">
              {req.attachment_url ? (
                <a href={req.attachment_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-divider text-text-secondary hover:border-primary hover:text-primary transition-colors"
                  title="View attachment">
                  <span className="material-icons text-[14px]">attach_file</span>
                </a>
              ) : (
                <span className="text-text-disabled">—</span>
              )}
            </td>
            <td className="px-4 py-3">
              {req.status === 'pending' && (
                <button onClick={() => openForm(req)}
                  className="text-[12px] text-primary font-semibold hover:underline whitespace-nowrap">
                  Edit
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

---

## Pages NOT changing

- **Shifts** (`/employee/shifts`) — date-grouped calendar view. Correct MAUI equivalent. Do not change.
- **Notifications** (`/employee/notifications`) — activity feed with colored dots. Correct MAUI equivalent. Do not change.
- **Forms** (`/employee/forms`) — template card grid. Correct for a form-picker UI. Do not change.
- **Messages** (`/employee/messages`) — thread list. Correct. Do not change.

---

## Checklist

### Jobs (`jobs/page.tsx`)
- [ ] Update `Job` interface: add `scheduled_end`, `job_code`, `assignee_employee_id`, `assigned_employee_ids`, `created_by_employee_id`; remove `due_date`, remove `scope`
- [ ] Add `const [empId, setEmpId] = useState<string | null>(null)` state
- [ ] Set `setEmpId(member.employeeId)` in `init()` after `resolveCurrentMember`
- [ ] Replace `filtered` computation to use `created_by_employee_id` / `assigned_employee_ids` for scope logic
- [ ] Replace `<div className="divide-y divide-divider">` list with `<table>` (Code, Title, Status, Priority, Scheduled End)
- [ ] Remove any reference to `job.due_date` from the render

### PA (`pa/page.tsx`)
- [ ] In the Tasks tab only, replace `<div className="space-y-2">{filteredTasks.map(t => <TaskRow .../>)}</div>` with `<table>` (Title, Priority, Status, Due, Linked, Actions)
- [ ] Keep `TaskRow` component — still used by Today tab

### Incidents (`incidents/page.tsx`)
- [ ] Add `category: string | null` to `Incident` interface
- [ ] Replace `<div className="divide-y divide-divider">` list with `<table>` (Title, Severity, Category, Status, Date, Job)

### Payslips (`payslips/page.tsx`)
- [ ] Replace `<div className="divide-y divide-divider">` list with `<table>` (Period, Gross Pay, Deductions, Net Pay, Status, Paid At, Download button)

### Leave (`leave/page.tsx`)
- [ ] Add `attachment_url: string | null` to `LeaveRequest` interface
- [ ] Keep Leave Summary grid exactly as-is
- [ ] Replace `<div className="space-y-2">{sorted.map(...card...)}` with `<table>` (Type, Start, End, Days, Status, Reason, Doc, Edit)
- [ ] Keep form modal (`{showForm && ...}`) exactly as-is

---

## Verification (after deploy)

1. **Jobs** → navigate to `/dashboard/employee/jobs` — must show table with Code, Title, Status, Priority, Scheduled End columns. Scope filter tabs (Assigned / Created / All) must correctly filter rows. Confirm at least 2 jobs visible (DB confirmed 2 jobs assigned to test employee).
2. **PA** → navigate to Tasks tab — must show table (not cards). Today tab should still show `TaskRow` cards. Filters (all/todo/in_progress/overdue/done) must still work.
3. **Incidents** → navigate to `/dashboard/employee/incidents` — must show table with Category column visible (value: "general"). DB confirmed incidents exist for test employee.
4. **Payslips** → navigate to `/dashboard/employee/payslips` — table structure must render. Test employee has 0 payslips — empty state must show correctly.
5. **Leave** → navigate to `/dashboard/employee/leave` — Leave Summary grid must still appear above table. Table must show Type, Start, End, Days, Status, Reason, Doc, Edit columns. DB confirmed 3 leave requests exist.
