# MIS-2026-00012 — Active Sessions Revoke, Scheduling Calendar View, Work Teams Create

**Mission ID:** MIS-2026-00012  
**Priority:** Medium  
**Affects:** kaisync-web — active-sessions, scheduling, work-teams pages  
**Gap reference:** GAP-40, GAP-41, GAP-44, GAP-62  

---

## Summary

Three medium-priority gaps across three pages: Active Sessions is missing the Revoke action (RPC exists), Scheduling is missing week/month calendar views (only has a day picker), and Work Teams has no way to create a new team from its own page. All are small, isolated changes.

---

## Business Objective

- Allow HR admins to forcibly end an employee's active session (security control)
- Give schedulers a weekly calendar view of events
- Allow team creation directly from the Work Teams page (currently only possible via Employees page after MIS-2026-00004)

---

## Architecture

### 1. Active Sessions — Revoke Action

`hr_revoke_session(p_company_id uuid, p_session_id uuid)` — confirmed in DB.

In `src/app/dashboard/active-sessions/page.tsx`, add a Revoke button to each session row:

```typescript
async function revokeSession(sessionId: string) {
  if (!window.confirm('End this employee session? They will be logged out immediately.')) return
  const supabase = createClient()
  await supabase.rpc('hr_revoke_session', {
    p_company_id: companyId,
    p_session_id: sessionId,
  })
  await load()
}
```

```tsx
// In each session row, add:
<button onClick={() => revokeSession(session.id)}
  className="h-8 px-3 text-[12px] rounded-lg border border-error text-error hover:bg-error/10 transition-colors">
  Revoke
</button>
```

---

### 2. Scheduling — Week View

The current page only shows a single-day date picker. Add a week view toggle.

```typescript
type ViewMode = 'day' | 'week'
const [viewMode, setViewMode] = useState<ViewMode>('day')

// Week date range
function getWeekRange(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr)
  const day = d.getDay()
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return {
    start: mon.toISOString().split('T')[0],
    end: sun.toISOString().split('T')[0],
  }
}
```

When in week view, load all events for the 7-day range:

```typescript
async function load(date: string) {
  const supabase = createClient()
  const member = await resolveCurrentMember(supabase)
  if (!member) return

  const range = viewMode === 'week'
    ? getWeekRange(date)
    : { start: date, end: date }

  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('company_id', member.companyId)
    .gte('date', range.start)
    .lte('date', range.end)
    .order('date')
    .order('start_time')

  setEvents((data ?? []) as CalendarEvent[])
}
```

Week view UI — a 7-column grid, one column per day:

```tsx
{viewMode === 'week' && (
  <div className="grid grid-cols-7 gap-1 text-[12px]">
    {Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(weekStart); d.setDate(d.getDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      const dayEvents = events.filter(e => e.date === dateStr)
      return (
        <div key={dateStr} className="min-h-[120px] border border-divider rounded-lg p-2">
          <p className="font-semibold text-text-secondary mb-1">
            {d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' })}
          </p>
          {dayEvents.map(ev => (
            <div key={ev.id} className="bg-primary/10 text-primary rounded p-1 mb-1 text-[11px]">
              <p className="font-medium truncate">{ev.title}</p>
              <p>{ev.start_time?.slice(0, 5)} – {ev.end_time?.slice(0, 5)}</p>
            </div>
          ))}
        </div>
      )
    })}
  </div>
)}
```

View mode toggle buttons (Day / Week) above the date picker.

---

### 3. Work Teams — Create Team

Add a "+ Create Team" button and modal to `src/app/dashboard/work-teams/page.tsx`:

```typescript
const [showCreate, setShowCreate] = useState(false)
const [newTeamName, setNewTeamName] = useState('')
const [newTeamDesc, setNewTeamDesc] = useState('')
const [creating, setCreating] = useState(false)

async function createTeam() {
  if (!newTeamName.trim() || !companyId) return
  setCreating(true)
  const supabase = createClient()
  const { error } = await supabase.from('work_teams').insert({
    company_id: companyId,
    name: newTeamName.trim(),
    description: newTeamDesc.trim() || null,
    is_active: true,
  })
  if (!error) {
    setShowCreate(false)
    setNewTeamName('')
    setNewTeamDesc('')
    await load()
  }
  setCreating(false)
}
```

Modal:
```tsx
{showCreate && (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <div className="bg-surface rounded-xl w-full max-w-sm p-5 space-y-4">
      <h2 className="text-[16px] font-semibold text-text-primary">Create Team</h2>
      <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)}
        placeholder="Team name" className="w-full ..." autoFocus />
      <input value={newTeamDesc} onChange={e => setNewTeamDesc(e.target.value)}
        placeholder="Description (optional)" className="w-full ..." />
      <div className="flex gap-2 justify-end">
        <button onClick={() => setShowCreate(false)} className="btn-outlined h-10 px-4">Cancel</button>
        <button onClick={createTeam} disabled={!newTeamName.trim() || creating}
          className="btn-primary h-10 px-4">Create</button>
      </div>
    </div>
  </div>
)}
```

---

## Database Impact

None. All RPCs and tables already exist.

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/active-sessions/page.tsx` | Add Revoke button + `hr_revoke_session` call |
| `src/app/dashboard/scheduling/page.tsx` | Add week view toggle and 7-column calendar grid |
| `src/app/dashboard/work-teams/page.tsx` | Add "+ Create Team" button and modal |

---

## Testing Requirements

1. Active Sessions: Click Revoke on a live session — employee is logged out (confirm in Supabase `employee_sessions` table row is removed/revoked).
2. Scheduling: Switch to Week view — 7 columns appear, events distributed to correct day columns.
3. Scheduling: Navigate weeks using the date picker — events update.
4. Work Teams: Click "+ Create Team", enter name — team appears in list.

---

## Acceptance Criteria

- [ ] Revoke session calls `hr_revoke_session` and removes the session
- [ ] Week view shows 7 columns with events in correct day slots
- [ ] Create team inserts into `work_teams` and reloads the list
- [ ] No TypeScript errors

---

## Definition of Done

- All three features tested manually
- No TypeScript errors
