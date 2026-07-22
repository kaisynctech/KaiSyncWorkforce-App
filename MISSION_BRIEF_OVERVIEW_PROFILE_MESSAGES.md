# MISSION BRIEF — Overview, My Profile, Messages
**Project:** kaisync-web (Next.js)  
**Prepared by:** KEES Architect  
**Date:** 2026-07-16  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Status:** READY FOR ENGINEERING EXECUTION

---

## EXECUTIVE SUMMARY

Three modules audited. Overview is nearly clean — one wrong RPC name for the "Mark Absent" button. My Profile and Messages are **not built at all** — they exist in the MAUI app but have no corresponding pages or sidebar entries in the web app. Both have full backend support (RPCs, tables, RLS) ready to use. This brief specifies exactly what to build.

---

## MODULE 1: OVERVIEW
**File:** `src/app/dashboard/overview/page.tsx`

### Status: MOSTLY CLEAN ✅

The overview was rewritten in the previous session and correctly uses:
- `time_punches` with `type` / `date_time` columns ✅
- Proper paired in/out session calculation for clock elapsed time ✅
- All 6 KPI tiles scoped to `company_id` ✅
- Clock In / Clock Out inserting directly into `time_punches` ✅

### One Bug

**BUG-OV-1 — `hr_mark_employee_absent_today` RPC does not exist**  
Line 168: `supabase.rpc('hr_mark_employee_absent_today', { p_company_id, p_employee_id })`  
This RPC is not in the database. The correct RPC is `employee_report_absence`.

**Correct RPC signature:**
```
employee_report_absence(
  p_company_id uuid,
  p_employee_id uuid,
  p_date date,
  p_reason text,
  p_note text DEFAULT NULL
)
```

**Fix — replace `markAbsent()` function:**
```typescript
async function markAbsent(empId: string) {
  setMarkAbsentLoading(empId)
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]   // 'YYYY-MM-DD'
  const { error: err } = await supabase.rpc('employee_report_absence', {
    p_company_id: companyId,
    p_employee_id: empId,
    p_date: today,
    p_reason: 'absent',         // required field — use 'absent' as default
    p_note: null,
  })
  if (err) console.error('mark absent:', err.message)
  setMarkAbsentLoading(null)
  await load()
}
```

---

## MODULE 2: MY PROFILE
**File to create:** `src/app/dashboard/profile/page.tsx`  
**Sidebar entry to add:** `{ label: 'My Profile', href: '/dashboard/profile', icon: 'person' }`

### Status: PAGE DOES NOT EXIST — BUILD REQUIRED

### What My Profile must show (matching MAUI app)

The page is the logged-in HR/owner/manager's own employee record. It has two sections:

**Section A — Personal Info (read-only display + edit)**
- Full name (name + surname)
- Position / role
- Access level badge
- Employment type
- Email (display only — cannot be changed via this form)
- Phone (editable)
- ID Number (editable)

**Section B — Banking Details (editable)**
- Bank Name
- Account Number
- Branch Code

### Backend

**Read:** Direct query to `employees` table
```typescript
const { data } = await supabase
  .from('employees')
  .select('*')
  .eq('id', member.employeeId)
  .eq('company_id', member.companyId)
  .maybeSingle()
```

**Save:** Use `employee_update_profile` RPC (confirmed in live DB)
```
employee_update_profile(
  p_employee_id uuid,
  p_company_id uuid,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_id_number text DEFAULT NULL,
  p_bank_account text DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_bank_branch_code text DEFAULT NULL
)
```

Only pass fields the user changed — pass `null` for fields left unchanged (the RPC treats null as "no change").

### Sidebar placement

Add `My Profile` **after** Overview in `NAV_ITEMS` inside `src/components/Sidebar.tsx`:
```typescript
{ label: 'Overview',    href: '/dashboard/overview', icon: 'home'   },
{ label: 'My Profile',  href: '/dashboard/profile',  icon: 'person' },  // ADD
```

### Page structure (spec for engineer)

```
┌─────────────────────────────────────────┐
│  ← My Profile                           │  ← header
├─────────────────────────────────────────┤
│  [Avatar initials circle]               │
│  Name Surname                           │
│  Position  •  [Access Level badge]      │
├─────────────────────────────────────────┤
│  PERSONAL INFORMATION                   │  ← section label
│  First Name    [input]                  │
│  Last Name     [input]                  │
│  Phone         [input]                  │
│  ID Number     [input]                  │
│  Email         [read-only text]         │
│  Employment    [read-only text]         │
├─────────────────────────────────────────┤
│  BANKING DETAILS                        │  ← section label
│  Bank Name     [input]                  │
│  Account No    [input]                  │
│  Branch Code   [input]                  │
├─────────────────────────────────────────┤
│  [Save Changes]                         │  ← sticky footer button
└─────────────────────────────────────────┘
```

### Key implementation notes
- Use `resolveCurrentMember(supabase)` to get `employeeId` and `companyId`
- Show a success toast/banner after save — "Profile updated"
- Banking section: add a note "Changes to banking details are logged for security"
- The `employees` table has `bank_details_updated_at` and `bank_details_updated_by` columns — the RPC handles these automatically
- Email field is derived from `employees.email` — display only, no edit (email changes require admin action)

---

## MODULE 3: MESSAGES
**File to create:** `src/app/dashboard/messages/page.tsx`  
**Sidebar entry to add:** `{ label: 'Messages', href: '/dashboard/messages', icon: 'chat' }`

### Status: PAGE DOES NOT EXIST — BUILD REQUIRED

### What Messages must show (matching MAUI app)

The messages system is a thread-based inbox. HR/managers can see all threads they are part of and message employees directly. The page has two panels: thread list on the left, conversation on the right (or stacked on narrow screens).

### Database schema (confirmed live)

**`message_threads`**
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `company_id` | uuid | |
| `subject` | text | thread title / name |
| `participant_ids` | uuid[] | employee IDs in this thread |
| `last_message_at` | timestamptz | for sorting |
| `last_message_preview` | text | preview text |
| `is_archived` | boolean | |
| `type_raw` | text | e.g. `'direct'`, `'job'`, `'company_feed'` |

**`app_messages`**
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `company_id` | uuid | |
| `thread_id` | uuid | FK → message_threads |
| `sender_id` | uuid | sender employee id |
| `sender_display_name` | text | denormalised name |
| `body` | text | message text |
| `read_by_ids` | uuid[] | employee IDs who have read |
| `created_at` | timestamptz | |

### RPCs available (all confirmed in live DB)

| RPC | Args | Purpose |
|-----|------|---------|
| `employee_get_message_threads_for_worker` | `p_company_id, p_employee_id` | Get all threads for this employee |
| `employee_get_thread_messages_for_worker` | `p_company_id, p_thread_id, p_employee_id, p_limit=200` | Get messages in a thread |
| `employee_send_thread_message` | `p_company_id, p_thread_id, p_sender_employee_id, p_body` | Send a message |
| `employee_mark_thread_read_for_worker` | `p_company_id, p_thread_id, p_employee_id` | Mark thread as read |
| `employee_get_or_create_direct_thread_peer` | `p_company_id, p_creator_id, p_peer_id, p_title` | Start a DM with an employee |

### Page structure (spec for engineer)

```
┌──────────────────────────────────────────────────────┐
│  Messages                    [+ New Message]          │
├────────────────┬─────────────────────────────────────┤
│ Thread list    │  Thread header: subject + members   │
│                │─────────────────────────────────────│
│ [Thread A]  •  │  [msg] Name  11:30am                │
│ preview text   │  Message body text                  │
│                │                                     │
│ [Thread B]     │  [msg] You  11:35am                 │
│ preview text   │  Reply text                         │
│                │                                     │
│ [Thread C]     │─────────────────────────────────────│
│ preview text   │  [text input]        [Send]         │
└────────────────┴─────────────────────────────────────┘
```

### Implementation spec

**Thread list (left panel)**
```typescript
// Load threads
const { data } = await supabase.rpc('employee_get_message_threads_for_worker', {
  p_company_id: member.companyId,
  p_employee_id: member.employeeId,
})
// Sort by last_message_at descending
// Show unread indicator: thread.read_by_ids does not include member.employeeId
// (check app_messages — if any message in thread has read_by_ids NOT containing member.employeeId)
```

**Conversation (right panel)**
```typescript
// Load messages when thread selected
const { data } = await supabase.rpc('employee_get_thread_messages_for_worker', {
  p_company_id: member.companyId,
  p_thread_id: selectedThreadId,
  p_employee_id: member.employeeId,
  p_limit: 200,
})
// Mark as read when thread opened
await supabase.rpc('employee_mark_thread_read_for_worker', {
  p_company_id: member.companyId,
  p_thread_id: selectedThreadId,
  p_employee_id: member.employeeId,
})
```

**Send message**
```typescript
await supabase.rpc('employee_send_thread_message', {
  p_company_id: member.companyId,
  p_thread_id: selectedThreadId,
  p_sender_employee_id: member.employeeId,
  p_body: messageText.trim(),
})
// After send: reload thread messages + update thread list preview
```

**New Message (start DM with employee)**
```typescript
// Show employee picker modal
// On select:
const { data: thread } = await supabase.rpc('employee_get_or_create_direct_thread_peer', {
  p_company_id: member.companyId,
  p_creator_id: member.employeeId,
  p_peer_id: selectedEmployeeId,
  p_title: `${myName} & ${peerName}`,
})
// Navigate to thread.id
```

**Realtime subscription**
```typescript
supabase
  .channel('messages-realtime')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'app_messages',
    filter: `company_id=eq.${member.companyId}`,
  }, () => {
    reloadCurrentThread()
    reloadThreadList()
  })
  .subscribe()
```

### Sidebar placement

Add `Messages` **after** `My Profile` in `NAV_ITEMS`:
```typescript
{ label: 'My Profile',  href: '/dashboard/profile',  icon: 'person' },
{ label: 'Messages',    href: '/dashboard/messages',  icon: 'chat'   },  // ADD
```

The notification badge (unread count) can be added later — for now just show the page.

---

## SUMMARY TABLE

| Module | File | Bug/Task | Severity | Description |
|--------|------|----------|----------|-------------|
| Overview | `overview/page.tsx` | OV-1 | 🟠 HIGH | `hr_mark_employee_absent_today` RPC doesn't exist — use `employee_report_absence` |
| My Profile | `profile/page.tsx` | BUILD | 🔴 MISSING | Page does not exist — full build required |
| My Profile | `Sidebar.tsx` | BUILD | 🔴 MISSING | Add `My Profile` nav item pointing to `/dashboard/profile` |
| Messages | `messages/page.tsx` | BUILD | 🔴 MISSING | Page does not exist — full build required |
| Messages | `Sidebar.tsx` | BUILD | 🔴 MISSING | Add `Messages` nav item pointing to `/dashboard/messages` |

---

## EXECUTION ORDER FOR ENGINEER

1. **Fix OV-1** — replace `markAbsent()` in `overview/page.tsx`. One function swap, 5 minutes.

2. **Build My Profile page** — `src/app/dashboard/profile/page.tsx`. Use `resolveCurrentMember`, query employees, display/edit via `employee_update_profile` RPC. Straightforward form page.

3. **Build Messages page** — `src/app/dashboard/messages/page.tsx`. Two-panel layout, all RPCs are ready. The most complex build in this brief but fully backed by existing DB RPCs.

4. **Update Sidebar** — add both new nav items to `NAV_ITEMS` in `src/components/Sidebar.tsx`.

---

## NOTES FOR KEES ARCHITECT

- No DB migrations required. All tables and RPCs are confirmed present in the live database.
- `employee_update_profile` RPC does not include `email` or `position` — those fields must be updated directly on the `employees` table if HR wants to change them (separate admin flow, not this profile page).
- The Messages realtime subscription listens on `app_messages` — if RLS blocks the direct table subscription for web users, fall back to polling (`setInterval` every 10s).
- Thread `type_raw` values seen in production include `'direct'` and `'job'` and `'company_feed'` — the Messages page should show all thread types but could label them differently (e.g. show job title for job threads).
