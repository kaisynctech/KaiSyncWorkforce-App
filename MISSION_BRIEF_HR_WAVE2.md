# MISSION BRIEF — HR Dashboard Wave 2
## Attendance · Employees · Leave

**Issued by:** KEES Architect  
**Date:** 2026-07-17  
**MAUI source files read:**
- `HrAttendanceViewModel.cs`
- `HrEmployeesViewModel.cs`

**Files to change:**
- `kaisync-web/src/app/dashboard/attendance/page.tsx`
- `kaisync-web/src/app/dashboard/employees/page.tsx`
- `kaisync-web/src/app/dashboard/leave/page.tsx`

**No migrations required.**

---

## MAUI Parity Table

| Feature | MAUI | Web | Status |
|---|---|---|---|
| Attendance default period | Last 7 days (`week`) | Today | ❌ Bug 1 |
| Late detection | Computed from shift template + `late_threshold_minutes` setting | Always `false` | ❌ Bug 2 |
| OT threshold | `ot_start_after_minutes` from company settings (default 30 min) | Hardcoded 8 hours | ❌ Bug 3 |
| Export PDF | Supported | Button disabled | ❌ Bug 4 |
| Leave decline decision value | `"declined"` | `"rejected"` (DB rejects this) | ❌ Bug 5 (Critical) |
| Leave rejection note | Prompts for reason before declining | Always `null` | ❌ Bug 6 |
| Employee list search | Name + code | Name, code, dept, position | ✅ Web is superset |
| Employees leave tab | Leave requests (approve/reject) | Leave balances (YTD) | ℹ️ Intentional split |
| Attendance realtime | ✅ | ✅ | ✅ |
| Leave tab access gate | `CanSeeLeaveAdmin` (permission check) | `access_level` owner/hr check | ✅ Equivalent |
| Pending employee approve/reject | ✅ with confirm dialog (reject) | ✅ (no confirm on reject) | ~ Minor gap |

---

## Bugs Found

### Bug 1 (Medium) — Attendance default period is 'today' instead of 'week'

**File:** `kaisync-web/src/app/dashboard/attendance/page.tsx` line 134

```ts
const [preset, setPreset] = useState<Preset>('today')
```

MAUI initialises `FromDate = DateTime.Today.AddDays(-7)` and `AttendancePeriod = "week"`. The web default should be `'week'` to match.

---

### Bug 2 (High) — Late detection always `false`; `lateThreshold` parameter is voided

**File:** `kaisync-web/src/app/dashboard/attendance/page.tsx` lines 85–95

```ts
function buildSessions(
  punches: TimePunch[],
  employees: Map<string, EmpRow>,
  lateThreshold: number,   // ← received but...
  otThreshold: number
): PunchSession[] {
  ...
  sessions.push({
    ...
    isLate: false,           // ← always false — never computed
    ...
  })
  ...
  void lateThreshold         // ← explicitly discarded at line 94
}
```

`isLate` is hardcoded `false`. In MAUI, `isLate` is computed by `PunchSession.Build()` which compares the clock-in time against the employee's scheduled shift start (from `_templateMap`) plus the `late_threshold_minutes` company setting.

The web does not load shift templates. Full late detection requires fetching `shift_templates` for the company and matching them to employees. Until that is implemented, `isLate` should remain `false` (acceptable) — but remove the `void lateThreshold` dead code.

**Fix:** Remove `void lateThreshold` at line 94. Late detection is deferred pending shift template integration.

---

### Bug 3 (High) — OT threshold hardcoded to 8 hours; MAUI uses company setting

**File:** `kaisync-web/src/app/dashboard/attendance/page.tsx` line 215

```ts
setSessions(buildSessions((punchData ?? []) as TimePunch[], empMap, 30, 8))
//                                                               ↑    ↑
//                                                         lateMin  otHours
```

And inside `buildSessions`:
```ts
isOvertime: hours > otThreshold,   // otThreshold = 8
```

MAUI uses:
```csharp
int otMin = settings.TryGetValue("ot_start_after_minutes", out var o) && int.TryParse(o?.ToString(), out var oi) ? oi : 30;
// Default: 30 minutes (0.5 hours)
```

The web hardcodes 8 hours — a session must be longer than 8 hours to be flagged as OT. MAUI flags OT after 30 minutes by default (configurable per company). This means the web almost never shows OT.

**Fix:** After loading employee data, also read `companies.custom_settings` for the current company and extract `ot_start_after_minutes` (default `30`). Convert to hours for comparison:

```ts
// Fetch company settings for OT threshold
const { data: companyData } = await supabase
  .from('companies')
  .select('custom_settings')
  .eq('id', cid)
  .single()

const otMinutes = (companyData?.custom_settings as Record<string, unknown> | null)
  ?.ot_start_after_minutes as number ?? 30
const otThresholdHours = otMinutes / 60  // convert to hours

setSessions(buildSessions((punchData ?? []) as TimePunch[], empMap, 30, otThresholdHours))
```

Add `companyData` to the existing `Promise.all`:

```ts
const [{ data: empData }, { data: punchData }, { data: companyData }] = await Promise.all([
  supabase.from('employees').select('id, name, surname, employee_code, hourly_rate').eq('company_id', cid).eq('is_active', true),
  supabase.from('time_punches').select('id, employee_id, type, date_time, created_at').eq('company_id', cid)
    .gte('date_time', `${from}T00:00:00`).lte('date_time', `${to}T23:59:59`).order('date_time', { ascending: true }),
  supabase.from('companies').select('custom_settings').eq('id', cid).single(),
])
```

---

### Bug 4 (Medium) — Export PDF button disabled; export function not wired up

**File:** `kaisync-web/src/app/dashboard/attendance/page.tsx` lines 265–270

```tsx
<button
  disabled
  className="... text-text-disabled cursor-not-allowed"
>
  Export PDF
</button>
```

MAUI supports both CSV and PDF export. The button is hardcoded `disabled` with no `onClick`. A basic browser print-to-PDF implementation should be wired up (similar to the employee attendance page in `/dashboard/employee/attendance/page.tsx` which already has `printPDF`).

**Fix:** Add a `printPDF` function to the HR attendance page and wire it to the Export PDF button. Model it after the employee attendance page's `printPDF` implementation. Remove `disabled` and `cursor-not-allowed`.

---

### Bug 5 (Critical) — Leave decline sends `"rejected"`; DB only accepts `"declined"`

**Files:**
- `kaisync-web/src/app/dashboard/leave/page.tsx` line 91
- `kaisync-web/src/app/dashboard/employees/page.tsx` line ~297 (handleAction)

**`/dashboard/leave/page.tsx`:**
```ts
async function handleAction(requestId: string, decision: 'approved' | 'rejected') {
  ...
  await supabase.rpc('decide_leave_request', {
    p_company_id:        companyId,
    p_leave_request_id:  requestId,
    p_decision:          decision,   // ← sends "rejected"
    p_note:              null,
  })
}
...
<button onClick={() => handleAction(req.id, 'rejected')}>Decline</button>
```

**`/dashboard/employees/page.tsx` leave tab `handleAction` (same pattern).**

The DB `decide_leave_request` RPC explicitly validates:
```sql
IF p_decision NOT IN ('approved', 'declined') THEN
  RAISE EXCEPTION 'Invalid decision "%": must be "approved" or "declined"', p_decision
    USING ERRCODE = 'P0001';
END IF;
```

Sending `"rejected"` raises a DB exception every time. The decline button appears to work (no visible error) but the leave request status is never updated.

**Fix — `/dashboard/leave/page.tsx`:**

Change the type and value:
```ts
// Before
async function handleAction(requestId: string, decision: 'approved' | 'rejected') {

// After
async function handleAction(requestId: string, decision: 'approved' | 'declined') {
```

```tsx
// Before
<button onClick={() => handleAction(req.id, 'rejected')}>Decline</button>

// After
<button onClick={() => handleAction(req.id, 'declined')}>Decline</button>
```

**Fix — `/dashboard/employees/page.tsx` (leave tab `rejectLeaveAsync`):**

```ts
// Before
await _storage.DecideLeaveRequestAsync(..., "rejected", ...)

// After — find the supabase.rpc call and change
p_decision: 'declined',
```

---

### Bug 6 (Medium) — Leave decline sends no rejection note; MAUI prompts for reason

**Files:**
- `kaisync-web/src/app/dashboard/leave/page.tsx`
- `kaisync-web/src/app/dashboard/employees/page.tsx` (leave tab)

**Current:** Both pages pass `p_note: null` unconditionally.

**MAUI (`HrEmployeesViewModel`):**
```csharp
var note = await Shell.Current.DisplayPromptAsync(
  "Reject Leave", $"Reason for rejecting {item.EmployeeName}'s request? (optional):",
  "Reject", "Cancel", placeholder: "Enter reason…");
if (note == null) return;  // user cancelled

await _storage.DecideLeaveRequestAsync(..., "declined", string.IsNullOrWhiteSpace(note) ? null : note);
```

**Fix — `/dashboard/leave/page.tsx`:**

Add a decline note state and a simple inline note input, OR use a modal. Minimally: when the Decline button is clicked, show a small confirmation with an optional note textarea before calling the RPC.

Example inline approach — add `declineNote` state and a confirm step:
```ts
const [decliningId,  setDecliningId]  = useState<string | null>(null)
const [declineNote,  setDeclineNote]  = useState('')

// Replace the Decline button with a two-step:
// Step 1: Decline button → sets decliningId
// Step 2: shows note textarea + Confirm / Cancel buttons inline
// Step 3: on Confirm → call handleAction(id, 'declined', note)
```

Update `handleAction` signature:
```ts
async function handleAction(requestId: string, decision: 'approved' | 'declined', note?: string) {
  ...
  await supabase.rpc('decide_leave_request', {
    p_company_id:        companyId,
    p_leave_request_id:  requestId,
    p_decision:          decision,
    p_note:              note ?? null,
  })
  ...
}
```

Apply the same pattern to the leave tab in `/dashboard/employees/page.tsx` (`rejectLeaveAsync`).

---

## Engineer Checklist

### `kaisync-web/src/app/dashboard/attendance/page.tsx`
- [ ] Change default preset from `'today'` → `'week'`
- [ ] Add `companies.custom_settings` fetch to `fetchPunchesWithParams` `Promise.all`
- [ ] Compute `otThresholdHours = (custom_settings.ot_start_after_minutes ?? 30) / 60`
- [ ] Pass computed `otThresholdHours` to `buildSessions` instead of hardcoded `8`
- [ ] Remove `void lateThreshold` dead code (line 94)
- [ ] Add `printPDF` function and wire up Export PDF button (remove `disabled`)

### `kaisync-web/src/app/dashboard/leave/page.tsx`
- [ ] Change `'approved' | 'rejected'` → `'approved' | 'declined'`
- [ ] Change `handleAction(req.id, 'rejected')` → `handleAction(req.id, 'declined')`
- [ ] Add optional decline note: two-step confirm with textarea before calling RPC
- [ ] Pass note as `p_note` to `decide_leave_request`

### `kaisync-web/src/app/dashboard/employees/page.tsx` (leave tab)
- [ ] Find `rejectLeaveAsync` (or equivalent) — change decision value from `"rejected"` → `"declined"`
- [ ] Add optional note prompt (match MAUI: optional reason, cancel = abort)
- [ ] Pass note as `p_note` to `decide_leave_request`

No migrations required. No schema changes.
