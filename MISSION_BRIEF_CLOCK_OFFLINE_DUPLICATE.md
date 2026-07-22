# MISSION BRIEF — Offline Punch Queue & Duplicate Shift Warning

**Scope:** 2 files  
- `src/lib/punch-queue.ts` — new utility (create)  
- `src/app/dashboard/employee/overview/page.tsx` — consume the queue, add shift warning  

**DB step:** None — no DB changes required  
**Priority:** Medium — brings clock-in fully to MAUI parity  

---

## Feature 1 — Offline Punch Queue

### How it works

When `submitClock()` fails AND `!navigator.onLine`, the punch is saved to `localStorage` under the key `kf_punch_queue`. On the next dashboard load (or immediately if the browser fires an `online` event while the page is open), the queue is drained in order — each punch is retried with the current live session token.

The session token is **not** stored in the queue because JWT tokens expire. On retry, `tokRef.current` is used instead.

An idempotency key is already generated per punch — this ensures a queued punch is never inserted twice even if retry fires more than once.

---

### Step 1 — Create `src/lib/punch-queue.ts` (new file)

```ts
const QUEUE_KEY = 'kf_punch_queue'

export interface QueuedPunch {
  idempotency_key: string   // UUID — deduplication key
  company_id:      string
  employee_id:     string
  type:            'in' | 'out'
  date_time:       string   // ISO string — captured at the time the employee tapped
  latitude:        number | null
  longitude:       number | null
  address:         string | null
  job_id:          string | null
  notes:           string | null
  queued_at:       string   // ISO string — for display
}

export function getQueue(): QueuedPunch[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedPunch[]
  } catch { return [] }
}

export function enqueue(punch: QueuedPunch): void {
  const q = getQueue()
  if (q.some(p => p.idempotency_key === punch.idempotency_key)) return
  q.push(punch)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export function dequeue(idempotency_key: string): void {
  const q = getQueue().filter(p => p.idempotency_key !== idempotency_key)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY)
}
```

---

### Step 2 — Import the queue utility in `overview/page.tsx`

Add at the top of the file, with other imports:

```ts
import { type QueuedPunch, getQueue, enqueue, dequeue } from '@/lib/punch-queue'
```

---

### Step 3 — Add `pendingPunches` state (add with other clock state)

```ts
const [pendingPunches, setPendingPunches] = useState<QueuedPunch[]>([])
```

---

### Step 4 — Add `syncQueue()` function (add after `submitClock`)

This retries all queued punches using the current live token. It is called on init and on `window online` event.

```ts
async function syncQueue() {
  const queue = getQueue()
  if (queue.length === 0) return

  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

  for (const punch of queue) {
    const { error } = await rpc('employee_insert_punch', {
      p_company_id:            punch.company_id,
      p_employee_id:           punch.employee_id,
      p_type:                  punch.type,
      p_date_time:             punch.date_time,
      p_latitude:              punch.latitude,
      p_longitude:             punch.longitude,
      p_address:               punch.address,
      p_job_id:                punch.job_id,
      p_notes:                 punch.notes,
      p_punched_by_manager_id: null,
      p_idempotency_key:       punch.idempotency_key,
      p_session_token:         tokRef.current,  // always use current live token
    })
    if (!error) {
      dequeue(punch.idempotency_key)
    }
    // If error persists (e.g. token expired or server error), leave it in the queue
  }

  setPendingPunches(getQueue())
}
```

---

### Step 5 — Load queue on init and register `online` event listener

Inside the existing `useEffect(() => { init() }, [])` is fine for the init call. Add a second `useEffect` for the online listener:

```ts
// Add this useEffect after the existing useEffect(() => { init() }, [])
useEffect(() => {
  setPendingPunches(getQueue())

  const handleOnline = () => { syncQueue() }
  window.addEventListener('online', handleOnline)
  return () => window.removeEventListener('online', handleOnline)
}, [])
```

Also call `syncQueue()` at the END of `init()` (after `setLoading(false)` in the finally block), so queued punches from a previous session are retried automatically on load:

```ts
// At the end of init(), after setLoading(false):
syncQueue()
```

---

### Step 6 — Enqueue on network failure in `submitClock()`

In `submitClock()`, after the `if (error)` block that currently calls `setClockError(error.message)`, add:

```ts
// REPLACE the current error handler:
if (error) { setClockError(error.message); setClockLoading(false); return }

// WITH:
if (error) {
  if (!navigator.onLine) {
    // Save punch for later sync
    enqueue({
      idempotency_key: idempotencyKey,  // see Step 7 — hoist this variable
      company_id:      compId,
      employee_id:     empId,
      type:            isClockedIn ? 'out' : 'in',
      date_time:       punchDateTime,   // see Step 7 — hoist this variable
      latitude:        geoLat,
      longitude:       geoLng,
      address:         geoAddress,
      job_id:          clockJobId || null,
      notes:           clockNote || null,
      queued_at:       new Date().toISOString(),
    })
    setPendingPunches(getQueue())
    setShowClockModal(false)
    setClockLoading(false)
    return
  }
  setClockError(error.message)
  setClockLoading(false)
  return
}
```

---

### Step 7 — Hoist `idempotencyKey` and `punchDateTime` in `submitClock()` so both the RPC call and the enqueue call use the same values

Currently `submitClock()` passes `p_idempotency_key: crypto.randomUUID()` and `p_date_time: new Date().toISOString()` inline. Hoist them:

```ts
// ADD before the rpc('employee_insert_punch', ...) call:
const idempotencyKey = crypto.randomUUID()
const punchDateTime  = new Date().toISOString()

// THEN update the RPC call:
p_date_time:       punchDateTime,
// ...
p_idempotency_key: idempotencyKey,
```

---

### Step 8 — Show pending punches banner in the dashboard UI

In the page JSX, add a banner below the header (or at the top of the content area) — show only when `pendingPunches.length > 0`:

```tsx
{pendingPunches.length > 0 && (
  <div className="mx-4 mt-3 shrink-0 rounded-xl px-4 py-3 bg-warning/10 border border-warning/30 flex items-center justify-between gap-3">
    <div>
      <p className="text-[13px] font-semibold text-warning">
        {pendingPunches.length} punch{pendingPunches.length > 1 ? 'es' : ''} saved offline
      </p>
      <p className="text-[12px] text-text-secondary mt-0.5">
        Will sync automatically when you reconnect.
      </p>
    </div>
    <button
      onClick={syncQueue}
      className="text-[12px] font-semibold text-warning border border-warning/40 px-3 py-1.5 rounded-lg hover:bg-warning/10 transition-colors">
      Retry now
    </button>
  </div>
)}
```

---

## Feature 2 — Duplicate Shift Warning

### How it works

The dashboard already fetches `punchesToday` (count of today's punches). If `!isClockedIn && punchesToday >= 2`, the employee has already completed at least one shift today. Show a non-blocking warning banner inside the clock modal — same pattern as the leave warning. The employee can still clock in (perhaps starting a second shift on a different job).

---

### Step 9 — Add warning banner inside the clock modal JSX

Add this block **after** the leave warning banner (from MISSION_BRIEF_CLOCKIN_PARITY.md):

```tsx
{/* Duplicate shift warning */}
{!isClockedIn && punchesToday >= 2 && (
  <div className="rounded-lg px-3 py-2.5 bg-warning/10 border border-warning/30 mb-3">
    <p className="text-[12px] font-semibold text-warning">Shift already recorded today</p>
    <p className="text-[12px] text-text-secondary mt-0.5">
      You have {punchesToday} punches today. Clock in again only if starting a second shift.
    </p>
  </div>
)}
```

That's it. No state changes needed — `punchesToday` is already in scope.

---

## Summary of all changes

| File | Change |
|---|---|
| `src/lib/punch-queue.ts` | **Create** — `QueuedPunch` type + `getQueue` / `enqueue` / `dequeue` / `clearQueue` |
| `overview/page.tsx` | Import `QueuedPunch`, `getQueue`, `enqueue`, `dequeue` from `@/lib/punch-queue` |
| `overview/page.tsx` | Add `pendingPunches` state |
| `overview/page.tsx` | Add `syncQueue()` function after `submitClock` |
| `overview/page.tsx` | Add `useEffect` for `window online` event + initial queue load |
| `overview/page.tsx` | Call `syncQueue()` at end of `init()` |
| `overview/page.tsx` | Hoist `idempotencyKey` and `punchDateTime` in `submitClock()` |
| `overview/page.tsx` | On error in `submitClock()`: if offline → `enqueue()` + close modal |
| `overview/page.tsx` | Add pending punches banner in dashboard JSX |
| `overview/page.tsx` | Add duplicate shift warning banner in clock modal JSX |

## Edge cases handled

- **Idempotency:** same `idempotency_key` used for both the RPC call and the queue entry — if the RPC succeeded but the response was lost (network error after insert), the retry will silently do nothing on the server
- **Expired token:** on retry, `tokRef.current` is used — if the session has expired, the retry fails and the punch stays in the queue until the user re-authenticates
- **Multiple queued punches:** drained in order (FIFO) — clock-in before clock-out preserved
- **SSR safety:** `punch-queue.ts` guards with `typeof window === 'undefined'` so it never runs server-side
