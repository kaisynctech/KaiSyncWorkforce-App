# MIS-2026-00006 — Leave Page — Filters, Balance Display and RPC

**Mission ID:** MIS-2026-00006  
**Priority:** High  
**Affects:** kaisync-web — `/dashboard/leave`  
**Gap reference:** GAP-13, GAP-29, GAP-30, GAP-31, GAP-32, GAP-59  

---

## Summary

The Leave page is missing a search bar, leave type filter, annual balance display, on-leave-today section, and uses a direct table update instead of the `decide_leave_request` RPC. This Mission adds all missing features and fixes the decision logic.

---

## Business Objective

Give HR managers a complete leave management view: who's off today, who has requests pending, filter by leave type, and see balances — all from one page.

---

## Current Behaviour

- Two tabs: Pending / All
- Approve/Decline actions on pending rows
- No search
- No leave type filter
- No annual balance display
- No on-leave-today section
- Approve/decline does: `supabase.from('leave_requests').update({ status: ... }).eq('id', id)` — bypasses the RPC

---

## Expected Behaviour

1. **On Leave Today section** — above the tabs, shows employees currently on approved leave
2. **Search bar** — filter by employee name
3. **Leave type filter** — pill chips: All / Annual / Sick / Family / Study / Other
4. **Balance summary** — shown per employee in the pending tab (annual days remaining)
5. **decide_leave_request RPC** — used for all approve/decline actions

---

## Architecture

### 1. Fix: Use decide_leave_request RPC

The `decide_leave_request(p_company_id, p_leave_request_id, p_decision, p_note)` RPC exists and is confirmed in DB.

```typescript
// BEFORE (remove)
await supabase.from('leave_requests').update({ status: 'approved' }).eq('id', id)

// AFTER
await supabase.rpc('decide_leave_request', {
  p_company_id: companyId,
  p_leave_request_id: requestId,
  p_decision: 'approved',  // or 'rejected'
  p_note: null,
})
```

This also handles any side effects the RPC performs (notifications, audit log, etc.) that the direct update bypasses.

### 2. On Leave Today Section

```typescript
const today = new Date().toISOString().split('T')[0]

const { data: onLeaveToday } = await supabase
  .from('leave_requests')
  .select('id, leave_type, end_date, employees(name, surname)')
  .eq('company_id', companyId)
  .eq('status', 'approved')
  .lte('start_date', today)
  .gte('end_date', today)
  .order('end_date')
```

Render above the tabs:

```tsx
{onLeaveToday.length > 0 && (
  <div className="bg-surface border border-divider rounded-lg p-3 mb-3">
    <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
      On Leave Today ({onLeaveToday.length})
    </p>
    {onLeaveToday.map(r => (
      <div key={r.id} className="flex justify-between py-1 text-[13px]">
        <span className="text-text-primary">{r.employees?.name} {r.employees?.surname}</span>
        <span className="text-text-secondary">{r.leave_type} · back {formatDate(r.end_date)}</span>
      </div>
    ))}
  </div>
)}
```

### 3. Search Bar

Add above the tab toggle:

```typescript
const [search, setSearch] = useState('')

const filtered = requests.filter(r => {
  const name = `${r.employees?.name ?? ''} ${r.employees?.surname ?? ''}`.toLowerCase()
  return !search || name.includes(search.toLowerCase())
})
```

### 4. Leave Type Filter

```typescript
type LeaveTypeFilter = 'all' | 'annual' | 'sick' | 'family' | 'study' | 'other'
const [leaveTypeFilter, setLeaveTypeFilter] = useState<LeaveTypeFilter>('all')

const filtered = requests.filter(r => {
  if (leaveTypeFilter !== 'all' && r.leave_type !== leaveTypeFilter) return false
  // ... search filter
  return true
})
```

Render as horizontal pill chips below the search bar.

### 5. Balance Display on Pending Rows

On each pending request row, add a small balance indicator:

```typescript
// Pre-calculate per employee: how many days used YTD
const yearStart = `${new Date().getFullYear()}-01-01`

const usedByEmployee = requests
  .filter(r => r.status === 'approved' && r.start_date >= yearStart)
  .reduce((acc, r) => {
    const key = `${r.employee_id}:${r.leave_type}`
    acc[key] = (acc[key] ?? 0) + (r.total_days ?? 0)
    return acc
  }, {} as Record<string, number>)

// On each pending row:
const annualDays = 15 // default, or from payroll_settings
const used = usedByEmployee[`${req.employee_id}:${req.leave_type}`] ?? 0
const remaining = annualDays - used
```

Display as a small badge next to the employee name: `15 days remaining`

---

## Database Impact

None. No migrations required.

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/leave/page.tsx` | Add all features above, fix RPC |

---

## Regression Risks

- The `decide_leave_request` RPC may send notifications or update related records — this is intentional and correct, not a regression.
- The existing Pending/All tab toggle and the table structure are unchanged.

---

## Testing Requirements

1. Approve a leave request — confirm `decide_leave_request` is called (check network tab) and the request moves from Pending to All with status 'approved'.
2. Decline a leave request — same verification.
3. On-leave-today section shows correct employees for today's date.
4. Search by partial name — list filters correctly.
5. Leave type filter "Sick" — only sick leave requests shown.
6. Balance badge on pending row shows correct remaining days.

---

## Acceptance Criteria

- [ ] `decide_leave_request` RPC used for all approve/decline actions
- [ ] On-leave-today section shows employees on leave right now
- [ ] Search bar filters by employee name
- [ ] Leave type filter chips work
- [ ] Remaining balance shown on pending rows
- [ ] No TypeScript errors

---

## Definition of Done

- All features tested with real leave data
- RPC confirmed called via Supabase logs or network tab
- No TypeScript errors
