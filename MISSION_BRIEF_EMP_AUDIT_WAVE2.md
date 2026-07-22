# MISSION BRIEF — Employee Portal Audit Wave 2

**Scope:** 4 files — 11 bugs  
**Root cause:** Pattern A (wrong `getSession()` token) and Pattern B (direct table queries blocked by RLS) — same systemic issues as Wave 1  
**Clean files (no action needed):** `shifts/page.tsx`, `forms/page.tsx`, `forms/[id]/page.tsx`, `pa/new/page.tsx`, `pa/[id]/page.tsx`  

---

## File 1 — `src/app/dashboard/employee/jobs/new/page.tsx`

### BUG 1 — Pattern A: wrong token in `submit()` (line 94–95)

Code-auth users get an empty string token, `employee_create_job` auth fails.

```ts
// REPLACE (lines 94–95):
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token ?? ''

// WITH (reference tokRef set in init):
const token = tokRef.current
```

**Also add `tokRef` near the other state declarations:**
```ts
const tokRef = useRef<string | null>(null)
```

**And set it in `init()` after resolving the member (after line 53):**
```ts
tokRef.current = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
```

---

### BUG 2 — Pattern B: direct `employees` table query in `init()` (lines 56–63)

Code-auth users get null `auth.uid()` → RLS returns empty. Employee and manager picker lists are blank.

**Fix — replace the employees fetch with `employee_list_company_peers` RPC:**

```ts
// REPLACE (lines 55–72 — the try block in init):
try {
  const { data: employeesData, error: rpcErr } = await supabase
    .from('employees')
    .select('id, name, surname, position, access_level')
    .eq('company_id', member.companyId)
    .eq('is_active', true)
    .order('name')
  if (rpcErr) throw rpcErr
  const emps = (employeesData ?? []) as Employee[]
  setAllEmps(emps)

  const mgr = emps.find(e => LEADERSHIP_LEVELS.includes(e.access_level ?? ''))
  if (mgr) setManagerId(mgr.id)
} catch (e: unknown) {
  setError(e instanceof Error ? e.message : 'Failed to load employees.')
}

// WITH:
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: peersData, error: rpcErr } = await (supabase.rpc as any)('employee_list_company_peers', {
    p_company_id:    member.companyId,
    p_employee_id:   member.employeeId,
    p_session_token: tokRef.current,
  })
  if (rpcErr) throw rpcErr
  const emps = (peersData as Employee[]) ?? []
  setAllEmps(emps)

  const mgr = emps.find(e => LEADERSHIP_LEVELS.includes(e.access_level ?? ''))
  if (mgr) setManagerId(mgr.id)
} catch (e: unknown) {
  setError(e instanceof Error ? e.message : 'Failed to load employees.')
}
```

**Note:** `employee_list_company_peers` returns other employees in the same company. The current employee is excluded from peer results — this is correct behaviour for "Notify Manager" and "Team Members" pickers, since an employee shouldn't assign themselves as manager or add themselves to the team list.

---

## File 2 — `src/app/dashboard/employee/incidents/new/page.tsx`

### BUG 3 — Pattern A: wrong token in `init()` (lines 74–75)

Wrong token passed to `employee_get_jobs_for_employee` → job picker empty for code-auth.

**Add `tokRef` near `empIdRef` and `compIdRef`:**
```ts
const tokRef = useRef<string | null>(null)
```

**Replace lines 74–75:**
```ts
// REPLACE:
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? null

// WITH:
const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
tokRef.current = tok
```

---

### BUG 4 — Pattern B: direct `employees` table query for managers list (lines 78–82)

Code-auth users get empty managers picker.

**Replace the `managersRes` fetch inside the `Promise.all`:**
```ts
// REPLACE:
supabase.from('employees')
  .select('id, name, surname, position')
  .eq('company_id', member.companyId)
  .in('access_level', ['manager', 'hr', 'owner'])
  .order('name'),

// WITH:
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(supabase.rpc as any)('employee_list_company_peers', {
  p_company_id:    member.companyId,
  p_employee_id:   member.employeeId,
  p_session_token: tok,
}),
```

**Also update `setManagers` to filter client-side (the RPC returns all peers):**
```ts
// REPLACE:
setManagers((managersRes.data as Manager[]) ?? [])

// WITH:
const MGMT = ['manager', 'hr', 'hr_admin', 'owner', 'admin']
const allPeers = (managersRes.data as Manager[]) ?? []
setManagers(allPeers.filter(e => MGMT.includes((e as unknown as { access_level: string }).access_level ?? '')))
```

---

### BUG 5 — Pattern A: wrong token in `submit()` (lines 115–116)

Null token → `employee_insert_incident` auth fails for code-auth.

```ts
// REPLACE (lines 115–116):
const { data: { session } } = await supabase.auth.getSession()

// WITH (use stored tok ref):
// (remove the getSession() call entirely — use tokRef.current below)
```

**And replace `p_session_token: session?.access_token ?? null` (line 162):**
```ts
// REPLACE:
p_session_token: session?.access_token ?? null,

// WITH:
p_session_token: tokRef.current,
```

---

### BUG 6 — Pattern B: direct `employees` query for `reported_by_name` in `submit()` (lines 118–121)

Code-auth users: RLS-blocked → `empData` is null → `reported_by_name` is always null.

**Replace lines 118–121 with a code-auth-aware name lookup:**
```ts
// REPLACE:
const { data: empData } = await supabase
  .from('employees')
  .select('name, surname')
  .eq('id', empId)
  .single()

// WITH:
let empData: { name: string; surname: string } | null = null
if (member.sessionToken) {
  // code-auth: name is in localStorage session
  try {
    const cs = JSON.parse(localStorage.getItem('kf_cs') ?? '{}')
    if (cs?.employee?.name && cs?.employee?.surname) {
      empData = { name: cs.employee.name, surname: cs.employee.surname }
    }
  } catch { /* leave null */ }
} else {
  // JWT: direct table query works (auth.uid() is set)
  const { data } = await supabase
    .from('employees')
    .select('name, surname')
    .eq('id', empId)
    .single()
  empData = data
}
```

**Note:** `member` is in scope in `init()` but not in `submit()`. Store code-auth status in a ref. Add next to `tokRef`:
```ts
const isCodeAuthRef = useRef<boolean>(false)
```

In `init()`, after setting `tokRef.current`:
```ts
isCodeAuthRef.current = member.sessionToken !== null
```

Then use `isCodeAuthRef.current` instead of `member.sessionToken` in `submit()`:
```ts
if (isCodeAuthRef.current) {
  // code-auth path
} else {
  // JWT path
}
```

---

## File 3 — `src/app/dashboard/employee/contractor/page.tsx`

### BUG 7 — Pattern A: wrong token (lines 188–189)

`employee_get_linked_contractors` gets null token for code-auth → contractor profile page shows "No contractor profile linked" for all code-auth users even if they are linked.

```ts
// REPLACE (lines 188–189):
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token ?? ''

// WITH:
const token = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
```

---

## File 4 — `src/app/dashboard/employee/documents/page.tsx`

### BUG 8 — Pattern A: wrong token in `init()` (lines 67–68)

`employee_get_documents` gets null token for code-auth → documents list empty.

**Add `tokRef` near other state:**
```ts
const tokRef = useRef<string | null>(null)
```

**Replace lines 67–69:**
```ts
// REPLACE:
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token ?? null
setTok(token)

// WITH:
const token = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
setTok(token)
tokRef.current = token
```

---

### BUG 9 — Pattern B: direct `companies` query for company name (lines 79–84)

RLS-blocked for code-auth → company name missing from document listing.

**Replace lines 79–84 with a code-auth-aware lookup:**
```ts
// REPLACE:
const { data: companyRow } = await supabase
  .from('companies')
  .select('name')
  .eq('id', member.companyId)
  .maybeSingle()
if (companyRow?.name) setCompanyName(companyRow.name)

// WITH:
if (member.sessionToken) {
  // code-auth: company name is in localStorage session
  try {
    const cs = JSON.parse(localStorage.getItem('kf_cs') ?? '{}')
    if (cs?.company?.name) setCompanyName(cs.company.name)
  } catch { /* non-critical */ }
} else {
  // JWT: direct query works
  const { data: companyRow } = await supabase
    .from('companies')
    .select('name')
    .eq('id', member.companyId)
    .maybeSingle()
  if (companyRow?.name) setCompanyName(companyRow.name)
}
```

---

### BUG 10 — Pattern A: wrong token in `submitUpload()` (line 129)

`employee_submit_document` gets null token for code-auth → upload metadata save fails even though the file uploaded successfully.

```ts
// REPLACE (line 129 inside submitUpload):
const { data: { session } } = await supabase.auth.getSession()

// AND REPLACE (line 143):
p_session_token: session?.access_token ?? null,

// WITH (remove the getSession call, use tokRef):
p_session_token: tokRef.current,
```

---

### BUG 11 — Pattern A: wrong token in `submitReplace()` (line 175)

Same issue — `employee_update_document` fails for code-auth.

```ts
// REPLACE (line 175 inside submitReplace):
const { data: { session } } = await supabase.auth.getSession()

// AND REPLACE (line 191):
p_session_token: session?.access_token ?? null,

// WITH:
p_session_token: tokRef.current,
```

---

## Summary

| File | Bug | Fix |
|---|---|---|
| `jobs/new/page.tsx` | Pattern A in `submit()` | Add `tokRef`, set in `init()`, use in `submit()` |
| `jobs/new/page.tsx` | `employees` table in `init()` | → `employee_list_company_peers` RPC |
| `incidents/new/page.tsx` | Pattern A in `init()` | Add `tokRef`, use correct pattern |
| `incidents/new/page.tsx` | `employees` table for managers | → `employee_list_company_peers` + client-side filter |
| `incidents/new/page.tsx` | Pattern A in `submit()` | Use `tokRef.current` |
| `incidents/new/page.tsx` | `employees` query for `reported_by_name` | Code-auth: read from `kf_cs` localStorage; JWT: direct query |
| `contractor/page.tsx` | Pattern A | Use correct pattern inline |
| `documents/page.tsx` | Pattern A in `init()` | Add `tokRef`, set with correct pattern |
| `documents/page.tsx` | `companies` table for name | Code-auth: read from `kf_cs` localStorage; JWT: direct query |
| `documents/page.tsx` | Pattern A in `submitUpload()` | Use `tokRef.current` |
| `documents/page.tsx` | Pattern A in `submitReplace()` | Use `tokRef.current` |
