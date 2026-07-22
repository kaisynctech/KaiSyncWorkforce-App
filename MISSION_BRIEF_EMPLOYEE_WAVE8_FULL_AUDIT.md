# MISSION BRIEF — EMPLOYEE PORTAL WAVE 8 (FULL AUDIT FIXES)

**Date:** 2026-07-17  
**Scope:** 5 files — `jobs/page.tsx`, `jobs/[id]/page.tsx`, `incidents/[id]/page.tsx`, `jobs/new/page.tsx`, `messages/page.tsx`  
**Bugs:** 17 confirmed bugs across 5 files  
**Verified clean (no action needed):** `incidents/page.tsx`, `incidents/new/page.tsx`, `payslips/page.tsx`, `attendance/page.tsx`, `documents/page.tsx`, `notifications/page.tsx`, `overview/page.tsx`, `pa/*`, `shifts/page.tsx`, `contractor/page.tsx`, `forms/*`, `leave/page.tsx` (Wave 7), `profile/page.tsx` (Wave 7), `layout.tsx`

---

## STANDING RULES

1. Zero tolerance on table, column, or RPC names that were not verified in the DB. Every name in this brief was verified.
2. `p_session_token` is always `session?.access_token ?? null`. Always fetch via `const { data: { session } } = await supabase.auth.getSession()`.
3. Storage bucket `workforce-media` is **private**. All file reads use `createSignedUrl(path, expiry_seconds)`. `getPublicUrl` is NEVER used on this bucket.
4. Match MAUI exactly. Enhancements are labelled `[ENHANCEMENT]`.

---

## FILE 1 — `src/app/dashboard/employee/jobs/page.tsx`

### Bug 1 — `employee_get_jobs_for_employee` missing `p_session_token`

**Current:**
```ts
const { data } = await (supabase.rpc as any)('employee_get_jobs_for_employee', {
  p_employee_id: member.employeeId,
  p_company_id:  member.companyId,
})
```

**Fix:** fetch session in `init()` and pass it:
```ts
const { data: { session } } = await supabase.auth.getSession()
const { data } = await (supabase.rpc as any)('employee_get_jobs_for_employee', {
  p_employee_id:   member.employeeId,
  p_company_id:    member.companyId,
  p_session_token: session?.access_token ?? null,
})
```

---

## FILE 2 — `src/app/dashboard/employee/jobs/[id]/page.tsx`

### Bug 2 — `employee_get_jobs_for_employee` missing `p_session_token` (line 184)

In `init()`, the parallel Promise.all call includes:
```ts
rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId }),
```

**Fix:** `tok` is already fetched in `init()` at line 176. Pass it:
```ts
rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
```

### Bug 3 — Wrong table name `incidents` (line 191)

**Current:**
```ts
supabase.from('incidents').select('id,title,severity,status').eq('company_id', member.companyId).eq('job_id', jobId).eq('employee_id', member.employeeId),
```

**Fix:** Table is `incident_reports`, not `incidents`:
```ts
supabase.from('incident_reports').select('id,title,severity,status').eq('company_id', member.companyId).eq('job_id', jobId).eq('employee_id', member.employeeId),
```

### Bug 4 — `getPublicUrl` on private bucket (lines 309 and 327)

Both `uploadPhoto` and `uploadDoc` upload a file then use `getPublicUrl` to store the URL in `job_documents`.

**Current (both instances):**
```ts
const { data: urlData } = await supabase.storage.from('workforce-media').getPublicUrl(path)
await supabase.from('job_documents').insert({
  ...
  file_url: urlData.publicUrl
})
```

**Fix:** Store the storage path directly — NOT a URL. The file_url column stores the raw path. Signed URLs are generated at read time.

```ts
// uploadPhoto — remove the getPublicUrl call entirely, insert path directly:
await supabase.from('job_documents').insert({
  company_id: companyId,
  job_id: jobId,
  document_name: file.name,
  document_type: phase,
  file_url: path,          // store path, not public URL
})

// uploadDoc — same:
await supabase.from('job_documents').insert({
  company_id: companyId,
  job_id: jobId,
  document_name: name,
  document_type: 'other',
  file_url: path,          // store path, not public URL
})
```

Also ensure any rendering of `job_documents` file_url uses `createSignedUrl(doc.file_url, 3600)` before opening the file. Search for all places in this file that render a `doc.file_url` or `document.file_url` — replace any direct URL use with a signed URL fetch.

### Bug 5 — `get_or_create_job_thread` RPC does not exist in DB

This RPC is called somewhere in the job detail page to open a messaging thread. DB verification confirms it does not exist. The call will fail silently on every job detail load.

**Fix:** Guard the call so it fails without crashing the page. Wrap in try/catch and if `rpcErr` occurs, do not surface an error to the user — simply skip the thread feature:
```ts
try {
  const { data: threadData, error: threadErr } = await (supabase.rpc as any)('get_or_create_job_thread', {
    // existing params...
  })
  if (!threadErr && threadData) {
    // set thread state
  }
} catch {
  // thread feature unavailable — skip silently
}
```

> **Note to engineer:** Do not remove the button/UI for the thread feature — just guard the RPC call. The RPC needs to be created in the DB by the backend team. Log it as a backend gap.

---

## FILE 3 — `src/app/dashboard/employee/incidents/[id]/page.tsx`

This page has **7 bugs**. Three categories: missing RPC, missing session tokens, and wrong field names.

### Bug 6 — `employee_get_incident_detail` RPC does not exist in DB

The entire incident detail page fails to load because the primary data RPC does not exist.

**Fix:** Replace the `employee_get_incident_detail` RPC call with a direct query to `incident_reports`:

**Current (line 80):**
```ts
rpc('employee_get_incident_detail', { p_incident_id: incId, p_employee_id: member.employeeId, p_company_id: member.companyId }),
```

**Fix:**
```ts
supabase
  .from('incident_reports')
  .select('id, title, severity, status, occurred_at, location_text, description, created_at, photo_urls')
  .eq('id', incId)
  .eq('company_id', member.companyId)
  .maybeSingle(),
```

Update the destructuring accordingly — the result comes from `.data` directly (not an array), so:
```ts
const [incRes, cRes, hRes] = await Promise.all([...])
const inc = incRes.data as Incident | null
setIncident(inc)
```

### Bug 7 — `employee_get_incident_comments` missing `p_session_token` (line 81)

**Current:**
```ts
rpc('employee_get_incident_comments', { p_incident_id: incId, p_employee_id: member.employeeId, p_company_id: member.companyId }),
```

**Fix:**
```ts
const { data: { session } } = await supabase.auth.getSession()
// then in the parallel call:
rpc('employee_get_incident_comments', { p_incident_id: incId, p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: session?.access_token ?? null }),
```

### Bug 8 — `employee_get_incident_status_history` missing `p_session_token` (line 82)

**Current:**
```ts
rpc('employee_get_incident_status_history', { p_incident_id: incId, p_employee_id: member.employeeId, p_company_id: member.companyId }),
```

**Fix:** Add `p_session_token: session?.access_token ?? null` (session fetched alongside Bug 7 fix above — fetch once, pass everywhere).

### Bug 9 — `employee_add_incident_comment` missing `p_session_token` (line ~105)

**Current:**
```ts
await (supabase.rpc as any)('employee_add_incident_comment', {
  p_incident_id: incId,
  p_employee_id: empId,
  p_company_id:  companyId,
  p_body:        comment.trim(),
})
```

**Fix:**
```ts
const { data: { session } } = await supabase.auth.getSession()
await (supabase.rpc as any)('employee_add_incident_comment', {
  p_incident_id:   incId,
  p_employee_id:   empId,
  p_company_id:    companyId,
  p_body:          comment.trim(),
  p_session_token: session?.access_token ?? null,
})
```

### Bug 10 — `employee_append_incident_photos` missing `p_session_token` (line ~130)

**Current:**
```ts
await (supabase.rpc as any)('employee_append_incident_photos', {
  p_incident_id: incId,
  p_employee_id: empId,
  p_company_id:  companyId,
  p_photo_urls:  paths,
})
```

**Fix:**
```ts
const { data: { session } } = await supabase.auth.getSession()
await (supabase.rpc as any)('employee_append_incident_photos', {
  p_incident_id:   incId,
  p_employee_id:   empId,
  p_company_id:    companyId,
  p_photo_urls:    paths,
  p_session_token: session?.access_token ?? null,
})
```

### Bugs 11 & 12 — Wrong field names in the Incident interface and render

The `Incident` interface uses `incident_date` and `location`. The DB table `incident_reports` has `occurred_at` and `location_text`. These fields are used in the render section — they will always be `undefined` with the wrong names.

**Fix the interface:**
```ts
interface Incident {
  id: string
  title: string
  severity: string | null
  status: string | null
  occurred_at: string | null    // was: incident_date
  location_text: string | null  // was: location
  description: string | null
  created_at: string
  photo_urls: string[] | null
}
```

**Fix all render references:**
- `incident.incident_date` → `incident.occurred_at` (appears in the Details card, ~line 178 condition and ~line 183 display)
- `incident.location` → `incident.location_text` (appears in the Details card, ~line 189 condition and ~line 194 display)

---

## FILE 4 — `src/app/dashboard/employee/jobs/new/page.tsx`

### Bug 13 — `employee_get_employees` RPC does not exist in DB

The assign-to employee dropdown calls a non-existent RPC. The dropdown will never populate.

**Fix:** Replace the `employee_get_employees` RPC call with a direct `employees` table query. Check how the existing call is structured and replace with:

```ts
const { data: employeesData } = await supabase
  .from('employees')
  .select('id, name, surname')
  .eq('company_id', member.companyId)
  .eq('is_active', true)
  .order('name')
setEmployees((employeesData ?? []) as Employee[])
```

Ensure the `Employee` interface matches: `{ id: string; name: string; surname: string }`.

Update the dropdown render to use `{emp.name} {emp.surname}` (not `emp.full_name` — employees table has `name` and `surname` columns, no `full_name`).

---

## FILE 5 — `src/app/dashboard/employee/messages/page.tsx`

All 5 message RPCs are called without `p_session_token`. The DB confirms all 5 RPCs exist.

### Bug 14 — `employee_get_message_threads_for_worker` missing `p_session_token`

Found in `loadThreads(cid, eid)` function.

**Current:**
```ts
const { data } = await (supabase.rpc as any)('employee_get_message_threads_for_worker', {
  p_company_id: cid,
  p_employee_id: eid,
})
```

**Fix:** `loadThreads` must accept a token param, or fetch session inside the function:
```ts
const { data: { session } } = await supabase.auth.getSession()
const { data } = await (supabase.rpc as any)('employee_get_message_threads_for_worker', {
  p_company_id:    cid,
  p_employee_id:   eid,
  p_session_token: session?.access_token ?? null,
})
```

Apply the same pattern in the `startDM` function where `employee_get_message_threads_for_worker` is called a second time to refresh the thread list (line ~235).

### Bug 15 — `employee_get_thread_messages_for_worker` missing `p_session_token`

Found in `selectThread()` and `reloadMessages()`.

**Fix both call sites:**
```ts
const { data: { session } } = await supabase.auth.getSession()
(supabase.rpc as any)('employee_get_thread_messages_for_worker', {
  p_company_id:    cid,
  p_thread_id:     thread.id,
  p_employee_id:   eid,
  p_limit:         200,
  p_session_token: session?.access_token ?? null,
})
```

### Bug 16 — `employee_mark_thread_read_for_worker` missing `p_session_token`

Found in `selectThread()` parallel call.

**Fix:**
```ts
const { data: { session } } = await supabase.auth.getSession()
(supabase.rpc as any)('employee_mark_thread_read_for_worker', {
  p_company_id:    cid,
  p_thread_id:     thread.id,
  p_employee_id:   eid,
  p_session_token: session?.access_token ?? null,
})
```

### Bug 17 — `employee_send_thread_message` missing `p_session_token`

Found in `sendMessage()`.

**Current:**
```ts
await (supabase.rpc as any)('employee_send_thread_message', {
  p_company_id:          companyId,
  p_thread_id:           selected.id,
  p_sender_employee_id:  employeeId,
  p_body:                body,
})
```

**Fix:**
```ts
const { data: { session } } = await supabase.auth.getSession()
await (supabase.rpc as any)('employee_send_thread_message', {
  p_company_id:          companyId,
  p_thread_id:           selected.id,
  p_sender_employee_id:  employeeId,
  p_body:                body,
  p_session_token:       session?.access_token ?? null,
})
```

### Bug 18 — `employee_get_or_create_direct_thread_peer` missing `p_session_token`

Found in `startDM()`.

**Current:**
```ts
const { data: result } = await (supabase.rpc as any)('employee_get_or_create_direct_thread_peer', {
  p_company_id:  companyId,
  p_creator_id:  employeeId,
  p_peer_id:     peer.id,
  p_title:       `${myName} & ${peerName}`,
})
```

**Fix:**
```ts
const { data: { session } } = await supabase.auth.getSession()
const { data: result } = await (supabase.rpc as any)('employee_get_or_create_direct_thread_peer', {
  p_company_id:    companyId,
  p_creator_id:    employeeId,
  p_peer_id:       peer.id,
  p_title:         `${myName} & ${peerName}`,
  p_session_token: session?.access_token ?? null,
})
```

---

## CHECKLIST

Engineer must confirm each item before marking this wave done:

### jobs/page.tsx
- [ ] `employee_get_jobs_for_employee` — `p_session_token` added

### jobs/[id]/page.tsx
- [ ] `employee_get_jobs_for_employee` — `p_session_token` added
- [ ] `incidents` table reference → `incident_reports`
- [ ] `getPublicUrl` in `uploadPhoto` → removed; `file_url` stores raw path
- [ ] `getPublicUrl` in `uploadDoc` → removed; `file_url` stores raw path
- [ ] All `job_documents` file_url renders use `createSignedUrl` before opening
- [ ] `get_or_create_job_thread` call wrapped in try/catch guard

### incidents/[id]/page.tsx
- [ ] `employee_get_incident_detail` call replaced with `incident_reports` direct query
- [ ] Session fetched once in `init()` and passed to `employee_get_incident_comments`
- [ ] Session passed to `employee_get_incident_status_history`
- [ ] `employee_add_incident_comment` — `p_session_token` added
- [ ] `employee_append_incident_photos` — `p_session_token` added
- [ ] `Incident` interface: `incident_date` → `occurred_at`, `location` → `location_text`
- [ ] Render: all `incident.incident_date` refs → `incident.occurred_at`
- [ ] Render: all `incident.location` refs → `incident.location_text`

### jobs/new/page.tsx
- [ ] `employee_get_employees` RPC call replaced with direct `employees` table query
- [ ] Employee dropdown renders `{emp.name} {emp.surname}` (not `full_name`)

### messages/page.tsx
- [ ] `employee_get_message_threads_for_worker` — `p_session_token` added in `loadThreads()`
- [ ] `employee_get_message_threads_for_worker` — `p_session_token` added in `startDM()` refresh call
- [ ] `employee_get_thread_messages_for_worker` — `p_session_token` added in `selectThread()`
- [ ] `employee_get_thread_messages_for_worker` — `p_session_token` added in `reloadMessages()`
- [ ] `employee_mark_thread_read_for_worker` — `p_session_token` added
- [ ] `employee_send_thread_message` — `p_session_token` added
- [ ] `employee_get_or_create_direct_thread_peer` — `p_session_token` added
