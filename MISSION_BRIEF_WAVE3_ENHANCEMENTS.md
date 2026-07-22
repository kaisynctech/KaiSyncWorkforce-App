# MISSION BRIEF — Wave 3: Overview, My Profile, Messages — Complete Enhancement Pass
**Project:** kaisync-web (Next.js)  
**Prepared by:** KEES Architect  
**Date:** 2026-07-16  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Status:** READY FOR ENGINEERING EXECUTION  

> **Zero assumptions. Zero shortcuts. Every fix is backed by confirmed live DB schema and existing codebase patterns. Read this brief completely before touching any file.**

---

## PART A — REQUIRED DATABASE MIGRATION

> **KEES policy:** Engineer must create this file in `supabase/migrations/` and run via `supabase db push --db-url`. Do NOT apply via MCP or execute_sql directly.

### Migration file: `20260716120000_extend_employee_update_profile_photo.sql`

```sql
-- Extend employee_update_profile to accept p_profile_photo_url
-- Replaces the existing function entirely (CREATE OR REPLACE).
-- All existing parameters preserved exactly. One parameter added: p_profile_photo_url.

CREATE OR REPLACE FUNCTION public.employee_update_profile(
  p_employee_id       uuid,
  p_company_id        uuid,
  p_first_name        text    DEFAULT NULL,
  p_last_name         text    DEFAULT NULL,
  p_phone             text    DEFAULT NULL,
  p_id_number         text    DEFAULT NULL,
  p_bank_account      text    DEFAULT NULL,
  p_bank_name         text    DEFAULT NULL,
  p_bank_branch_code  text    DEFAULT NULL,
  p_profile_photo_url text    DEFAULT NULL,
  p_session_token     text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old employees%rowtype;
    v_emp employees%rowtype;
    v_bank_changed boolean := false;
    v_name text;
    r record;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    SELECT * INTO v_old
    FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    v_bank_changed := (
        (p_bank_account IS NOT NULL AND p_bank_account IS DISTINCT FROM v_old.bank_account)
        OR (p_bank_name IS NOT NULL AND p_bank_name IS DISTINCT FROM v_old.bank_name)
        OR (p_bank_branch_code IS NOT NULL AND p_bank_branch_code IS DISTINCT FROM v_old.bank_branch_code)
    );

    UPDATE employees SET
        name             = coalesce(p_first_name,          name),
        surname          = coalesce(p_last_name,           surname),
        phone            = coalesce(p_phone,               phone),
        id_number        = coalesce(p_id_number,           id_number),
        bank_account     = coalesce(p_bank_account,        bank_account),
        bank_name        = coalesce(p_bank_name,           bank_name),
        bank_branch_code = coalesce(p_bank_branch_code,    bank_branch_code),
        profile_photo_url = coalesce(p_profile_photo_url,  profile_photo_url),
        bank_details_updated_at = CASE WHEN v_bank_changed THEN now() ELSE bank_details_updated_at END,
        bank_details_updated_by = CASE WHEN v_bank_changed THEN 'employee' ELSE bank_details_updated_by END
    WHERE id = p_employee_id
    RETURNING * INTO v_emp;

    IF v_bank_changed THEN
        v_name := trim(coalesce(v_emp.name, '') || ' ' || coalesce(v_emp.surname, ''));

        FOR r IN
            SELECT DISTINCT hr.user_id AS auth_user_id
            FROM employees hr
            WHERE hr.company_id = p_company_id
              AND hr.user_id IS NOT NULL
              AND hr.is_active = true
              AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'hr')
              AND hr.id <> p_employee_id
        LOOP
            INSERT INTO app_notifications (
                company_id, audience, recipient_auth_user_id, recipient_employee_id,
                type, title, body, ref_type, ref_id, dedupe_key, data
            ) VALUES (
                p_company_id,
                'hr',
                r.auth_user_id,
                NULL,
                'bank_details_updated',
                'Banking details updated',
                v_name || ' updated their banking details for payroll.',
                'employee',
                p_employee_id::text,
                'bank_details_updated:' || p_employee_id::text || ':' || r.auth_user_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
                jsonb_build_object(
                    'employee_id', p_employee_id,
                    'company_id', p_company_id,
                    'employee_name', v_name
                )
            );
        END LOOP;
    END IF;

    RETURN row_to_json(v_emp);
END;
$$;
```

**What changed from the original:** one line added to the UPDATE statement:
```sql
profile_photo_url = coalesce(p_profile_photo_url, profile_photo_url),
```
And one parameter added to the signature: `p_profile_photo_url text DEFAULT NULL`.  
Everything else is identical to the existing live function body.

---

## PART B — OVERVIEW (`src/app/dashboard/overview/page.tsx`)

### B-1: Fix elapsed timer (live clock freezes after page load)

**Root cause:** The ticker `useEffect` (lines 56–64) calls `setElapsedMs(prev => prev)` — returning `prev` unchanged. `load()` sets the correct elapsed time once at init, but the value never updates again even though `now` ticks every 60 seconds.

**Fix — store base accumulated time separately from live portion:**

Step 1 — Add a ref to store the completed-sessions base:
```typescript
const baseElapsedRef = useRef<number>(0)   // ADD — accumulated completed sessions only
```

Step 2 — In `load()`, compute `accMs` for completed sessions ONLY (no live portion), store in ref, then add live portion for the initial display:
```typescript
// Inside load(), replace the self-punch block (lines 96–114) with:

const selfPunches = punches.filter(p => p.employee_id === member.employeeId)
let baseMs = 0           // completed sessions only
let lastInTime: string | null = null

for (const p of selfPunches) {
  if (p.type === 'in') {
    lastInTime = p.date_time
  } else if (p.type === 'out' && lastInTime) {
    baseMs += new Date(p.date_time).getTime() - new Date(lastInTime).getTime()
    lastInTime = null
  }
}

const selfClockedIn = latestByEmp.get(member.employeeId) === 'in'

if (selfClockedIn && lastInTime) {
  clockInTimeRef.current = lastInTime
  baseElapsedRef.current = baseMs
  // Initial display: base + live portion at load time
  setElapsedMs(baseMs + (Date.now() - new Date(lastInTime).getTime()))
} else {
  clockInTimeRef.current = null
  baseElapsedRef.current = baseMs
  setElapsedMs(baseMs)
}
setIsClockedIn(selfClockedIn)
```

Step 3 — Fix the ticker `useEffect` to recalculate from the base each minute:
```typescript
// Replace lines 56–64 with:
useEffect(() => {
  if (!isClockedIn || !clockInTimeRef.current) return
  setElapsedMs(
    baseElapsedRef.current + (now.getTime() - new Date(clockInTimeRef.current).getTime())
  )
}, [now, isClockedIn])
```

### B-2: Realtime subscription — live KPI update when employees punch

**What to add:** Subscribe to `time_punches` INSERT events for the company. On any new punch, re-fetch only today's punches and recalculate `clockedIn` count and the "not clocked in" list. Do NOT call `load()` — that re-fetches all 6 KPI counts on every punch which is wasteful.

**Add this helper function:**
```typescript
async function refreshPunchData(cid: string, empList: EmpRow[]) {
  const supabase = createClient()
  const { data } = await supabase
    .from('time_punches')
    .select('id, employee_id, type, date_time')
    .eq('company_id', cid)
    .gte('date_time', todayStart())
    .order('date_time', { ascending: true })

  const punches = (data ?? []) as TimePunch[]
  const latestByEmp = new Map<string, string>()
  for (const p of punches) latestByEmp.set(p.employee_id, p.type)
  const clockedInIds = new Set(
    [...latestByEmp.entries()].filter(([, t]) => t === 'in').map(([id]) => id)
  )

  setKpi(prev => ({ ...prev, clockedIn: clockedInIds.size }))
  setNotClockedInIds(new Set(empList.filter(e => !clockedInIds.has(e.id)).map(e => e.id)))

  // Also update self clock state
  const selfClockedIn = latestByEmp.get(eIdRef.current ?? '') === 'in'
  setIsClockedIn(selfClockedIn)
}
```

**Add these refs** (alongside the existing ones):
```typescript
const cIdRef   = useRef<string>('')    // ADD
const eIdRef   = useRef<string>('')    // ADD
const empsRef  = useRef<EmpRow[]>([])  // ADD
```

**Populate the refs in `load()`** (after setting state):
```typescript
cIdRef.current  = member.companyId
eIdRef.current  = member.employeeId
// After setAllEmployees(employees):
empsRef.current = employees
```

**Add realtime subscription `useEffect`** (after the existing clock ticker effects):
```typescript
useEffect(() => {
  if (!companyId) return
  const supabase = createClient()
  const channel = supabase
    .channel('overview-punches-rt')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'time_punches',
      filter: `company_id=eq.${companyId}`,
    }, () => {
      if (cIdRef.current && empsRef.current.length > 0) {
        refreshPunchData(cIdRef.current, empsRef.current)
      }
    })
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [companyId])
```

### B-3: Attendance progress bar

**Add this visual element inside the TODAY'S ATTENDANCE card**, between the header row and the "NOT SIGNED IN TODAY" label:

```tsx
{/* Progress bar — add immediately after the closing </div> of the header row */}
<div className="px-4 pt-3 pb-1">
  <div className="flex items-center justify-between mb-1.5">
    <span className="text-[11px] text-text-secondary">
      {kpi.clockedIn} of {kpi.headcount} clocked in
    </span>
    <span className="text-[11px] font-semibold text-text-primary">
      {kpi.headcount > 0 ? Math.round((kpi.clockedIn / kpi.headcount) * 100) : 0}%
    </span>
  </div>
  <div className="h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
    <div
      className="h-full rounded-full transition-all duration-500"
      style={{
        width: `${kpi.headcount > 0 ? (kpi.clockedIn / kpi.headcount) * 100 : 0}%`,
        backgroundColor: kpi.clockedIn === kpi.headcount ? '#22c55e' : '#3b82f6',
      }}
    />
  </div>
</div>
```

Color logic: green (`#22c55e`) when everyone is clocked in, blue (`#3b82f6`) otherwise. The `transition-all duration-500` animates the bar when the realtime subscription updates the count.

---

## PART C — MY PROFILE (`src/app/dashboard/profile/page.tsx`)

### C-1: Dirty state tracking — disable save when nothing changed

**Add a computed `isDirty` value** (no new state needed — derive from existing state vs loaded employee):

```typescript
const isDirty = employee !== null && (
  firstName   !== (employee.name             ?? '') ||
  lastName    !== (employee.surname          ?? '') ||
  phone       !== (employee.phone            ?? '') ||
  idNumber    !== (employee.id_number        ?? '') ||
  bankName    !== (employee.bank_name        ?? '') ||
  accountNumber !== (employee.bank_account   ?? '') ||
  branchCode  !== (employee.bank_branch_code ?? '')
)
```

Place this directly before the `return` statement.

**Update the Save button:**
```tsx
<button
  onClick={save}
  disabled={saving || !isDirty}
  className="w-full h-12 rounded-xl font-bold text-[15px] text-white transition-colors
    disabled:opacity-50 disabled:cursor-not-allowed"
  style={{ backgroundColor: isDirty ? 'var(--color-primary)' : 'var(--color-surface-elevated)',
           color: isDirty ? '#ffffff' : 'var(--color-text-disabled)',
           border: isDirty ? 'none' : '1px solid var(--color-divider)' }}
>
  {saving ? 'Saving…' : isDirty ? 'Save Changes' : 'No Changes'}
</button>
```

### C-2: Profile photo upload and display

**Requires the migration from Part A to be applied first.**

**Step 1 — Add state:**
```typescript
const [photoUrl,     setPhotoUrl]     = useState<string | null>(null)   // signed URL for display
const [photoUploading, setPhotoUploading] = useState(false)
const [photoError,   setPhotoError]   = useState<string | null>(null)
const photoInputRef = useRef<HTMLInputElement>(null)
```

**Step 2 — Load signed URL in `init()`**, after setting the employee state:
```typescript
// After: setEmployee(emp)
if (emp.profile_photo_url) {
  const { data: signed } = await supabase.storage
    .from('workforce-media')
    .createSignedUrl(emp.profile_photo_url, 3600)
  if (signed?.signedUrl) setPhotoUrl(signed.signedUrl)
}
```

**Step 3 — Upload function:**
```typescript
async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !empId || !companyId) return

  // Validate type and size
  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) {
    setPhotoError('Only JPEG, PNG or WebP images are allowed.')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    setPhotoError('Image must be under 5 MB.')
    return
  }

  setPhotoUploading(true)
  setPhotoError(null)

  const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `profile-photos/${companyId}/${empId}.${ext}`
  const supabase = createClient()

  // Upload (upsert — overwrite existing avatar)
  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (upErr) {
    setPhotoError(upErr.message)
    setPhotoUploading(false)
    return
  }

  // Save path to employee record via RPC
  const { error: rpcErr } = await (supabase.rpc as any)('employee_update_profile', {
    p_employee_id:       empId,
    p_company_id:        companyId,
    p_profile_photo_url: path,
  })

  if (rpcErr) {
    setPhotoError(rpcErr.message)
    setPhotoUploading(false)
    return
  }

  // Get signed URL for immediate display
  const { data: signed } = await supabase.storage
    .from('workforce-media')
    .createSignedUrl(path, 3600)
  if (signed?.signedUrl) setPhotoUrl(signed.signedUrl)

  // Reload employee data to keep state in sync
  await init()
  setPhotoUploading(false)
}
```

**Step 4 — Replace the avatar card JSX** (replace the entire avatar card div):
```tsx
{/* Avatar card */}
<div className="bg-surface border border-divider rounded-xl p-4 flex items-center gap-4">
  {/* Clickable avatar with camera overlay */}
  <div className="relative shrink-0">
    <div
      className="w-16 h-16 rounded-full overflow-hidden cursor-pointer"
      onClick={() => !photoUploading && photoInputRef.current?.click()}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-primary flex items-center justify-center">
          <span className="text-white text-[22px] font-bold">{getInitials(fullName)}</span>
        </div>
      )}
    </div>
    {/* Camera overlay */}
    <button
      onClick={() => !photoUploading && photoInputRef.current?.click()}
      disabled={photoUploading}
      className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary border-2
                 border-surface flex items-center justify-center disabled:opacity-50
                 hover:bg-primary-dark transition-colors"
      title="Change photo"
    >
      {photoUploading ? (
        <span className="material-icons text-white animate-spin text-[12px]">refresh</span>
      ) : (
        <span className="material-icons text-white text-[12px]">photo_camera</span>
      )}
    </button>
    <input
      ref={photoInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      onChange={handlePhotoUpload}
    />
  </div>

  <div className="min-w-0 flex-1">
    <p className="text-[18px] font-bold text-text-primary truncate">{fullName}</p>
    {employee?.position && (
      <p className="text-[13px] text-text-secondary">{employee.position}</p>
    )}
    <div className="flex gap-2 mt-1 flex-wrap">
      {employee?.access_level && (
        <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-primary/10 text-primary capitalize">
          {employee.access_level}
        </span>
      )}
      {employee?.employment_type && (
        <span className="text-[11px] px-2 py-[3px] rounded-full bg-surface-elevated border border-divider text-text-secondary capitalize">
          {employee.employment_type}
        </span>
      )}
    </div>
    <p className="text-[11px] text-text-disabled mt-1.5">Tap photo to change</p>
  </div>
</div>

{/* Photo error */}
{photoError && (
  <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
    <p className="text-[13px] font-semibold text-error">{photoError}</p>
  </div>
)}
```

### C-3: Banking details last-updated timestamp

**Add below the Banking Details section label**, replacing the existing subtitle:
```tsx
<div className="px-4 py-3 border-b border-divider">
  <p className="section-label">Banking Details</p>
  <div className="flex items-center gap-1.5 mt-0.5">
    <span className="material-icons text-[13px] text-text-disabled">lock</span>
    <p className="text-[11px] text-text-disabled">
      {employee?.bank_details_updated_at
        ? `Last updated ${new Date(employee.bank_details_updated_at).toLocaleDateString(
            'en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }
          )}`
        : 'Changes are logged for security'}
    </p>
  </div>
</div>
```

### C-4: Date of birth — read-only display

**Add to the Personal Information section**, between the ID Number field and the Email field:
```tsx
<FormField label="Date of Birth">
  <p className="text-[13px] text-text-disabled py-2 px-3 bg-surface-elevated rounded-lg border border-divider">
    {employee?.date_of_birth
      ? new Date(employee.date_of_birth).toLocaleDateString(
          'en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }
        )
      : '—'}
  </p>
</FormField>
```

**Note:** `date_of_birth` is `date` type in the DB. When PostgREST returns it, it comes as a string `'YYYY-MM-DD'`. `new Date('YYYY-MM-DD')` parses this as UTC midnight — in ZA timezone (UTC+2) this will display the correct date. No timezone conversion needed.

---

## PART D — MESSAGES (`src/app/dashboard/messages/page.tsx`)

### D-1: Unread thread indicator

**Strategy:** On page init, query `app_messages` once to get all thread IDs that have at least one message the current employee has not read. Store in a `Set<string>`. When a thread is opened, remove it from the set (it's been read).

**Step 1 — Add state:**
```typescript
const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set())
```

**Step 2 — Add load function:**
```typescript
async function loadUnreadThreadIds(cid: string, eid: string) {
  const supabase = createClient()
  // Get all messages in this company that this employee has NOT read
  const { data } = await supabase
    .from('app_messages')
    .select('thread_id')
    .eq('company_id', cid)
    .not('read_by_ids', 'cs', `{"${eid}"}`)   // read_by_ids does NOT contain employeeId

  const ids = new Set((data ?? []).map((r: { thread_id: string }) => r.thread_id))
  setUnreadThreadIds(ids)
}
```

**Step 3 — Call in `init()`**, alongside `loadThreads` and `loadEmployees`:
```typescript
await Promise.all([
  loadThreads(member.companyId, member.employeeId),
  loadEmployees(member.companyId, member.employeeId),
  loadUnreadThreadIds(member.companyId, member.employeeId),   // ADD
])
```

**Step 4 — Clear unread when thread is opened**, in `selectThread()`:
```typescript
// Add at the start of selectThread():
setUnreadThreadIds(prev => {
  const next = new Set(prev)
  next.delete(thread.id)
  return next
})
```

**Step 5 — Also refresh unread set when realtime fires** (new message arrived):
```typescript
// In the realtime .on() callback, add:
if (cIdRef.current && eIdRef.current) {
  loadUnreadThreadIds(cIdRef.current, eIdRef.current)   // ADD
  reloadMessages()
  loadThreads(cIdRef.current, eIdRef.current)
}
```

**Step 6 — Add the unread dot to the thread list item JSX:**

Replace the current thread button content:
```tsx
<button
  key={t.id}
  onClick={() => selectThread(t)}
  className={`w-full text-left px-4 py-3 border-b border-divider transition-colors hover:bg-background ${
    isActive ? 'bg-primary/5 border-l-[3px] border-l-primary' : ''
  }`}
>
  <div className="flex justify-between items-start gap-2 mb-0.5">
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {/* Unread dot */}
      {unreadThreadIds.has(t.id) && !isActive && (
        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
      )}
      <p className={`text-[13px] truncate flex-1 ${
        unreadThreadIds.has(t.id) && !isActive
          ? 'font-bold text-text-primary'
          : 'font-semibold text-text-primary'
      }`}>
        {t.subject ?? 'Untitled'}
      </p>
    </div>
    <p className="text-[10px] text-text-disabled shrink-0 mt-0.5">{fmtTime(t.last_message_at)}</p>
  </div>
  {t.last_message_preview && (
    <p className={`text-[12px] truncate ${
      unreadThreadIds.has(t.id) && !isActive ? 'text-text-primary' : 'text-text-secondary'
    }`}>
      {t.last_message_preview}
    </p>
  )}
  {t.type_raw && t.type_raw !== 'direct' && (
    <span className="inline-block mt-1 text-[10px] text-text-disabled capitalize bg-background border border-divider rounded px-1.5 py-0.5">
      {t.type_raw.replace(/_/g, ' ')}
    </span>
  )}
</button>
```

### D-2: Fix startDM — use refreshed thread from list, not raw RPC result

**Problem:** `employee_get_or_create_direct_thread_peer` returns a partial row. After creating/finding the thread, we call `loadThreads` which fetches the full thread list. We should find the thread in the refreshed list by ID, not cast the partial RPC result to `MessageThread`.

**Replace the `startDM` function:**
```typescript
async function startDM(peer: EmpPick) {
  if (!companyId || !employeeId) return
  setShowNew(false)
  setEmpSearch('')

  const peerName = `${peer.name} ${peer.surname}`
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: result } = await (supabase.rpc as any)('employee_get_or_create_direct_thread_peer', {
    p_company_id: companyId,
    p_creator_id: employeeId,
    p_peer_id:    peer.id,
    p_title:      `${myName} & ${peerName}`,
  })

  if (!result?.id) return

  // Reload the thread list so we have the full thread object
  const supabase2 = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: threadsData } = await (supabase2.rpc as any)('employee_get_message_threads_for_worker', {
    p_company_id:  companyId,
    p_employee_id: employeeId,
  })

  const refreshed = ((threadsData ?? []) as MessageThread[])
    .filter(t => !t.is_archived)
    .sort((a, b) => {
      if (!a.last_message_at) return 1
      if (!b.last_message_at) return -1
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    })
  setThreads(refreshed)

  // Find the full thread object by ID from the refreshed list
  const fullThread = refreshed.find(t => t.id === result.id)
  if (fullThread) {
    await selectThread(fullThread)
  }
}
```

### D-3: Auto-growing textarea

**Replace the static `<textarea>` in the input bar:**
```tsx
<textarea
  value={msgText}
  onChange={e => {
    setMsgText(e.target.value)
    // Auto-grow
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`  // max ~5 rows
  }}
  onKeyDown={e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }}
  placeholder="Type a message…"
  rows={1}
  style={{ height: 'auto', minHeight: '40px', maxHeight: '112px' }}
  className="flex-1 resize-none bg-background border border-border rounded-xl
             px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-disabled
             focus:outline-none focus:ring-2 focus:ring-primary/30 overflow-y-auto"
/>
```

**Reset height after send** — in `sendMessage()`, after `setMsgText('')`:
```typescript
// Reset textarea height after sending
const textarea = document.querySelector('textarea')
if (textarea) { textarea.style.height = 'auto' }
```

---

## PART E — COMPLETE EXECUTION ORDER

> Follow this order exactly. Do not skip steps.

1. **Apply migration** — create `supabase/migrations/20260716120000_extend_employee_update_profile_photo.sql` with the SQL from Part A. Run `supabase db push --db-url [DB_URL]`. Confirm function updated before touching any .tsx files.

2. **Fix `overview/page.tsx`** — B-1 (elapsed timer), B-2 (realtime subscription), B-3 (progress bar). These are independent changes within one file — do all three in one edit pass.

3. **Fix `profile/page.tsx`** — C-1 (dirty state), C-2 (photo upload), C-3 (bank timestamp), C-4 (date of birth). C-2 depends on the migration from step 1 being applied.

4. **Fix `messages/page.tsx`** — D-1 (unread indicator), D-2 (startDM fix), D-3 (auto-grow textarea). These are independent — do all three in one edit pass.

5. **TypeScript check** — `npx tsc --noEmit` must return zero errors. Do not commit if there are errors.

6. **Commit** — single commit with message: `feat: wave 3 — overview timer, realtime, profile photo, unread messages`

---

## PART F — VERIFICATION CHECKLIST

After pushing, verify each item manually in the browser:

| # | Test | Expected |
|---|------|----------|
| 1 | Clock in on Overview, wait 2+ minutes | Elapsed timer increments each minute |
| 2 | Clock in from mobile / another tab | Overview "Clocked In" KPI and progress bar update without page reload |
| 3 | Overview progress bar | Shows correct % and turns green when all clocked in |
| 4 | Profile — change nothing, click Save | Button shows "No Changes" and is disabled |
| 5 | Profile — change phone | Button activates as "Save Changes" |
| 6 | Profile — tap avatar | File picker opens; image uploads; avatar updates immediately |
| 7 | Profile — upload non-image file | Error: "Only JPEG, PNG or WebP images are allowed." |
| 8 | Profile — upload 6MB image | Error: "Image must be under 5 MB." |
| 9 | Profile — update bank account | "Last updated [today's date]" appears under Banking Details label |
| 10 | Profile — reload page | Avatar, all fields, and bank timestamp persist correctly |
| 11 | Messages — thread with unread message | Blue dot + bold text on thread row |
| 12 | Messages — open unread thread | Dot disappears, text returns to normal weight |
| 13 | Messages — receive message while on page | Unread dot appears on the thread row in real-time |
| 14 | Messages — click + New, pick employee | Conversation opens with correct thread subject (not "Untitled") |
| 15 | Messages — type multi-line message (Shift+Enter) | Textarea grows; stays within max height |
| 16 | Messages — send message | Textarea resets to 1 row |
| 17 | Profile — date of birth | Displays correctly formatted date or "—" |
| 18 | Profile — bank updated_at | Shows "Last updated [date]" after first banking save; shows security note if never updated |
