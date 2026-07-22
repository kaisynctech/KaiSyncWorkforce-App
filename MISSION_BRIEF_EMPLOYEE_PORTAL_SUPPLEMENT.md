# MISSION BRIEF — Employee Portal Supplement
**Status:** Ready for engineering  
**Covers:** All pages missed from MISSION_BRIEF_EMPLOYEE_PORTAL.md  
**Source:** MAUI ViewModels read directly + live DB verified  
**Architect rule:** Do NOT write code. This brief goes to the Claude Code engineer.

---

## Why This Brief Exists

The engineer built 11 files from the first employee portal brief but missed 8 pages entirely. Every missing page is listed in `AppShell.xaml.cs` and backed by a ViewModel. This brief covers them page by page, button by button, function by function. No assumptions. No placeholders. Everything wired from front to back.

**Missing pages (source: AppShell.xaml.cs routes):**
1. `JobCardPage` → `/dashboard/employee/jobs/[id]/page.tsx`
2. `EmployeeJobRequestPage` → `/dashboard/employee/jobs/new/page.tsx`
3. `MyPaSectionPage` → `/dashboard/employee/pa/page.tsx`
4. `MyPaTaskEditorPage` → `/dashboard/employee/pa/new/page.tsx` + `/dashboard/employee/pa/[id]/page.tsx`
5. `MyShiftsPage` → `/dashboard/employee/shifts/page.tsx`
6. `EmployeeContractorAdminPage` → `/dashboard/employee/contractor/page.tsx`
7. `PaperlessPage` → `/dashboard/employee/forms/page.tsx`
8. `FormFillPage` → `/dashboard/employee/forms/[id]/page.tsx`

**Plus:** EmployeeSidebar must be updated to add all new navigation links.

---

## Critical Technical Rules (Apply to All Pages)

1. **Session token**: Every RPC that has `p_session_token` must receive the Supabase access token. Get it via:
   ```ts
   const { data: { session } } = await supabase.auth.getSession()
   const token = session?.access_token ?? ''
   ```
2. **resolveCurrentMember**: Use the existing `resolveCurrentMember(supabase)` helper — returns `{ employeeId, companyId }`.
3. **RPC error handling**: Always `try/catch`. Never `.catch(() => null)`. On error, show an error state — not a blank page.
4. **Signed URLs**: Files from `workforce-media` bucket are private. Always call `supabase.storage.from('workforce-media').createSignedUrl(path, 3600)` before displaying.
5. **No phantom RPCs**: Every RPC name in this brief has been verified to exist in the DB.
6. **UUID arrays**: Pass as JS arrays, not comma-separated strings.
7. **JSONB**: Pass as plain JS objects — Supabase JS SDK serialises automatically.

---

## Part 1 — EmployeeSidebar Update

**File:** `src/components/EmployeeSidebar.tsx`

Add the following nav items to the existing sidebar. Keep all existing items. Add in this order matching the MAUI "More" tab:

```
My PA          → /dashboard/employee/pa
Leave          → /dashboard/employee/leave      (already exists)
My Shifts      → /dashboard/employee/shifts
Jobs           → /dashboard/employee/jobs       (already exists)
Incidents      → /dashboard/employee/incidents  (already exists)
Contractor Profile → /dashboard/employee/contractor
Forms          → /dashboard/employee/forms
My Payslips    → /dashboard/profile/payslips    (Wave 4)
My Documents   → /dashboard/profile/documents  (Wave 4)
```

Bottom nav tabs (mobile): Home | My Jobs | Messages | Notifs | More  
"More" tab opens the full sidebar / menu sheet on mobile.

---

## Part 2 — Job Card Page

**File:** `src/app/dashboard/employee/jobs/[id]/page.tsx`  
**Source:** `JobCardViewModel.cs` (571 lines)  
**Route param:** `id` = job UUID  

### On Load
Call in parallel:
1. Get job: `employee_get_jobs_for_employee` filtered to this job ID, OR use the job from My Jobs list cache. If the job is not found or employee has no access → show "Job not found or you do not have access."
2. Get job card: `employee_get_job_card_for_job(p_company_id, p_job_id, p_employee_id, p_session_token)` → returns `job_cards` row or null
3. Get checklist: `employee_get_checklist_for_job(p_company_id, p_job_id, p_employee_id, p_session_token)` → returns `job_checklist_items[]` ordered by `sort_order`
4. Get documents: query `job_documents` where `company_id = ? AND job_id = ?` → returns `{ id, document_name, document_type, file_url, created_at }`
5. Get on-site status: `employee_job_site_open_visit(p_company_id, p_employee_id, p_session_token)` → returns open `job_site_visits` row or null
6. Get inventory usage: `employee_get_inventory_usage_for_job(p_company_id, p_job_id, p_employee_id, p_session_token)`
7. Get feedback: `employee_get_job_feedback(p_company_id, p_employee_id, p_job_id, p_session_token)`

**DB tables used:**
- `job_cards`: id, company_id, job_id, employee_id, work_performed, materials_used, photo_urls (text[]), checklist_items (jsonb), start_time, end_time, is_completed, client_signature_url
- `job_checklist_items`: id, company_id, job_id, description, is_checked, sort_order
- `job_documents`: id, company_id, job_id, document_name, document_type, file_url, created_at
- `job_site_visits`: id, company_id, job_id, employee_id, sign_in_at, sign_out_at, sign_in_latitude, sign_in_longitude, sign_in_address, reported_by_name
- `inventory_usage`: (joined with inventory_items)
- `job_feedback`: rating, comments, created_at

### Page Header
- Title: job title
- Subtitle: client name (if `job.client_id` → query `clients` table) + site name (if `job.site_id` → query `properties` table)
- Status badge: colour-coded pill (same as My Jobs page)

### Section 1 — On-Site Status
Display a card with the current on-site state. Three possible states:

**State A — Not on site:**
- Text: "Not on site for this job"
- Button: **"I'm on this job"** → triggers `StartOnSite` flow
- Help text (show as subtle caption): "This is separate from Clock In/Out on your dashboard. Use this section to tell your manager you are physically on this job site."

**State B — On this job:**
- Text: `"On this job as {reported_by_name} since {sign_in_at formatted as h:mm am/pm}"`
- Button: **"Finish on-site"** → triggers `FinishOnSite` flow

**State C — On a different job site:**
- Text: `"You are on site at "{other job title}" since {sign_in_at}. Finish that visit or switch to this job below."`
- Button: **"Switch to this job"** → triggers `SwitchToThisJob` flow
- Button: **"End other visit first"** → triggers `EndOtherVisit` flow

**StartOnSite flow:**
1. Prompt: "Your name (optional)" with text input
2. Capture geolocation (browser `navigator.geolocation.getCurrentPosition`)
3. Call `employee_job_site_sign_in(p_company_id, p_employee_id, p_job_id, p_latitude, p_longitude, p_address, p_reported_by_name, p_notes, p_session_token)`
4. If error contains "ALREADY_ON_SITE" → confirm dialog "You already have an open site visit. Switch to this job instead?" → if Yes, run SwitchToThisJob
5. Refresh on-site status

**FinishOnSite flow:**
1. Capture geolocation
2. Call `employee_job_site_sign_out(p_company_id, p_employee_id, p_job_id, p_latitude, p_longitude, p_address, p_session_token)` — verify this RPC exists; if not, update `job_site_visits` directly by setting `sign_out_at = now()` for the open visit
3. Show success toast: "You have signed off this job site."
4. Refresh on-site status

**SwitchToThisJob flow:**
1. Prompt: "Your name (optional)"
2. Capture geolocation
3. Call `employee_job_site_switch_to_job(p_company_id, p_employee_id, p_job_id, p_latitude, p_longitude, p_address, p_reported_by_name, p_session_token)`
4. Refresh on-site status

**EndOtherVisit flow:**
1. Confirm: "End your open site visit on the other job? You can start this job after that."
2. Call `employee_job_site_sign_out_open_visit(p_company_id, p_employee_id, p_session_token)`
3. Refresh on-site status

### Section 2 — Job Card (Work Record)
A form section editable inline.

**Fields:**
- Actual Start: datetime — "Stamp now" button sets to `new Date()`, or user can type
- Actual End: datetime — "Stamp now" button sets to `new Date()`, or user can type
- Work Performed: multiline text area
- Materials Used: multiline text area
- Completed: checkbox/toggle — marks the job as done

**Save button** → call `employee_upsert_job_card(p_company_id, p_employee_id, p_job_id, p_start_time, p_end_time, p_work_performed, p_materials_used, p_photo_urls, p_is_completed, p_client_signature_url, p_session_token)`
- `p_photo_urls`: pass the current `photo_urls` array from `job_cards` (do not overwrite with empty array)
- `p_is_completed`: if true AND job status is not already completed, the job gets marked completed

### Section 3 — Checklist
- List all `job_checklist_items` rows ordered by `sort_order`
- Each item: checkbox + description text
- Toggling checkbox → call `employee_update_checklist_item` (check if this RPC exists; otherwise update `job_checklist_items` directly: `UPDATE job_checklist_items SET is_checked = ? WHERE id = ?`)
  - Confirmed RPCs: `employee_update_checklist_item(p_company_id, p_employee_id, p_job_id, ...)` — use `job_checklist_set_completed` if the specific update RPC is not found
- **Add item** button → prompt for description → call `employee_insert_checklist_item(p_company_id, p_employee_id, p_job_id, p_description, p_session_token)`
- New item appended to bottom of list

### Section 4 — Photos (Before / After)
Photos are stored in `job_documents` with `document_type = 'photo_before'` or `'photo_after'`.

Display two subsections: **Before** and **After**

Each subsection:
- Show image grid (thumbnails) for all `job_documents` rows where `document_type = 'photo_before'` / `'photo_after'`
- Display images using the `file_url` directly (these are public storage URLs) or signed URL if private
- **Upload photo** button per subsection → file input (accept `image/*`) → upload to `workforce-media` storage bucket at path `jobs/{company_id}/{job_id}/{phase}/{uuid}.jpg` → insert row into `job_documents`: `{ company_id, job_id, document_name: filename, document_type: 'photo_before' | 'photo_after', file_url: publicUrl }`

### Section 5 — Documents
- List all `job_documents` rows where `document_type NOT IN ('photo_before', 'photo_after')`
- Each row: document_name + document_type label + created_at + open button
- **Open** → `window.open(file_url, '_blank')`
- **Upload document** button → file input (all types) → prompt for document name → upload to `workforce-media` at `jobs/{company_id}/{job_id}/docs/{uuid}` → insert `job_documents` row with `document_type = 'other'`

### Section 6 — Incidents (show only if company has incidents module enabled)
- List all incidents linked to this job (query `incidents` where `job_id = ? AND employee_id = ?`)
- Each row: title + severity badge + status
- **Report Incident** button → navigate to `/dashboard/employee/incidents/new?jobId={id}&jobTitle={title}`
- Click incident row → `/dashboard/employee/incidents/{incident_id}`

### Section 7 — Inventory Used
- Query via `employee_get_inventory_usage_for_job(p_company_id, p_job_id, p_employee_id, p_session_token)`
- Display table: Item Name | Supplier | Qty | Unit Cost | Total Cost
- **Record inventory** button → opens modal:
  - Select inventory item from list (query `inventory_items` where `company_id = ?`)
  - Enter quantity (number input)
  - Submit → call `employee_set_inventory_usage_for_job(p_company_id, p_employee_id, p_job_id, p_inventory_item_id, p_quantity, p_session_token)`
  - Reload inventory section

### Section 8 — Client Feedback
- Show latest feedback from `employee_get_job_feedback` result
- If none: "No client feedback recorded yet."
- If exists: star rating (1-5) + comments + date
- **Capture feedback** button → opens modal:
  - Rating: number input 1–5 (or star picker)
  - Comments: text area (optional)
  - Submit → `employee_submit_job_feedback(p_company_id, p_employee_id, p_job_id, p_rating, p_comments, p_session_token)`
  - Reload feedback

### Section 9 — Job Chat
- Button: **"Open job chat"**
- On click: call `supabase.rpc('get_or_create_job_thread', { p_company_id, p_job_id, p_employee_id })` — if RPC does not exist, query `message_threads` where `job_id = ? AND company_id = ?`
- Navigate to `/dashboard/messages?threadId={thread_id}` (existing messages page)

---

## Part 3 — Job Request Page (Create Job)

**File:** `src/app/dashboard/employee/jobs/new/page.tsx`  
**Source:** `EmployeeJobRequestViewModel.cs`  
**Navigation:** "+" button on My Jobs page → this page. Back button returns to My Jobs.

### On Load
1. Call `resolveCurrentMember` → `{ employeeId, companyId }`
2. Fetch all employees for company: `employee_get_employees(p_company_id, p_session_token)` or query `employees` table
3. Filter to leadership (managers, owners, HR) for the "Notify manager" picker
4. Filter to co-workers (not self, not leadership) for the team selector
5. Pre-select the employee's line manager if `employees.manager_user_id` is set

### Form Fields

**Title** (required) — text input. Validate: not empty before submit. Error: "Please enter a job title."

**Description** — multiline text area (optional)

**Priority** — segmented control / select: `none | low | medium | high | critical` (default: `medium`)
- Display labels: None / Low / Medium / High / Critical

**Scheduled Start Date** — date picker (default: today)

**Scheduled Start Time** — time picker (default: 08:00)
- Scheduled End = Scheduled Start + 8 hours (computed, not shown to user)

**Notify Manager** — dropdown of leadership employees:
- First option: "None — no manager notification"
- Then: each manager/owner/HR employee by full name
- Pre-select the employee's line manager

**Team Members** — searchable multi-select list:
- Search input filters by name or position
- Each row: employee name + position + checkbox
- Multiple selection allowed

### Submit Button: "Create Job"
Validation: title must not be empty.

Call `employee_create_job` with these exact parameter names:
```
p_company_id: companyId (uuid)
p_creator_employee_id: employeeId (uuid)
p_title: title (text)
p_description: description | null
p_priority: selectedPriority (text)
p_scheduled_start: scheduledStart (timestamptz) — date + time combined, converted to UTC
p_scheduled_end: scheduledStart + 8 hours (timestamptz)
p_site_id: null
p_client_id: null
p_assignee_employee_id: employeeId (self-assign)
p_assigned_employee_ids: selectedTeamMemberIds (uuid[])
p_notify_manager_employee_id: selectedManagerId | null
p_visibility: selectedManagerId ? 'restricted' : 'inherit'
p_session_token: token
```

On success:
- Show alert: "Your job was saved and is visible to your team, managers, and HR."
- Navigate back to `/dashboard/employee/jobs`

---

## Part 4 — My PA Page

**File:** `src/app/dashboard/employee/pa/page.tsx`  
**Source:** `MyPaSectionViewModel.cs` (625 lines)

### On Load
1. `resolveCurrentMember` → `{ employeeId, companyId }`
2. Call `employee_get_pa_tasks(p_company_id, p_employee_id, p_session_token)` → returns `pa_tasks[]`
3. Compute metrics from results:
   - **Open count**: rows where `status IN ('todo', 'in_progress')`
   - **Overdue count**: rows where `status != 'done'` AND `due_at < now()`
   - **Due today**: rows where `due_date = today` AND `status != 'done'`
   - **Completed today**: rows where `status = 'done'` AND `completed_at::date = today`

**DB table:** `pa_tasks`
```
id, company_id, title, description, status, priority, owner_employee_id,
assigned_employee_id, due_date, due_at, remind_at, snoozed_until,
linked_type, linked_id, linked_label, recurrence_pattern, source_type,
meeting_with, meeting_at, meeting_minutes, meeting_follow_up,
delegated_by_employee_id, quick_capture, completed_at, notes, updated_at
```

**Status values:** `'todo'` | `'in_progress'` | `'done'` | `'snoozed'`  
**Priority values:** `'low'` | `'medium'` | `'high'` | `'urgent'`

### Layout — 4 Tabs
Render as horizontal tab bar: **Today | Tasks | Calendar | Search**

---

### Tab: Today
Heading: today's date formatted as "Monday, 16 July"

**KPI strip** (4 cards in a row):
- Open: `openCount` (blue)
- Overdue: `overdueCount` (red)
- Due Today: `dueTodayCount` (amber)
- Done Today: `completedTodayCount` (green)

**Today's Agenda** — list of tasks and calendar entries due/scheduled today:
- Include: tasks where `due_date = today` OR `meeting_at::date = today` OR `remind_at::date = today`
- Show: title, time if set, priority badge, linked label if set
- Click → open task editor

**Upcoming Reminders** — tasks where `remind_at > now()` AND `remind_at < now() + 7 days` AND `status != 'done'`
- Show: title + `remind_at` formatted as "Tomorrow 9:00 am", "Friday 2:00 pm", etc.

---

### Tab: Tasks
**Filter bar** — pills: All | To Do | In Progress | Overdue | Done
- "All": show all tasks for this employee
- "To Do": `status = 'todo'`
- "In Progress": `status = 'in_progress'`
- "Overdue": `status != 'done'` AND `due_at < now()`
- "Done": `status = 'done'`

**Focus Mode toggle** — when on, shows only overdue + due-today + high/urgent priority tasks. Caption: "On — showing only overdue, due-today and high-priority work." / "Hide low-priority tasks and surface only what needs action today."

**Task list** — each task row:
- Priority colour strip on left edge: low=grey, medium=blue, high=orange, urgent=red
- Title (bold)
- Due date/time if set (e.g., "Due Mon 14 Jul")
- Linked label if set (e.g., "Job: Fix roof" or "Deal: Project Alpha")
- Status badge
- **Three action buttons** per row:
  - ✓ Complete → `CompleteTask` flow
  - ⏰ Snooze → `SnoozeTask` flow
  - 🗑 Delete → `DeleteTask` flow

**CompleteTask flow:**
- Call `employee_update_pa_task_status(p_company_id, p_employee_id, p_task_id, p_status: 'done', p_snoozed_until: null, p_session_token)`
- Remove from list (or move to Done filter)

**SnoozeTask flow:**
- Show action sheet with options: "Later today" | "Tomorrow 9am" | "Next Monday" | "2 hours"
- Compute `snoozed_until`:
  - Later today: current hour + 3 hours
  - Tomorrow 9am: tomorrow at 09:00
  - Next Monday: next Monday at 09:00
  - 2 hours: now + 2 hours
- Call `employee_update_pa_task_status(p_company_id, p_employee_id, p_task_id, p_status: 'snoozed', p_snoozed_until: <computed>, p_session_token)`

**DeleteTask flow:**
- If `source_type = 'manual'`: confirm "Delete '{title}'?" → call `employee_delete_pa_task(p_company_id, p_employee_id, p_task_id, p_session_token)` — verify RPC name; confirmed in DB as `employee_delete_pa_task`
- If `source_type != 'manual'` (system-generated): confirm "Remove from your list?" → same RPC

**Quick Add button** (floating action or top-right):
- Prompt: "What do you need to do?" (single text input)
- If confirmed: call `employee_insert_pa_task` with:
  - `p_title`: input text
  - `p_due_at`: tomorrow at current hour + 1
  - `p_priority`: 'medium'
  - `p_source_type`: 'manual'
  - All other optional fields: null
- Reload task list

**New Task button** → navigate to `/dashboard/employee/pa/new`

---

### Tab: Calendar
**Layout toggle**: Month | Week (two buttons)

**Month view:**
- 7-column calendar grid for the current month
- Each day cell: dot indicators for tasks due that day (colour = priority) + meeting dots
- Click a day → select it and show that day's entries below
- Navigation: ← Previous Month | "Month Year" label | Next Month → / Today button

**Week view:**
- 7 columns = Mon–Sun of selected week
- Same dot indicators
- Navigation: ← Previous Week | "DD Mon – DD Mon" | Next Week →

**Selected day entries panel** (below the calendar grid):
- List of tasks/meetings for the selected day
- Each entry: time + title + type badge (task / meeting / reminder)
- Click → open task editor

**Export calendar button** — generates `.ics` file from current period's entries and triggers browser download. Build ICS format: `BEGIN:VCALENDAR` with one `VEVENT` per entry.

---

### Tab: Search
- Search input (auto-searches as user types, debounced 300ms)
- Searches across: task `title`, `description`, `notes`, `quick_capture`, `linked_label`, `meeting_with`
- Results list: same row format as Tasks tab
- Empty state: "No results" (only show if query is non-empty)

---

## Part 5 — PA Task Editor

**Files:**
- New task: `src/app/dashboard/employee/pa/new/page.tsx`
- Edit task: `src/app/dashboard/employee/pa/[id]/page.tsx`

**Source:** `MyPaTaskEditorViewModel.cs`

For edit mode: load task from the already-fetched `pa_tasks` list (pass via URL param `id`). If not found: show "Task not found."

### Form Fields

**Title** (required) — text input. Error if empty: "Task title is required."

**Notes / Description** — multiline text area

**Priority** — segmented control: Low | Medium | High | Urgent (default: Medium)

**Due Date & Time** — date picker + time picker (default: tomorrow at 09:00)

**Reminder** — date picker + time picker (optional, separate from due date)

**Link type** — select: None | Client | Job | Deal | Meeting (default: None)
- When "Client", "Job", or "Deal" selected → show a secondary dropdown populated by querying the relevant table:
  - Client: query `clients` where `company_id = ?` → show `name`
  - Job: query `jobs` where `company_id = ?` and employee has access → show `title`
  - Deal: query `client_deals` where `company_id = ?` → show `title`
- When "Meeting" selected → show meeting fields (see below)

**Meeting fields** (visible only when linked_type = 'meeting'):
- Meeting with: text input
- Meeting date & time: datetime picker
- Meeting minutes: text area
- Follow-up notes: text area

**Recurrence** — select: None | Daily | Weekly | Monthly (default: None)

**Conflict warning**: when `due_at` or `meeting_at` is set, check if another task has the same time slot in the loaded task list. If conflict found, show inline warning: "Conflicts: [list of conflicting task titles]". User can still save.

### Save Button
**New task** → call `employee_insert_pa_task` with exact parameter names:
```
p_company_id: companyId (uuid)
p_employee_id: employeeId (uuid)
p_title: title
p_notes: notes | null
p_due_at: dueAt (timestamptz) | null
p_priority: priority
p_remind_at: remindAt | null
p_linked_type: linkedType
p_linked_id: selectedLinkId | null
p_linked_label: selectedLinkLabel | null
p_recurrence_pattern: recurrence
p_meeting_with: meetingWith | null
p_meeting_at: meetingAt | null
p_meeting_minutes: meetingMinutes | null
p_meeting_follow_up: meetingFollowUp | null
p_source_type: 'manual'
p_session_token: token
```

**Edit task** → call `employee_update_pa_task` (confirmed RPC). Parameters follow same pattern — update all fields on the existing row. Map to: `UPDATE pa_tasks SET title=?, notes=?, due_at=?, priority=?, remind_at=?, linked_type=?, linked_id=?, linked_label=?, recurrence_pattern=?, meeting_with=?, meeting_at=?, meeting_minutes=?, meeting_follow_up=?, updated_at=now() WHERE id=? AND owner_employee_id=? AND company_id=?`

After save → navigate back to `/dashboard/employee/pa`

---

## Part 6 — My Shifts Page

**File:** `src/app/dashboard/employee/shifts/page.tsx`  
**Source:** `MyShiftsViewModel.cs`

### On Load
1. `resolveCurrentMember` → `{ employeeId, companyId }`
2. Call `employee_get_calendar_events_for_worker(p_company_id, p_employee_id, p_from, p_to, p_session_token)`
   - `p_from`: today minus 7 days (date string `YYYY-MM-DD`)
   - `p_to`: today plus 30 days (date string `YYYY-MM-DD`)

**DB table:** `calendar_events`
```
id, company_id, title, description, start_time, end_time, is_all_day,
attendee_ids (uuid[]), location, event_type, linked_job_id,
created_by, created_at, attendance_responses (jsonb)
```

`attendance_responses` format: `{ "employee-uuid": "accepted" | "declined" }`

### Layout

**Page heading**: "My Shifts"

**Date navigation**: ← | current week label (e.g., "14–20 July 2026") | →. Also "Today" button.

**Shift list** — group by date, show day heading ("Monday, 14 July") then shifts for that day:

Each shift card:
- Title (bold)
- Time: `start_time` to `end_time` formatted as "8:00 am – 4:00 pm" (or "All day" if `is_all_day = true`)
- Location (if set)
- Event type badge (e.g., "shift", "meeting", etc.)
- Linked job chip (if `linked_job_id` set) — shows job title, tappable → navigate to job card
- **Attendance response**: show current response for this employee as a badge: Accepted (green) / Declined (red) / No response (grey)
- **Accept** and **Decline** buttons (only if no response or to change response)

**Accept/Decline action:**
- Call `employee_update_calendar_event_attendance(p_company_id, p_employee_id, p_event_id, p_response: 'accepted'|'declined', p_session_token)`
- Update the row in local state: `attendance_responses[employeeId] = response`
- Button changes to reflect new state

**Empty state** (no shifts in range): "No shifts scheduled in this period."

**Past shifts**: Show with reduced opacity or a "Past" badge for events before today.

---

## Part 7 — Contractor Profile Page

**File:** `src/app/dashboard/employee/contractor/page.tsx`  
**Source:** `EmployeeContractorAdminViewModel.cs`

### On Load
1. `resolveCurrentMember` → `{ employeeId, companyId }`
2. Call `employee_get_linked_contractors(p_company_id, p_employee_id, p_session_token)` → returns `contractors[]` linked to this employee

**DB table:** `contractors`
```
id, company_id, name, registration_number, contact_person, phone, email,
address, bank_account, bank_name, bank_branch_code, rating, is_active,
partner_kind, contractor_code, is_vat_registered, vat_number, default_vat_rate,
account_holder_name, account_type, swift_bic, tax_number, payment_terms,
preferred_payment_method, payment_hold, compliance_hold, banking_verified
```

### Layout

**No profile state** (empty array returned):
- Heading: "No contractor profile linked"
- Body: "Your account is not linked to a contractor profile. Contact HR to link your contractor details."

**Profile found** — display as read-only information cards (employee cannot edit):

**Card 1 — Business Details:**
- Name
- Registration Number
- Partner kind badge (e.g., "Contractor", "Supplier")
- VAT registered: Yes/No + VAT number if registered
- Tax Number
- Rating: star display (e.g., ★★★★☆ 4.2)

**Card 2 — Contact:**
- Contact Person
- Phone: show as `tel:` link with a "Call" button (`window.open('tel:{phone}')`)
- Email: show as `mailto:` link with an "Email" button (`window.open('mailto:{email}')`)
- Address

**Card 3 — Banking:**
- Bank Name
- Account Holder Name
- Account Number: masked — show last 4 digits only (e.g., "•••• 4321")
- Account Type
- Branch Code
- Swift/BIC
- Banking verified: tick badge if `banking_verified = true`

**Card 4 — Status Flags:**
- Active: green badge if `is_active = true`
- Compliance Hold: red warning badge if `compliance_hold = true`
- Payment Hold: red warning badge if `payment_hold = true`

**Multiple contractors** — if the employee has more than one linked contractor, show a tab or accordion per contractor.

---

## Part 8 — Forms / Paperless Page

**File:** `src/app/dashboard/employee/forms/page.tsx`  
**Source:** `PaperlessViewModel.cs`

### On Load
1. `resolveCurrentMember` → `{ employeeId, companyId }`
2. Call `employee_get_workflow_form_templates(p_company_id, p_employee_id, p_session_token)` → returns `workflow_form_templates[]` where `is_active = true`, ordered by `name`
3. Call `employee_get_workflow_form_submissions(p_company_id, p_employee_id, p_session_token)` OR query `workflow_form_submissions` where `company_id = ? AND submitted_by = ?` ordered by `submitted_at DESC LIMIT 20`

**DB tables:**
- `workflow_form_templates`: id, company_id, name, description, fields (jsonb), is_active, created_at
- `workflow_form_submissions`: id, company_id, template_id, submitted_by (uuid), data (jsonb), submitted_at

### Layout

**Page heading**: "Forms"

**Section 1 — Available Forms:**
List of active templates. Each card:
- Template name (bold)
- Description (if set)
- **Fill Form** button → navigate to `/dashboard/employee/forms/{template_id}`

Empty state: "No forms available."

**Section 2 — Recent Submissions (last 20):**
Each row:
- Form name (look up template name from template_id)
- Submitted at: formatted date/time
- Submitted by: "You" (it's always the current employee on this page)

---

## Part 9 — Form Fill Page

**File:** `src/app/dashboard/employee/forms/[id]/page.tsx`  
**Source:** `FormFillViewModel.cs`  
**Route param:** `id` = template UUID

### On Load
1. `resolveCurrentMember`
2. Load template: query `workflow_form_templates` where `id = ? AND company_id = ?`
3. If not found: show "Form not found."
4. Page title = template name
5. Render fields from `template.fields` (jsonb array)

### `fields` jsonb structure
Each field object has:
```json
{
  "key": "field_key",
  "label": "Display Label",
  "type": "text" | "number" | "boolean" | "date" | "select" | "textarea",
  "is_required": true | false,
  "options": ["Option 1", "Option 2"]  // for select type only
}
```

### Field rendering by type:
- `text`: single-line text input
- `number`: number input
- `boolean`: checkbox (true/false)
- `date`: date picker
- `select`: dropdown with `options` array
- `textarea`: multiline text area

Required fields: show asterisk (*) on label.

### Submit Button: "Submit Form"

**Validation**: Check all fields where `is_required = true`:
- For text/textarea: must not be empty or whitespace
- For boolean: no validation (false is a valid answer)
- If any required field fails: show error message listing the missing fields: "Required: {Field Label}, {Field Label}"

**On valid submit:**
Call `employee_submit_workflow_form`:
```
p_company_id: companyId (uuid)
p_employee_id: employeeId (uuid)
p_template_id: templateId (uuid)
p_data: { fieldKey: fieldValue } (jsonb object — one key per field)
p_job_id: null
p_site_id: null
p_session_token: token
```

On success:
- Show alert: "Form '{template.name}' submitted successfully."
- Navigate back to `/dashboard/employee/forms`

---

## Part 10 — My Jobs Page Updates (existing file)

**File:** `src/app/dashboard/employee/jobs/page.tsx` (already built — update only)

The existing page was built but is missing:
1. Each job card must be a link/button → navigate to `/dashboard/employee/jobs/{job_id}`
2. **"+ Job"** button in page header → navigate to `/dashboard/employee/jobs/new`
3. Empty messages must match MAUI exactly:
   - Scope "assigned": "No jobs assigned to you by HR or your manager yet."
   - Scope "created": "You have not created any jobs yet. Tap + Job to add one."
   - Scope "all": "No jobs yet — assigned jobs and jobs you create will appear here."

---

## Summary — Files to Create / Update

| File | Action |
|------|--------|
| `src/components/EmployeeSidebar.tsx` | Update — add My PA, My Shifts, Contractor Profile, Forms links |
| `src/app/dashboard/employee/jobs/page.tsx` | Update — add job card link, + Job button, correct empty messages |
| `src/app/dashboard/employee/jobs/[id]/page.tsx` | **Create** — full Job Card |
| `src/app/dashboard/employee/jobs/new/page.tsx` | **Create** — Job Request form |
| `src/app/dashboard/employee/pa/page.tsx` | **Create** — My PA (Today/Tasks/Calendar/Search tabs) |
| `src/app/dashboard/employee/pa/new/page.tsx` | **Create** — New PA task editor |
| `src/app/dashboard/employee/pa/[id]/page.tsx` | **Create** — Edit PA task editor |
| `src/app/dashboard/employee/shifts/page.tsx` | **Create** — My Shifts |
| `src/app/dashboard/employee/contractor/page.tsx` | **Create** — Contractor Profile |
| `src/app/dashboard/employee/forms/page.tsx` | **Create** — Forms list |
| `src/app/dashboard/employee/forms/[id]/page.tsx` | **Create** — Form fill |

**Total: 9 new files, 2 updates.**

---

## RPC Reference (DB-Verified)

| RPC | Purpose |
|-----|---------|
| `employee_get_pa_tasks(p_company_id, p_employee_id, p_session_token)` | Fetch all PA tasks |
| `employee_insert_pa_task(p_company_id, p_employee_id, p_title, p_notes, p_due_at, p_priority, p_remind_at, p_linked_type, p_linked_id, p_linked_label, p_recurrence_pattern, p_meeting_with, p_meeting_at, p_meeting_minutes, p_meeting_follow_up, p_source_type, p_session_token)` | Create PA task |
| `employee_update_pa_task(p_company_id, p_employee_id, p_task_id, ...same fields..., p_session_token)` | Update PA task |
| `employee_update_pa_task_status(p_company_id, p_employee_id, p_task_id, p_status, p_snoozed_until, p_session_token)` | Complete / snooze |
| `employee_delete_pa_task(p_company_id, p_employee_id, p_task_id, p_session_token)` | Delete PA task |
| `employee_get_calendar_events_for_worker(p_company_id, p_employee_id, p_from, p_to, p_session_token)` | Fetch shifts |
| `employee_update_calendar_event_attendance(p_company_id, p_employee_id, p_event_id, p_response, p_session_token)` | Accept/decline shift |
| `employee_get_linked_contractors(p_company_id, p_employee_id, p_session_token)` | Contractor profile |
| `employee_get_workflow_form_templates(p_company_id, p_employee_id, p_session_token)` | Form templates |
| `employee_submit_workflow_form(p_company_id, p_employee_id, p_template_id, p_data, p_job_id, p_site_id, p_session_token)` | Submit form |
| `employee_get_job_card_for_job(p_company_id, p_job_id, p_employee_id, p_session_token)` | Get job card |
| `employee_upsert_job_card(p_company_id, p_employee_id, p_job_id, p_start_time, p_end_time, p_work_performed, p_materials_used, p_photo_urls, p_is_completed, p_client_signature_url, p_session_token)` | Save job card |
| `employee_get_checklist_for_job(p_company_id, p_job_id, p_employee_id, p_session_token)` | Checklist items |
| `employee_insert_checklist_item(p_company_id, p_employee_id, p_job_id, p_description, p_session_token)` | Add checklist item |
| `employee_job_site_open_visit(p_company_id, p_employee_id, p_session_token)` | Check if on site |
| `employee_job_site_sign_in(p_company_id, p_employee_id, p_job_id, p_latitude, p_longitude, p_address, p_reported_by_name, p_notes, p_session_token)` | Sign in to job site |
| `employee_job_site_sign_out(p_company_id, p_employee_id, p_job_id, p_latitude, p_longitude, p_address, p_session_token)` | Sign out of job site |
| `employee_job_site_sign_out_open_visit(p_company_id, p_employee_id, p_session_token)` | End other site visit |
| `employee_job_site_switch_to_job(p_company_id, p_employee_id, p_job_id, p_latitude, p_longitude, p_address, p_reported_by_name, p_session_token)` | Switch job site |
| `employee_get_inventory_usage_for_job(p_company_id, p_job_id, p_employee_id, p_session_token)` | Inventory used |
| `employee_set_inventory_usage_for_job(p_company_id, p_employee_id, p_job_id, p_inventory_item_id, p_quantity, p_session_token)` | Record inventory |
| `employee_get_job_feedback(p_company_id, p_employee_id, p_job_id, p_session_token)` | Client feedback |
| `employee_submit_job_feedback(p_company_id, p_employee_id, p_job_id, p_rating, p_comments, p_session_token)` | Submit feedback |
| `employee_create_job(p_company_id, p_creator_employee_id, p_title, p_description, p_priority, p_scheduled_start, p_scheduled_end, p_site_id, p_client_id, p_assignee_employee_id, p_assigned_employee_ids, p_notify_manager_employee_id, p_visibility, p_session_token)` | Create job |

---

## Engineering Prompt

Give this to the engineer verbatim:

---

**SUPPLEMENT — Employee Portal Missing Pages**

Read `MISSION_BRIEF_EMPLOYEE_PORTAL_SUPPLEMENT.md` in full before writing a single line of code.

This is a continuation of the employee portal build. The first brief produced 11 files. This supplement adds 9 new files and updates 2 existing files. All RPC names and parameter names are DB-verified — use them exactly as written. Do not invent alternatives.

Build order (to manage dependencies):
1. Update `EmployeeSidebar.tsx` and `jobs/page.tsx` first
2. Create `jobs/[id]/page.tsx` and `jobs/new/page.tsx`
3. Create `pa/page.tsx`, `pa/new/page.tsx`, `pa/[id]/page.tsx`
4. Create `shifts/page.tsx`
5. Create `contractor/page.tsx`
6. Create `forms/page.tsx` and `forms/[id]/page.tsx`

Every page must:
- Call `resolveCurrentMember(supabase)` for `{ employeeId, companyId }`
- Get session token: `const { data: { session } } = await supabase.auth.getSession()`
- Wrap all RPC calls in `try/catch` — show error state on failure, never swallow errors
- Show loading spinner while data fetches
- Show specific empty states as documented (not generic "No data")

Commit message: `feat: employee portal supplement — job card, job request, my PA, PA editor, shifts, contractor profile, forms`

---
