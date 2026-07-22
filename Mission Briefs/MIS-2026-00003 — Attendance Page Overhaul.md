# MIS-2026-00003 — Attendance Page Overhaul

**Mission ID:** MIS-2026-00003  
**Priority:** High  
**Affects:** kaisync-web — `/dashboard/attendance`  
**Gap reference:** GAP-04, GAP-05, GAP-06, GAP-07, GAP-23  

---

## Summary

The attendance page currently shows a single-date picker and a raw punch table. The MAUI app has a full date-range picker with period presets, a TotalPay column, late/overtime session markers computed from shift templates, export to CSV/PDF, and realtime updates. This Mission brings the web page to feature parity.

---

## Business Objective

Give HR managers the same attendance visibility on the web that they have in the mobile app — including pay calculations and late/OT flags that are needed for payroll decisions.

---

## Current Behaviour

- Single date picker (one day only)
- Table shows raw punch rows: Employee, Clock In, Clock Out, Hours, Status
- No TotalPay
- No late/OT markers
- Export buttons exist but do nothing
- No realtime subscription

---

## Expected Behaviour

- Date range picker with presets: Today, This Week, This Month, All, Custom
- Summary tiles: On-site count, Completed sessions, Total Hours, **Total Pay**
- Table adds: **Pay** column, **Late** badge, **OT** badge per session
- Sessions are built by pairing clock-in/clock-out punches (PunchSession logic)
- Late marker: if clock-in is more than `late_threshold_minutes` after shift start
- OT marker: if session hours exceed `overtime_threshold_hours`
- Export CSV: downloads all filtered sessions as a CSV file
- Realtime: subscribes to `timesheet_punches` INSERT/UPDATE and refreshes the table
- Date range is used in the actual DB query (not loaded all at once)

---

## Architecture

### 1. Date Range + Presets

Replace the single `<input type="date">` with a date-range control:

```typescript
type Preset = 'today' | 'week' | 'month' | 'all' | 'custom'

function getRange(preset: Preset, customFrom: string, customTo: string) {
  const today = new Date().toISOString().split('T')[0]
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') {
    const d = new Date()
    const mon = new Date(d); mon.setDate(d.getDate() - d.getDay() + 1)
    return { from: mon.toISOString().split('T')[0], to: today }
  }
  if (preset === 'month') {
    const d = new Date()
    return { from: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, to: today }
  }
  if (preset === 'all') return { from: '2020-01-01', to: today }
  return { from: customFrom, to: customTo }
}
```

Render 5 pill buttons (Today / Week / Month / All / Custom). When Custom is selected, show the two date inputs.

### 2. DB Query with Date Range

```typescript
const { from, to } = getRange(preset, customFrom, customTo)

const { data: punches } = await supabase
  .from('timesheet_punches')
  .select('*, employees(name, surname, employee_code, hourly_rate)')
  .eq('company_id', companyId)
  .gte('punch_in', `${from}T00:00:00`)
  .lte('punch_in', `${to}T23:59:59`)
  .order('punch_in', { ascending: false })
```

### 3. PunchSession Building (client-side)

Build sessions from raw punches. Each session = one clock-in + its corresponding clock-out:

```typescript
type PunchSession = {
  employeeId: string
  employeeName: string
  employeeCode: string
  punchIn: string
  punchOut: string | null
  hoursWorked: number
  pay: number
  isLate: boolean
  isOvertime: boolean
  status: 'active' | 'completed'
}

function buildSessions(
  punches: Punch[],
  settings: PayrollSettings | null
): PunchSession[] {
  const lateThreshold = settings?.late_threshold_minutes ?? 30
  const otThreshold = settings?.overtime_threshold_hours ?? 8

  // Group by employee, sort by punch_in asc, pair clock-in with next clock-out
  // For simplicity: each punch row with punch_out set = one completed session
  // Each punch row with punch_out = null = active session

  return punches.map(p => {
    const hours = p.hours_worked ?? 0
    const rate = p.employees?.hourly_rate ?? 0
    const shiftStart = p.shift_start_time ?? null // if shift template linked

    // Late: punch_in > shiftStart + lateThreshold minutes
    const isLate = shiftStart
      ? (new Date(p.punch_in).getTime() - new Date(shiftStart).getTime()) / 60000 > lateThreshold
      : false

    const isOvertime = hours > otThreshold

    return {
      employeeId: p.employee_id,
      employeeName: `${p.employees?.name ?? ''} ${p.employees?.surname ?? ''}`.trim(),
      employeeCode: p.employees?.employee_code ?? '',
      punchIn: p.punch_in,
      punchOut: p.punch_out ?? null,
      hoursWorked: hours,
      pay: rate * hours,
      isLate,
      isOvertime,
      status: p.punch_out ? 'completed' : 'active',
    }
  })
}
```

**Note:** Load `payroll_settings` for the company once on page load to get `late_threshold_minutes` and `overtime_threshold_hours`.

### 4. Summary Tiles

```typescript
const onSite = sessions.filter(s => s.status === 'active').length
const completed = sessions.filter(s => s.status === 'completed').length
const totalHours = sessions.reduce((s, p) => s + p.hoursWorked, 0)
const totalPay = sessions.reduce((s, p) => s + p.pay, 0)
```

Render 4 tiles: On Site | Completed | Total Hours | **Total Pay (R)**

### 5. Table — Add Pay, Late, OT columns

Add to the existing table:

```tsx
<th>Pay</th>
// ...in row:
<td>R{session.pay.toFixed(2)}</td>
<td>
  {session.isLate && <span className="badge-error">Late</span>}
  {session.isOvertime && <span className="badge-warning">OT</span>}
</td>
```

### 6. Export CSV

```typescript
function exportCSV(sessions: PunchSession[]) {
  const header = 'Employee,Code,Clock In,Clock Out,Hours,Pay,Late,OT'
  const rows = sessions.map(s =>
    [
      s.employeeName,
      s.employeeCode,
      s.punchIn,
      s.punchOut ?? '',
      s.hoursWorked.toFixed(2),
      s.pay.toFixed(2),
      s.isLate ? 'Yes' : 'No',
      s.isOvertime ? 'Yes' : 'No',
    ].join(',')
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `attendance_${from}_to_${to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

Wire this to the Export CSV button. The Export PDF button can remain a stub for this Mission (PDF generation is a separate concern).

### 7. Realtime Subscription

```typescript
useEffect(() => {
  const supabase = createClient()
  const channel = supabase
    .channel('attendance-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'timesheet_punches', filter: `company_id=eq.${companyId}` },
      () => { loadAttendance() }
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [companyId])
```

---

## Database Impact

None. No migrations required. All data is already in `timesheet_punches` and `payroll_settings`.

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/attendance/page.tsx` | Full overhaul as described |

---

## Regression Risks

- The `hours_worked` column in `timesheet_punches` may be null for active sessions (no clock-out yet). Guard with `?? 0`.
- `employees.hourly_rate` may be null. Guard with `?? 0` — pay will show R0.00 for salary employees (correct).
- `shift_start_time` may not exist as a column on punches. If it doesn't, the `isLate` calculation simply always returns false — that is acceptable for this Mission.

---

## Testing Requirements

1. Select "Today" preset — only today's punches load.
2. Select "This Week" preset — week's punches load with correct date range in query.
3. Verify TotalPay tile shows sum of (hourly_rate × hours) for all loaded sessions.
4. Clock in a test employee — confirm realtime subscription adds the row without page refresh.
5. Export CSV — download and verify all columns present.

---

## Acceptance Criteria

- [ ] 5 period presets work and change the DB query date range
- [ ] Custom date range inputs visible when Custom selected
- [ ] TotalPay summary tile shows correct value
- [ ] Table has Pay column
- [ ] Late badge appears for sessions where punch_in > shift_start + threshold
- [ ] OT badge appears for sessions where hours > OT threshold
- [ ] Export CSV downloads a valid file
- [ ] Realtime subscription refreshes table on new punch events

---

## Definition of Done

- Page tested across all 5 presets
- Realtime tested manually (clock in on mobile, see web update)
- CSV download verified
- No TypeScript errors
