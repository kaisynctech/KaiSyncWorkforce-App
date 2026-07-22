# MISSION BRIEF — Geofence Enforcement on Clock-In

**Scope:** 1 file — `src/app/dashboard/employee/overview/page.tsx`  
**DB step:** ✅ ALREADY DONE — `employee_get_job_geofence` RPC created in production (SECURITY DEFINER, confirmed `prosecdef: true`)  
**Priority:** High — MAUI blocks clock-in when employee is outside job site radius; web has no check at all  

---

## Background

Geofence enforcement is job-level:
- `jobs.site_radius_mode` (boolean) — `true` = enforcement active for this job
- `jobs.site_radius_meters` (double) — allowed radius from site center
- `jobs.site_id` (uuid FK → `sites`) — the site center

The `sites` table stores `latitude` and `longitude` for the center point. Because `sites` uses `user_company_ids()` RLS (blocked for code-auth users), a new SECURITY DEFINER RPC was created: `employee_get_job_geofence`. It returns `null` if the job has no geofence enforcement, or `{latitude, longitude, radius_meters, enforced}` if it does.

`employee_get_jobs_for_employee` already returns `j.*` (all job columns), so `site_id`, `site_radius_mode`, `site_radius_meters` are already in the response — the `Job` interface just doesn't pick them up yet.

MAUI behaviour: blocks clock-in with "Outside Work Zone" alert and returns early. Web matches this — geofence check runs only when clocking IN (not out), only when a job with enforcement is selected, and only once both GPS and site coordinates are available.

---

## Step 1 — Add Haversine helper (outside the component, near the other helpers at the top of the file)

```ts
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
```

---

## Step 2 — Extend `Job` interface (add 3 fields)

```ts
// REPLACE:
interface Job {
  id: string
  title: string
  status: string | null
}

// WITH:
interface Job {
  id: string
  title: string
  status: string | null
  site_id: string | null
  site_radius_mode: boolean | null
  site_radius_meters: number | null
}
```

---

## Step 3 — Add `geofenceData` state (add after `geoAddress` state line)

```ts
const [geofenceData, setGeofenceData] = useState<{
  latitude: number
  longitude: number
  radius_meters: number
} | null>(null)
```

---

## Step 4 — Add `onJobSelect` handler (add after `openClockModal`, before `submitClock`)

This replaces the direct `setClockJobId` call in the job picker. It also fetches geofence data when a geofence-enabled job is selected.

```ts
async function onJobSelect(jobId: string | null) {
  setClockJobId(jobId)
  setGeofenceData(null)
  if (!jobId) return

  const job = jobs.find(j => j.id === jobId)
  if (!job?.site_radius_mode || !job?.site_id) return

  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.rpc as any)('employee_get_job_geofence', {
    p_company_id:    companyIdRef.current,
    p_employee_id:   empIdRef.current,
    p_job_id:        jobId,
    p_session_token: tokRef.current,
  })
  if (data) {
    setGeofenceData(data as { latitude: number; longitude: number; radius_meters: number })
  }
}
```

---

## Step 5 — Reset `geofenceData` in `openClockModal()`

In `openClockModal()`, add `setGeofenceData(null)` alongside the other resets:

```ts
// FIND this block in openClockModal():
setGeoLat(null)
setGeoLng(null)
setGeoAddress(null)

// ADD after it:
setGeofenceData(null)
```

---

## Step 6 — Wire `onJobSelect` into the job picker in the clock modal

Find the job selector `<select>` inside the clock modal. It currently calls `setClockJobId` directly in its `onChange`. Replace it:

```tsx
// FIND (the job picker onChange — exact text will vary):
onChange={e => setClockJobId(e.target.value || null)}

// REPLACE WITH:
onChange={e => onJobSelect(e.target.value || null)}
```

---

## Step 7 — Add geofence guard in `submitClock()` (before the RPC call)

Insert after `setClockError(null)` and before the `rpc('employee_insert_punch', ...)` call:

```ts
// Geofence guard — only on clock-in, only when geofence data is loaded and GPS is ready
if (!isClockedIn && geofenceData && geoLat !== null && geoLng !== null) {
  const distM = haversineMeters(geoLat, geoLng, geofenceData.latitude, geofenceData.longitude)
  if (distM > geofenceData.radius_meters) {
    setClockError(
      `Outside work zone — you are ${Math.round(distM)}m from the site (limit: ${Math.round(geofenceData.radius_meters)}m). Move closer and try again.`
    )
    setClockLoading(false)
    return
  }
}
```

---

## Step 8 — Show geofence status in the clock modal UI

In the clock modal JSX, add this block **after** the leave warning banner (added in MISSION_BRIEF_CLOCKIN_PARITY.md):

```tsx
{/* Geofence status — shown when a geofence-enabled job is selected and GPS is ready */}
{geofenceData && geoLat !== null && geoLng !== null && (() => {
  const distM = haversineMeters(geoLat, geoLng!, geofenceData.latitude, geofenceData.longitude)
  const inside = distM <= geofenceData.radius_meters
  return (
    <div className={`rounded-lg px-3 py-2.5 mb-3 ${
      inside
        ? 'bg-success/10 border border-success/30'
        : 'bg-error/10 border border-error/30'
    }`}>
      <p className={`text-[12px] font-semibold ${inside ? 'text-success' : 'text-error'}`}>
        {inside ? 'Within work zone' : 'Outside work zone'}
      </p>
      <p className="text-[12px] text-text-secondary mt-0.5">
        {Math.round(distM)}m from site center · limit {Math.round(geofenceData.radius_meters)}m
      </p>
    </div>
  )
})()}
```

---

## Summary of changes

| What | Where | Detail |
|---|---|---|
| `employee_get_job_geofence` RPC | **DB — ALREADY CREATED** | SECURITY DEFINER; returns site lat/lng/radius or null if no enforcement |
| `haversineMeters()` helper | `overview/page.tsx` — top of file | Pure JS, no deps |
| `Job` interface | `overview/page.tsx` | + `site_id`, `site_radius_mode`, `site_radius_meters` |
| `geofenceData` state | `overview/page.tsx` | Holds fetched site center + radius |
| `onJobSelect()` handler | `overview/page.tsx` | Replaces direct `setClockJobId`; fetches geofence if job is enforcement-enabled |
| `openClockModal()` | `overview/page.tsx` | Resets `geofenceData` on open |
| Job picker `onChange` | `overview/page.tsx` (clock modal JSX) | `setClockJobId` → `onJobSelect` |
| `submitClock()` | `overview/page.tsx` | Haversine check before RPC call; blocks with error if outside radius |
| Clock modal JSX | `overview/page.tsx` | Geofence status banner (green inside / red outside) |

## Behaviour

- No job selected → no geofence check (punch goes through normally)
- Job selected, `site_radius_mode = false` → no geofence check
- Job selected, `site_radius_mode = true`, GPS not yet ready → `geofenceData` loaded but distance can't be computed; clock-in proceeds without block (graceful degradation)
- Job selected, `site_radius_mode = true`, GPS ready, inside radius → green banner, clock-in allowed
- Job selected, `site_radius_mode = true`, GPS ready, outside radius → red banner + `submitClock()` blocked with distance error
- Clock-out → geofence guard skipped entirely (`!isClockedIn` condition)
