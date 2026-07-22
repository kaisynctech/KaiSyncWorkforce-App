# MISSION BRIEF — Clock-In Parity & Attendance Display

**Scope:** 3 bugs across 2 files  
**Priority:** High — attendance shows "No records" despite punches existing; every punch stored with null address  
**DB verified:** ✅ `time_punches` columns confirmed; `employee_get_my_punches` returns full row via `row_to_json`  

---

## Bug 1 — Attendance page shows "No attendance records" when punches exist

**File:** `src/app/dashboard/employee/attendance/page.tsx`

**Root cause:** `buildSessions()` pairs clock-ins with clock-outs. If the employee has a clock-out with no matching clock-in in the selected date range (common in test environments, or when the clock-in was before the range), the punch is silently discarded and the list renders empty. The RPC date filter is `>=` / `<=` (inclusive) — the data IS there, `buildSessions` is just dropping it.

**MAUI reference:** MAUI shows individual punch records (one row per punch, sorted descending). It does not use a session-pairing model. Web must match this.

**DB confirmed:** `time_punches` has columns: `id, type, date_time, latitude, longitude, address, job_id, notes`. The `address` field exists (currently null for all web punches — fixed in Bug 2).

### Step 1 — Update `Punch` interface (add missing fields from DB)

```ts
// REPLACE the Punch interface (lines 7–13) with:
interface Punch {
  id: string
  type: 'in' | 'out'
  date_time: string
  latitude: number | null
  longitude: number | null
  address: string | null
  job_id: string | null
  notes: string | null
}
```

### Step 2 — Remove `Session` interface and `buildSessions` function

**DELETE lines 15–69** (the `Session` interface and `buildSessions` function entirely).

### Step 3 — Replace state and data handling

```ts
// REPLACE:
const [sessions, setSessions] = useState<Session[]>([])

// WITH:
const [punches, setPunches] = useState<Punch[]>([])
```

In `load()`, replace the `setSessions(buildSessions(...))` call:
```ts
// REPLACE (line 173):
setSessions(buildSessions((data as Punch[]) ?? []))

// WITH:
const sorted = ((data as Punch[]) ?? []).slice().sort(
  (a, b) => new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
)
setPunches(sorted)
```

### Step 4 — Replace the summary bar

```tsx
// REPLACE the summary bar block (lines 237–248) with:
{!loading && punches.length > 0 && (
  <div className="flex gap-6 px-4 py-3 bg-surface-elevated border-b border-divider shrink-0">
    <div>
      <p className="text-[11px] text-text-disabled uppercase font-semibold">Punches</p>
      <p className="text-[18px] font-bold text-text-primary">{punches.length}</p>
    </div>
  </div>
)}
```

### Step 5 — Replace the list render with a table

```tsx
// REPLACE the content of <div className="flex-1 overflow-y-auto"> (lines 250–282) with:
<div className="flex-1 overflow-y-auto">
  {loading ? (
    <div className="flex items-center justify-center h-48 text-text-secondary text-[14px]">Loading…</div>
  ) : punches.length === 0 ? (
    <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
      <span className="material-icons text-[48px] text-text-disabled">schedule</span>
      <p className="text-[14px]">No attendance records</p>
    </div>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-divider bg-surface-elevated">
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Date</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Time</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Type</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Location</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {punches.map(p => (
            <tr key={p.id} className="hover:bg-surface-elevated transition-colors">
              <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                {fmtDate(p.date_time)}
              </td>
              <td className="px-4 py-3 text-[13px] font-medium text-text-primary whitespace-nowrap">
                {fmt(p.date_time)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full ${
                  p.type === 'in'
                    ? 'bg-success/10 text-success'
                    : 'bg-surface-elevated text-text-secondary border border-divider'
                }`}>
                  {p.type === 'in' ? 'Clock In' : 'Clock Out'}
                </span>
              </td>
              <td className="px-4 py-3 text-[12px] text-text-secondary max-w-[200px] truncate">
                {p.address ?? (
                  p.latitude != null
                    ? <span className="text-text-disabled">{p.latitude.toFixed(5)}, {p.longitude?.toFixed(5)}</span>
                    : <span className="text-text-disabled">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-[12px] text-text-disabled italic">
                {p.notes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</div>
```

### Step 6 — Update `exportCSV` and `printPDF`

**Replace `exportCSV`** (lines 71–90):
```ts
function exportCSV(punches: Punch[]) {
  const headers = ['Date', 'Time', 'Type', 'Address', 'Notes']
  const rows = punches.map(p => [
    fmtDate(p.date_time),
    fmt(p.date_time),
    p.type === 'in' ? 'Clock In' : 'Clock Out',
    p.address ?? (p.latitude != null ? `${p.latitude.toFixed(5)}, ${p.longitude?.toFixed(5)}` : ''),
    p.notes ?? '',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'attendance.csv'
  a.click()
  URL.revokeObjectURL(url)
}
```

**Replace `printPDF`** (lines 92–126):
```ts
function printPDF(punches: Punch[], empName: string, fromLabel: string, toLabel: string) {
  const rows = punches.map(p => `
    <tr>
      <td>${fmtDate(p.date_time)}</td>
      <td>${fmt(p.date_time)}</td>
      <td>${p.type === 'in' ? 'Clock In' : 'Clock Out'}</td>
      <td>${p.address ?? (p.latitude != null ? `${p.latitude.toFixed(5)}, ${p.longitude?.toFixed(5)}` : '—')}</td>
      <td>${p.notes ?? ''}</td>
    </tr>
  `).join('')

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!DOCTYPE html><html><head><title>Attendance Report</title><style>
    body { font-family: sans-serif; font-size: 12px; padding: 20px; }
    h2 { font-size: 16px; margin-bottom: 4px; }
    p { margin: 2px 0 12px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    @media print { button { display: none; } }
  </style></head><body>
    <h2>Attendance Report — ${empName}</h2>
    <p>Period: ${fromLabel} to ${toLabel}</p>
    <table>
      <thead><tr><th>Date</th><th>Time</th><th>Type</th><th>Location</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <br><button onclick="window.print()">Print / Save PDF</button>
  </body></html>`)
  w.document.close()
}
```

### Step 7 — Update all remaining references from `sessions` → `punches`

- Export button: `onClick={() => exportCSV(punches)}`
- PDF button: `onClick={() => { const [f, t] = rangeLabel(); printPDF(punches, empName, f, t) }}`
- Disabled conditions: `disabled={punches.length === 0}`

---

## Bug 2 — Clock-in always stores null address (reverse geocoding missing)

**File:** `src/app/dashboard/employee/overview/page.tsx`

**Root cause:** `openClockModal()` captures GPS coordinates but never reverse-geocodes them. `submitClock()` always sends `p_address: null`. MAUI calls `_location.ReverseGeocodeAsync(lat, lng)` and stores a human-readable address with every punch.

**Fix:** Call OpenStreetMap Nominatim (free, no API key) after GPS resolves. Store in `geoAddress` state. Pass to RPC.

### Step 1 — Add `geoAddress` state (after line 108, with other clock state)

```ts
const [geoAddress, setGeoAddress] = useState<string | null>(null)
```

### Step 2 — Update `openClockModal()` (lines 250–263)

```ts
function openClockModal() {
  setClockError(null)
  setClockNote('')
  setClockJobId(null)
  setGeoLat(null)
  setGeoLng(null)
  setGeoAddress(null)
  setShowClockModal(true)

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setGeoLat(lat)
        setGeoLng(lng)
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          )
          const json = await res.json()
          setGeoAddress((json as { display_name?: string }).display_name ?? null)
        } catch {
          // reverse geocode failed — address stays null, punch still goes through
        }
      },
      () => {}
    )
  }
}
```

### Step 3 — Update `submitClock()` — change `p_address: null` to `p_address: geoAddress`

```ts
// REPLACE (line 284):
p_address: null,

// WITH:
p_address: geoAddress,
```

### Step 4 — Show location feedback in clock modal (matches MAUI UX)

Find the clock modal JSX. Inside the modal, below the title row ("Clock In" / "Clock Out" header), add a location line:

```tsx
{/* Location feedback */}
<div className="mb-3">
  {geoLat ? (
    <p className="text-[12px] text-text-secondary flex items-center gap-1">
      <span className="material-icons text-[14px] text-success">location_on</span>
      {geoAddress ?? `${geoLat.toFixed(5)}, ${geoLng?.toFixed(5)}`}
    </p>
  ) : (
    <p className="text-[12px] text-text-disabled flex items-center gap-1">
      <span className="material-icons text-[14px]">location_searching</span>
      Getting location…
    </p>
  )}
</div>
```

---

## Bug 3 — Leave guard missing on clock-in

**File:** `src/app/dashboard/employee/overview/page.tsx`

**Root cause:** `openClockModal()` opens without checking `isOnLeave`. MAUI shows an alert and blocks clock-in if `IsOnLeave` is true. The web already fetches and stores `isOnLeave` state (line 212) but never uses it to guard the punch.

**Fix:** Add a non-blocking warning in the clock modal (preferred over hard block — the RPC doesn't enforce this server-side so a client-only hard block can be bypassed).

### Add warning banner inside the clock modal JSX

Inside the modal, directly after the location feedback block added in Bug 2:

```tsx
{/* Leave warning */}
{!isClockedIn && isOnLeave && (
  <div className="rounded-lg px-3 py-2.5 bg-warning/10 border border-warning/30 mb-3">
    <p className="text-[12px] font-semibold text-warning">You are on approved leave today</p>
    <p className="text-[12px] text-text-secondary mt-0.5">You can still clock in — HR will see this in the attendance report.</p>
  </div>
)}
```

---

## Summary of changes

| File | Change |
|---|---|
| `attendance/page.tsx` | Remove `Session` + `buildSessions`; show individual punch table with `address` column |
| `attendance/page.tsx` | Update `Punch` interface with `latitude`, `longitude`, `address` fields |
| `attendance/page.tsx` | Update `exportCSV` and `printPDF` to iterate punches |
| `overview/page.tsx` | Add `geoAddress` state |
| `overview/page.tsx` | Update `openClockModal()` to reverse-geocode via Nominatim after GPS |
| `overview/page.tsx` | Change `p_address: null` → `p_address: geoAddress` in `submitClock()` |
| `overview/page.tsx` | Add location feedback line in clock modal |
| `overview/page.tsx` | Add leave warning banner in clock modal when `isOnLeave` is true |

**Note — geofence enforcement:** MAUI also enforces a geofence radius check before allowing clock-in. This requires a separate RPC to fetch company/job geofence settings. This is not included in this brief as the geofence RPC name and return shape need to be confirmed first. Raise as a separate brief once confirmed.
