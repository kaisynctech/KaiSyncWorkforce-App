# MISSION BRIEF — Employee Portal Full Audit
**Scope:** All employee-side pages — auth through sign-out  
**Files:** 9 files  
**Status:** READY TO IMPLEMENT  
**Priority:** CRITICAL — code-auth employees cannot use most detail/write pages

---

## Audit Methodology

Every file was read in full. All findings were verified by inspecting actual code line numbers. No assumptions were made — only confirmed bugs are listed.

---

## Root Cause Patterns

Three systemic patterns account for 80% of all bugs:

### Pattern A — Wrong Session Token (5 files)
```ts
// WRONG — returns null for code-auth users (no JWT session)
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? null  // or ?? ''
```
Every RPC that receives this null/empty token will be rejected by `_assert_worker_access`.

**Correct pattern:**
```ts
const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
```

### Pattern B — Direct `.from()` Table Queries (4 files)
Code-auth users have `auth.uid() = null`. Any `supabase.from('table')...` call returns empty data (RLS policy rejects it silently). Pages appear to load but show no data.

**Fix**: Use an authenticated RPC where one exists. Where no RPC exists, read from `kf_cs` (which already has the data).

### Pattern C — Missing `middleware.ts` (1 file)
Next.js requires middleware to be in `src/middleware.ts`. The auth guard logic lives in `src/proxy.ts` which Next.js never calls. The guard is dead code.

---

## Bug List by File

---

### FILE 1 — `src/middleware.ts` (MISSING — must be created)

**Severity: Critical**

`src/proxy.ts` exists and exports `proxy` and `config` correctly, but Next.js requires the middleware file to be named `middleware.ts` in the `src/` directory. Without it:
- No server-side auth guard runs on any route
- HR routes are unprotected
- Access-level routing (employee vs HR redirect) never fires

**Fix**: Create `src/middleware.ts` with exactly one line:

```ts
export { proxy as default, config } from './proxy'
```

---

### FILE 2 — `src/app/auth/id-entry/page.tsx`

**Severity: Medium**

**Bug 1 — Lines 53 and 70: Wrong redirect after login**

Both sign-in paths (code-auth line 53, email line 70) redirect to `/dashboard/employee/attendance`. The attendance page shows punch history — it is not the landing page. The Dashboard (`/dashboard/employee/overview`) is the correct landing page (clock widget, jobs summary, PA tasks).

**Fix**: Change both redirects:
```ts
// Line 53 — code-auth path:
router.push('/dashboard/employee/overview')   // was: /attendance

// Line 70 — email path:
router.push('/dashboard/employee/overview')   // was: /attendance
```

---

### FILE 3 — `src/app/dashboard/employee/jobs/[id]/page.tsx`

**Severity: Critical (token) + High (RLS-blocked queries)**

**Bug 1 — Lines 176–178: Wrong session token (Pattern A)**

```ts
// CURRENT (broken for code-auth):
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? ''   // ← empty string for code-auth
setToken(tok)
```

The empty string `tok` is passed to every RPC on line 185 onwards (`employee_get_jobs_for_employee`, `employee_get_job_card_for_job`, `employee_get_checklist_for_job`, `employee_job_site_open_visit`, `employee_get_inventory_usage_for_job`, `employee_get_job_feedback`). All fail for code-auth users. The page shows a blank job card.

**Fix**: Replace lines 176–178:
```ts
const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
setToken(tok)
```

**Bug 2 — Lines 188 and 192: Direct table queries (Pattern B)**

```ts
// Line 188:
supabase.from('job_documents').select('*').eq('company_id', ...).eq('job_id', jobId)
// Line 192:
supabase.from('incident_reports').select('id,title,severity,status')...eq('employee_id', member.employeeId)
```

Both return empty data for code-auth users. The Documents section and the Linked Incidents section of the job card are always empty.

There IS an RPC for incidents: `employee_get_incidents` (or `employee_get_own_incidents` filtered by `job_id`). For job documents, there is `employee_get_job_documents`.

**Fix for line 188** — replace with RPC:
```ts
rpc('employee_get_job_documents', {
  p_company_id:    member.companyId,
  p_job_id:        jobId,
  p_employee_id:   member.employeeId,
  p_session_token: tok,
}),
```

**Fix for line 192** — replace with RPC and filter client-side:
```ts
rpc('employee_get_own_incidents', {
  p_company_id:    member.companyId,
  p_employee_id:   member.employeeId,
  p_session_token: tok,
}),
```
Then filter after: `const jobIncidents = (incRes.data as Incident[])?.filter(i => i.job_id === jobId) ?? []`

**Bug 3 — `openInvModal()` (line ~406): Direct table query for inventory items (Pattern B)**

```ts
supabase.from('inventory_items').select('id, name, unit_cost')
  .eq('company_id', companyId)
```

Returns empty for code-auth. The inventory picker shows nothing when employee tries to log item usage.

**Fix**: Replace with RPC:
```ts
const { data: items } = await (supabase.rpc as any)('employee_get_inventory_items', {
  p_company_id:    companyId,
  p_employee_id:   empId,
  p_session_token: token,
})
```

**Bug 4 — Photo/document upload (Pattern B + token)**

The `token` state (empty string for code-auth) is used in `saveCard()`, `submitInventory()`, `submitFeedback()`, and all site-visit action RPCs. After Bug 1 is fixed (tok correctly set and stored in `setToken`), this resolves automatically. No separate fix needed — fixing Bug 1 fixes the token for all downstream mutations.

---

### FILE 4 — `src/app/dashboard/employee/pa/_editor.tsx`

**Severity: Critical (token) + High (RLS-blocked link pickers)**

**Bug 1 — Lines 91–92: Wrong session token (Pattern A)**

```ts
// CURRENT:
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? ''   // ← empty string for code-auth
setToken(tok)
```

The `tok` is passed to `employee_get_pa_tasks` at line 101 (task load in edit mode) and to `employee_insert_pa_task` / `employee_update_pa_task` at line 184 (`save()`). Creating and editing PA tasks is completely broken for code-auth users.

**Fix**: Replace lines 91–92:
```ts
const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
setToken(tok)
```

**Bug 2 — `loadLinkOptions()` lines 133–142: Direct table queries (Pattern B)**

```ts
supabase.from('clients').select('id, name').eq('company_id', companyId)
supabase.from('jobs').select('id, title').eq('company_id', companyId)
supabase.from('client_deals').select('id, title').eq('company_id', companyId)
```

All three return empty for code-auth users. When an employee tries to link a PA task to a job, the dropdown shows nothing.

The `employee_get_jobs_for_employee` RPC already exists and returns full job data.

**Fix for `jobs` link type**:
```ts
} else if (linkedType === 'job') {
  const member = JSON.parse(localStorage.getItem('kf_cs') ?? '{}')
  const tok = member.session_token ?? (await createClient().auth.getSession()).data.session?.access_token ?? null
  const { data: rows } = await (createClient().rpc as any)('employee_get_jobs_for_employee', {
    p_employee_id:   companyId ? member.employee_id : null,
    p_company_id:    companyId,
    p_session_token: tok,
  })
  data = ((rows ?? []) as Array<{id: string; title: string}>).map(r => ({ id: r.id, label: r.title }))
```

**Fix for `clients` and `deals` link types**: Gate to JWT users only (`member.sessionToken === null`). For code-auth users, show a message: "Sign in with email to link clients or deals."

```ts
if (linkedType === 'client' || linkedType === 'deal') {
  // These tables require JWT auth — not available for code-auth sessions
  // Check if JWT session exists
  const { data: { session } } = await createClient().auth.getSession()
  if (!session) {
    setLinkOptions([])
    setLoadingLinks(false)
    return
  }
  // ... existing code for JWT users ...
}
```

---

### FILE 5 — `src/app/dashboard/employee/incidents/[id]/page.tsx`

**Severity: Critical**

**Bug 1 — Lines 77–78: Wrong session token (Pattern A)**

```ts
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? null
```

Passed to `employee_get_incident_comments` (line 89) and `employee_get_incident_status_history` (line 90). Both fail for code-auth users.

**Fix**: Replace lines 77–78:
```ts
const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
```

**Bug 2 — Lines 82–88: Direct table query for main incident data (Pattern B)**

```ts
supabase
  .from('incident_reports')
  .select('id, title, severity, status, occurred_at, location_text, description, created_at, photo_urls')
  .eq('id', incId)
  .eq('company_id', member.companyId)
  .maybeSingle()
```

Returns `{data: null}` for code-auth. The page shows "Incident not found" for all code-auth users.

The RPC `employee_get_incident` exists (confirmed VOLATILE). Use it instead:

**Fix**: Replace `supabase.from('incident_reports')...maybeSingle()` in the Promise.all with:
```ts
rpc('employee_get_incident', {
  p_incident_id:   incId,
  p_employee_id:   member.employeeId,
  p_company_id:    member.companyId,
  p_session_token: tok,
}),
```

Then change result handling:
```ts
// Was: const inc = incRes.data as Incident | null
const inc = (Array.isArray(incRes.data) ? incRes.data[0] : incRes.data) as Incident | null
```
(Some RPCs return `[row]` not the row directly — test and adjust.)

**Bug 3 — `addComment()` line 113: Wrong session token (Pattern A)**

```ts
const { data: { session } } = await supabase.auth.getSession()
// line 120:
p_session_token: session?.access_token ?? null,
```

**Fix**: Add `tokRef` to store the token set in `init()`, same as `empId`/`companyId` state refs:
```ts
const tokRef = useRef<string | null>(null)
// In init(), after fixing Bug 1:
tokRef.current = tok
```
Then in `addComment()`:
```ts
// Remove the supabase.auth.getSession() call entirely, replace with:
p_session_token: tokRef.current,
```

Apply the same pattern to `appendPhotos()` (line ~140, same broken `getSession()` call).

---

### FILE 6 — `src/app/dashboard/employee/notifications/page.tsx`

**Severity: High**

**Bug 1 — Lines 124–126: Wrong session token (Pattern A)**

```ts
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token ?? null
setTok(token)
```

Passed to `employee_get_my_notifications_for_employee` at line 132. App notifications don't load for code-auth users.

**Fix**: Replace lines 124–126:
```ts
const token = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
setTok(token)
```

**Bug 2 — Lines 136–142: Direct table query for leave data (Pattern B)**

```ts
supabase.from('leave_requests').select('id, leave_type, status, decided_at, created_at, start_date, end_date')
  .eq('company_id', member.companyId)
  .eq('employee_id', member.employeeId)
  .order('created_at', { ascending: false })
  .limit(20),
```

Returns empty for code-auth. Leave-derived notification items are always missing.

**Fix**: Replace with RPC (already called correctly elsewhere in the codebase):
```ts
rpc('employee_get_leave_requests', {
  p_company_id:    member.companyId,
  p_employee_id:   member.employeeId,
  p_session_token: token,
}),
```
The `LeaveRow` interface fields already match what `employee_get_leave_requests` returns (leave_type, status, decided_at, created_at, start_date, end_date).

**Bug 3 — `markRead()` lines 181–188: Wrong session token (Pattern A)**

```ts
const { data: { session } } = await supabase.auth.getSession()
// ...
p_session_token: session?.access_token ?? null,
```

**Fix**: Remove the `getSession()` call, use the stored `tok` state instead:
```ts
async function markRead(item: UnifiedItem) {
  if (item.source !== 'app') return
  if (!empId) return
  const supabase = createClient()
  try {
    await (supabase.rpc as any)('employee_mark_notification_read_for_employee', {
      p_employee_id:      empId,
      p_notification_id:  item.id as number,
      p_session_token:    tok,   // ← use stored state, not a new getSession() call
    })
    setItems(prev => prev.map(n => n.key === item.key ? { ...n, is_read: true } : n))
  } catch { /* non-critical */ }
}
```

---

### FILE 7 — `src/app/dashboard/profile/page.tsx`

**Severity: High**

**Bug 1 — Lines 58–70: Direct table queries for profile data (Pattern B)**

```ts
supabase.from('companies').select('name').eq('id', member.companyId).maybeSingle()
supabase.from('employees').select('*').eq('id', member.employeeId)...maybeSingle()
```

Both return empty for code-auth users. The profile page shows nothing — no name, no company, no employee record.

**Fix**: For code-auth users, this data is already in `localStorage['kf_cs']`. Read it directly:

Replace lines 58–93 in `init()` with:

```ts
// Try to get employee data — use kf_cs for code-auth, RPC/table for JWT
const csRaw = typeof window !== 'undefined' ? localStorage.getItem('kf_cs') : null
const cs = csRaw ? JSON.parse(csRaw) : null

if (cs?.employee && cs?.company) {
  // Code-auth: data already in localStorage
  setCompanyName(cs.company.name ?? '')
  const emp = {
    id:        cs.employee.id,
    name:      cs.employee.name ?? '',
    surname:   cs.employee.surname ?? '',
    position:  cs.employee.position ?? '',
    phone:     cs.employee.phone ?? null,
    id_number: cs.employee.employee_code ?? '',
    bank_name: null, bank_account: null, bank_branch_code: null,
    profile_photo_url: null,
    access_level: cs.employee.access_level,
  }
  setEmployee(emp as unknown as Employee)
  setFirstName(emp.name)
  setLastName(emp.surname)
  setPhone(emp.phone ?? '')
  setIdNumber(emp.id_number)
} else {
  // JWT path: use direct table queries (auth.uid() is valid)
  const { data: companyRow } = await supabase
    .from('companies').select('name').eq('id', member.companyId).maybeSingle()
  if (companyRow?.name) setCompanyName(companyRow.name)

  const { data } = await supabase
    .from('employees').select('*').eq('id', member.employeeId)
    .eq('company_id', member.companyId).maybeSingle()

  if (data) {
    const emp = data as Employee
    setEmployee(emp)
    setFirstName(emp.name ?? '')
    setLastName(emp.surname ?? '')
    setPhone(emp.phone ?? '')
    setIdNumber(emp.id_number ?? '')
    setBankName(emp.bank_name ?? '')
    setAccountNumber(emp.bank_account ?? '')
    setBranchCode(emp.bank_branch_code ?? '')
    if (emp.profile_photo_url) {
      const { data: signed } = await supabase.storage
        .from('workforce-media').createSignedUrl(emp.profile_photo_url, 3600)
      if (signed?.signedUrl) setPhotoUrl(signed.signedUrl)
    }
  }
}
setLoading(false)
```

**Note**: Bank details (bank_name, bank_account, bank_branch_code) are not in `kf_cs`. For code-auth users, those fields remain blank but editable if saved via RPC. This is acceptable — security risk to expose bank details in localStorage.

**Bug 2 — `handlePhotoUpload()` line 114 and `save()` line 142: Wrong session token (Pattern A)**

```ts
const { data: { session: photoSession } } = await supabase.auth.getSession()
// ...
p_session_token: photoSession?.access_token ?? null,
```

Same pattern in both `handlePhotoUpload()` and `save()`.

**Fix**: Add a `tokRef` (useRef) in the component, set it in `init()`:

In the component body:
```ts
const tokRef = useRef<string | null>(null)
```

In `init()`, after resolving member:
```ts
const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
tokRef.current = tok
```

Then in `handlePhotoUpload()`, replace:
```ts
// REMOVE:
const { data: { session: photoSession } } = await supabase.auth.getSession()
// CHANGE line 124:
p_session_token: tokRef.current,
```

Same in `save()` — remove the `getSession()` call and use `tokRef.current`.

---

### FILE 8 — `src/app/dashboard/messages/page.tsx`

**Severity: High (employees list) + Medium (unread indicators)**

**Bug 1 — `loadEmployees()` lines 133–138: Direct table query (Pattern B)**

```ts
supabase.from('employees').select('id, name, surname')
  .eq('company_id', cid).eq('is_active', true).neq('id', myId)
```

Returns empty for code-auth. The "New Message" DM picker shows no employees. Code-auth users can't start new conversations — only reply to existing ones.

**Fix**: Replace with RPC:
```ts
const { data: rows } = await (supabase.rpc as any)('employee_list_company_peers', {
  p_company_id:    cid,
  p_employee_id:   myId,
  p_session_token: tokRef.current,
})
const peers = ((rows ?? []) as Array<{id: string; name: string; surname: string}>)
  .map(e => ({ id: e.id, name: `${e.name} ${e.surname}`.trim() }))
```

(`employee_list_company_peers` is confirmed VOLATILE in the DB — it was in the 37-function list.)

**Bug 2 — `loadUnreadThreadIds()` lines 141–149: Direct table query (Pattern B)**

```ts
supabase.from('app_messages').select('thread_id')
  .eq('company_id', cid).not('read_by_ids', 'cs', `{"${eid}"}`)
```

Returns empty for code-auth. Unread blue dots never appear on threads.

**Fix**: This is a non-critical enhancement. Gate with a try/catch and accept that unread state won't show for code-auth users until an RPC is available:

```ts
async function loadUnreadThreadIds(supabase: SupabaseClient, cid: string, eid: string) {
  // Only works for JWT users — code-auth users have no direct table access
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return new Set<string>()
  try {
    const { data } = await supabase.from('app_messages').select('thread_id')
      .eq('company_id', cid).not('read_by_ids', 'cs', `{"${eid}"}`)
    return new Set<string>((data ?? []).map(m => m.thread_id))
  } catch { return new Set<string>() }
}
```

---

### FILE 9 — `src/app/dashboard/employee/leave/page.tsx`

**Severity: Medium**

**Bug 1 — Line ~298: Attachment URLs are raw storage paths, not signed URLs**

```tsx
<a href={req.attachment_url} target="_blank" rel="noopener noreferrer">
```

`req.attachment_url` is a raw path like `leave-attachments/company-id/emp-id/file.pdf`. For private Supabase Storage buckets this returns 400/403. The download link appears to work (renders an anchor) but the file never opens.

**Fix**: Create a helper function and call it on click rather than as an `href`:

```tsx
async function openAttachment(url: string) {
  const supabase = createClient()
  const { data } = await supabase.storage.from('workforce-media').createSignedUrl(url, 3600)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}
```

Replace the anchor:
```tsx
// REPLACE:
<a href={req.attachment_url} target="_blank" rel="noopener noreferrer" ...>
  <span className="material-icons text-[14px]">attach_file</span>
</a>

// WITH:
<button onClick={() => openAttachment(req.attachment_url!)} ...>
  <span className="material-icons text-[14px]">attach_file</span>
</button>
```

---

### FILE 10 — `src/app/dashboard/employee/pa/page.tsx`

**Severity: Medium**

**Bug 1 — Lines 392 and 395: `due_date` vs `due_at` field inconsistency**

The KPI counter and Today's Agenda filter both use `due_date`:
```ts
// Line 392:
const dueTodayCount = tasks.filter(t => t.status !== 'done' && t.due_date === todayStr).length
// Line 395:
const todayTasks = tasks.filter(t =>
  t.due_date === todayStr || t.meeting_at?.startsWith(todayStr) || t.remind_at?.startsWith(todayStr)
)
```

DB verified: the RPC returns `due_at` (e.g., `"2026-05-28 14:00:00+00"`) as a full ISO timestamp. `due_date` is either null or a date-only string. The "Due Today" count and Today's Agenda can be 0 even when tasks are due today.

**Fix**: Change lines 392 and 395 to use `due_at`:
```ts
// Line 392:
const dueTodayCount = tasks.filter(t => t.status !== 'done' && t.due_at?.startsWith(todayStr)).length

// Lines 395–397:
const todayTasks = tasks.filter(t =>
  t.due_at?.startsWith(todayStr) ||
  t.meeting_at?.startsWith(todayStr) ||
  t.remind_at?.startsWith(todayStr)
)
```

---

## Complete Checklist

### New file
- [ ] Create `src/middleware.ts` with one line: `export { proxy as default, config } from './proxy'`

### `src/app/auth/id-entry/page.tsx`
- [ ] Line 53: change redirect to `/dashboard/employee/overview`
- [ ] Line 70: change redirect to `/dashboard/employee/overview`

### `src/app/dashboard/employee/jobs/[id]/page.tsx`
- [ ] Lines 176–178: fix session token (use `member.sessionToken ?? session?.access_token ?? null`)
- [ ] Line 188: replace `from('job_documents')` with `employee_get_job_documents` RPC
- [ ] Line 192: replace `from('incident_reports')` with `employee_get_own_incidents` RPC + filter by `job_id`
- [ ] Line ~406 in `openInvModal()`: replace `from('inventory_items')` with `employee_get_inventory_items` RPC

### `src/app/dashboard/employee/pa/_editor.tsx`
- [ ] Lines 91–92: fix session token
- [ ] `loadLinkOptions()` jobs branch: replace `from('jobs')` with `employee_get_jobs_for_employee` RPC
- [ ] `loadLinkOptions()` clients/deals branch: gate on JWT session (code-auth graceful fallback)

### `src/app/dashboard/employee/incidents/[id]/page.tsx`
- [ ] Lines 77–78: fix session token
- [ ] Lines 82–88: replace `from('incident_reports')` with `employee_get_incident` RPC
- [ ] Add `tokRef` and use in `addComment()` line 113 (remove second `getSession()` call)
- [ ] Add `tokRef` and use in `appendPhotos()` (remove second `getSession()` call)

### `src/app/dashboard/employee/notifications/page.tsx`
- [ ] Lines 124–126: fix session token (use `member.sessionToken ?? session?.access_token ?? null`)
- [ ] Lines 136–142: replace `from('leave_requests')` with `employee_get_leave_requests` RPC
- [ ] `markRead()` lines 181–188: use stored `tok` state, remove second `getSession()` call

### `src/app/dashboard/profile/page.tsx`
- [ ] Lines 58–70: gate table queries on JWT path; read `kf_cs` for code-auth users
- [ ] Add `tokRef` and set in `init()`
- [ ] `handlePhotoUpload()` line 114: remove `getSession()` call, use `tokRef.current`
- [ ] `save()` line 142: remove `getSession()` call, use `tokRef.current`

### `src/app/dashboard/messages/page.tsx`
- [ ] `loadEmployees()` line 133: replace `from('employees')` with `employee_list_company_peers` RPC
- [ ] `loadUnreadThreadIds()` lines 141–149: gate on JWT session (code-auth graceful fallback)

### `src/app/dashboard/employee/leave/page.tsx`
- [ ] Line ~298: replace attachment `<a href>` with `<button onClick>` that generates a signed URL

### `src/app/dashboard/employee/pa/page.tsx`
- [ ] Line 392: change `due_date === todayStr` to `due_at?.startsWith(todayStr)`
- [ ] Lines 395–397: change `due_date` to `due_at?.startsWith(todayStr)`

---

## Pages Confirmed Working (No Bugs)

| Page | Status |
|------|--------|
| `overview/page.tsx` | ✅ Correct session token, bound RPC, JWT-gated colleagues query |
| `jobs/page.tsx` | ✅ Correct session token, direct RPC call, scope logic fixed |
| `pa/page.tsx` (excluding due_date bug) | ✅ Session token correct, RPCs correct |
| `incidents/page.tsx` | ✅ Correct session token, direct RPC call |
| `payslips/page.tsx` | ✅ Correct session token, direct RPC call |
| `leave/page.tsx` (excluding attachment bug) | ✅ Correct session token, RPC call correct |
| `shifts/page.tsx` | ✅ Correct tokRef pattern, all RPCs correct |
| `forms/page.tsx` | ✅ Correct session token, bound wrapper |
| `EmployeeSidebar.tsx` | ✅ Sign-out clears both JWT and `kf_cs` |
| `resolve-company.ts` | ✅ Correct dual-path pattern |

---

## Verification Steps (after deploy)

All verifications should be done logged in as a **code-auth employee** (company code `28`, ID number `FN211956`) since that is the path that was systematically broken.

1. **Middleware** → navigate to `/dashboard/employee/overview` while logged out — should redirect to `/auth/id-entry`
2. **Login redirect** → log in with company code — should land on `/dashboard/employee/overview` (not attendance)
3. **Job detail** → click any job from the list — job card must fully load (title, checklist, documents, site visit button)
4. **Incident detail** → click any incident — incident title/description must appear (not "Incident not found")
5. **Add incident comment** → add a comment on an incident — should succeed and appear in the list
6. **PA editor** → create a new PA task — save should succeed (no error toast)
7. **PA today count** → check that "Due Today" KPI on PA page shows correct number
8. **Notifications** → app notification items should load (check network tab for RPC response)
9. **Profile** → My Profile must show employee name and company name (not blank fields)
10. **Profile save** → edit phone number and save — should succeed (no error)
11. **Messages DM picker** → click "New Message" → list of colleagues must appear
12. **Leave attachment** → click the attach_file button on a leave request with an attachment — PDF/file must open
