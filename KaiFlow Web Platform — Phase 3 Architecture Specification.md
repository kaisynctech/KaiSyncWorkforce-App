# KaiFlow Web Platform — Phase 3 Architecture Specification

**Date:** 2026-07-09  
**Baseline:** Phase 2 complete (19/19 pages, 0 errors)  
**Stack:** Next.js 16 · React 19 · Tailwind v4 · Supabase SSR (`@supabase/ssr`)  
**Design mandate:** Pixel-perfect parity with MAUI. No layout deviations. No new UX patterns.

---

## §0 Phase 3 Scope

| Route | MAUI Source | Status in Phase 2 |
|---|---|---|
| `/dashboard/jobs/[id]` | `HrJobDetailsPage.xaml` | Stub (empty shell) |
| `/dashboard/contractors` | `HrContractorsPage.xaml` | Not built |
| `/dashboard/contractors/[id]` | `HrContractorDetailsPage.xaml` | Not built |
| `/dashboard/leave/apply` | `HrApplyLeavePage.xaml` | Not built |
| `/dashboard/notifications` | `HrNotificationsPage.xaml` | Not built |
| `/dashboard/jobs/[id]/chat` | `HrSimpleThreadChatPage.xaml` | Not built |

Sidebar nav already has "Contractors" and "Notifications" items from Phase 1. Phase 3 wires them up.

---

## §1 `/dashboard/jobs/[id]` — Job Detail

Replaces the Phase 2 stub. Full scrollable detail page for a single job.

### 1.1 Page layout

```
<div className="p-4 space-y-4 overflow-y-auto">
  {/* Action bar */}
  {/* Error banner */}
  {/* Job header card */}
  {/* Status update card */}
  {/* Team & Contractor card */}
  {/* Cost breakdown card */}
  {/* Labor entries card */}
  {/* Inventory card */}
  {/* Photos card */}
</div>
```

### 1.2 Action bar

Horizontally scrollable row of buttons. All 42px tall.

```tsx
<div className="flex gap-2 overflow-x-auto pb-1">
  <button className="btn-primary h-[42px] px-[18px] text-sm min-w-[72px]">Save</button>
  <button className="btn-outlined h-[42px] px-[18px] text-sm min-w-[72px]">Chat</button>
  <button className="btn-secondary h-[42px] px-[18px] text-sm min-w-[72px]">Edit</button>
  <button className="h-[42px] px-[18px] text-sm min-w-[72px] rounded-xl border
    bg-[#450A0A] text-[#FCA5A5] border-[#FCA5A5] font-semibold">Delete</button>
</div>
```

- **Chat** button navigates to `/dashboard/jobs/[id]/chat`
- **Edit** button navigates to a future edit page (Phase 4+); render as disabled/outlined for now
- **Delete** triggers a confirmation modal before calling the delete RPC

### 1.3 Error banner

```tsx
{errorMessage && (
  <p className="text-[#FCA5A5] text-[13px] font-semibold">{errorMessage}</p>
)}
```

### 1.4 Job header card

Card (`bg-surface-card rounded-xl p-4 border border-divider`):

```
Row: [Job Title — text-lg font-semibold]   [Status badge]

Job description (text-secondary, hidden if null)

──── divider ────

Key-value grid (label col: text-secondary caption; value col: body-small):
  Priority     | {job.priority}
  Client       | {client.name or "—"}
  Site         | {site.address or "—"}
  Start        | {scheduledStart formatted "dd MMM yyyy HH:mm" or "—"}
  End          | {scheduledEnd formatted "dd MMM yyyy HH:mm" or "—"}
  Est. Cost    | R{estimatedCost.toFixed(2)}
  Project      | {linkedProject.name or "—"}  [Open] [Change]  ← text buttons

Lifecycle actions row (only when showLifecycleActions):
  [Mark First Response]  ← shown only when firstResponseAt is null
  [Close Job]            ← primary button
```

**Status badge colours** (carry over from Phase 2):

| status | bg | text |
|---|---|---|
| completed | `#DCFCE7` | `#166534` |
| in_progress | `#DBEAFE` | `#1e40af` |
| cancelled | `#FEE2E2` | `#991b1b` |
| open / scheduled / default | `#F3F4F6` | `#374151` |

Badge: `rounded-xl px-[10px] py-1 text-[11px] font-semibold`.

**Project row** — "Open" and "Change" are `text-primary text-[11px] h-[28px] px-2` text buttons; "Open" hidden when no linked project.

**Lifecycle actions** — SecondaryButton for "Mark First Response", PrimaryButton for "Close Job", both `text-[12px]`.

### 1.5 Status update card

```
Section label: UPDATE STATUS
Row: [<Select status options>]  [Update — primary button w-20]
```

Status options match the status enum: `open`, `scheduled`, `in_progress`, `completed`, `cancelled`. Use the shared `<FormSelect />` component from Phase 2.

### 1.6 Team & Contractor card

Two sub-sections separated by a divider.

**Employees sub-section:**

```
Section label: TEAM & CONTRACTOR
Helper text: "Assign employees and/or a contractor for this job."
Checkbox list (max-h-[160px] overflow-y-auto):
  ☐ {employee.fullName}   ← one row per employee in the company
```

**Contractors sub-section:**

```
──── divider ────
Label: "Contractors"  (font-semibold text-[13px])
Helper: "Assign one or more contractors to this job."

Table header (when rows > 0):
  Contractor | Role | Amount | Docs | (edit) | (remove)
  col widths: flex-1 / w-20 / w-20 / w-11 / w-8 / w-9

Table rows (one per JobContractor):
  {contractorDisplayName}         — primary text, truncate
  ⚠ Compliance hold               — text-[#FCA5A5] text-[9px], hidden if no hold
  {roleDisplay}                   — secondary text-[11px]
  {agreedAmountDisplay}           — primary text-[12px]
  [📄] docs button  bg-[#1A2A1A] text-[#4ADE80] rounded w-11 h-7 text-[11px]
  [✎] edit button   bg-[#1E3A5F] text-[#60A5FA] rounded w-8  h-7 text-[11px]
  [✕] remove button transparent  text-secondary              w-9 h-8

  Financial sub-row (when hasFinancialSummary):
    Finance: | Paid {paidAmount} | Approved {approvedAmount} | {varianceSummary}
    all text-[10px]; Paid=green #22C55E; Approved=blue #0EA5E9; variance=varianceColor

Empty state: "No contractors assigned yet."  text-secondary text-[12px]

[+ Assign Contractor]  ← secondary button h-10 text-[13px] mt-1
[Save team & contractor]  ← primary button h-11 text-[13px]

{contractorHoursSummary}  — text-secondary text-[12px]

Site sessions list (max-h-[140px] overflow-y-auto):
  {partyLine} / In: {signInDisplay} | {hoursDisplay}
```

### 1.7 Cost breakdown card

```
Section label: COST BREAKDOWN
Labor      | R{laborCost}
Inventory  | R{inventoryCost}
Actual     | R{actualCost}
──── divider ────
Total      | R{totalCost}  ← text-primary font-semibold
```

Each row: `flex justify-between` with left label (body-medium) and right value (body-medium).

### 1.8 Labor entries card

```
Section label: LABOR ENTRIES
Empty state: "No labor entries."

Rows:
  {workDate}  |  {hours}h  |  R{totalCost}   ← right value text-primary
```

Row: `grid grid-cols-[1fr_auto_auto] gap-x-2 py-1`.

### 1.9 Inventory card

```
Header row: [INVENTORY]  [+ Add — outlined button h-9 px-3 text-[12px]]
"Total inventory cost: {inventoryTotalDisplay}"  text-primary text-[12px]

Empty state: "No inventory selected yet."

Item rows:
  {itemName}                           | R{totalCost}
  Supplier: {supplier} · {qty} × R{unitCost}   (text-secondary text-[11px])
```

Row: `grid grid-cols-[1fr_auto] gap-x-2` with a second row spanning both columns for the sub-line.

### 1.10 Photos card

```
Section label: JOB PHOTOS  [spinner when isPhotosBusy]

[Upload Before — primary h-10 px-[14px] text-[12px]]
[Upload After  — outlined h-10 px-[14px] text-[12px]]

"Before" label (text-primary font-semibold text-[12px]) — hidden if no before photos
Horizontal photo strip: 72×72px images, gap-2, aspect-fill, onClick opens photo

"After" label (text-[#22C55E] font-semibold text-[12px]) — hidden if no after photos
Horizontal photo strip: same pattern
```

Photo upload uses Supabase Storage bucket `workforce-media`. On web use `<input type="file" accept="image/*">` triggering a signed upload URL.

### 1.11 Data fetching

```ts
// app/dashboard/jobs/[id]/page.tsx (Server Component)
const supabase = createServerClient()

const { data: job } = await supabase
  .from('jobs')
  .select('*, clients(*), sites(*), projects(*)')
  .eq('id', params.id)
  .single()

// Labor entries, inventory, photos — separate queries
// Team members — from employees table for company
// Job contractors — from job_contractors with contractor details
```

All mutations (save, status update, team save, assign contractor, remove contractor, upload photo, close job, mark first response) are `'use client'` actions calling RPCs via the browser Supabase client.

---

## §2 `/dashboard/contractors` — Contractors List

### 2.1 Page layout

```
<div className="h-full flex flex-col">
  {/* Search bar */}
  {/* Filter toolbar */}
  {/* Action Centre panel */}
  {/* Contractor table — flex-1 overflow-y-auto */}
</div>
```

### 2.2 Search bar

```tsx
<input
  type="search"
  placeholder="Search contractors…"
  className="w-full bg-surface-dark text-primary placeholder:text-secondary
    rounded-lg px-3 py-2 text-[14px] mx-2 mt-2"
  value={searchText}
  onChange={e => setSearchText(e.target.value)}
/>
```

Filters the list client-side on `contractor.name`, `contractor.contactPerson`, `contractor.contractorCode`.

### 2.3 Filter toolbar

```tsx
<div className="flex items-center gap-[6px] mx-4 my-2">
  <FilterChip label="Active"   active={filter === 'active'}   onClick={() => setFilter('active')} />
  <FilterChip label="Inactive" active={filter === 'inactive'} onClick={() => setFilter('inactive')} />
  <FilterChip label="All"      active={filter === 'all'}      onClick={() => setFilter('all')} />

  <span className="ml-2 text-[12px] text-secondary flex-1">{count} contractors</span>

  <button className="chip-inactive text-[12px] h-8 px-3">⚙ Packs</button>
  <button onClick={refresh} className="text-[13px] text-primary px-2">Refresh</button>

  {/* + Add button — top-right or inline */}
  <button className="btn-primary h-8 px-3 text-[13px]">+ Add</button>
</div>
```

`FilterChip` — active state: `bg-[#1E3A5F] text-white`; inactive: `bg-[#1E293B] text-[#64748B]`; `rounded-[14px] h-8 px-3 text-[12px] font-medium`.

"+ Add" navigates to `/dashboard/contractors/new`.

"⚙ Packs" navigates to `/dashboard/contractors/packs` (Phase 4 deferred; render as disabled for now).

### 2.4 Action Centre panel

Card with `bg-surface-card rounded-xl border border-divider mx-4 mb-2 overflow-hidden`.

```
Header row (px-3 py-[10px]):
  ⚡ (text-primary font-semibold text-[14px])
  ACTION CENTRE  (font-semibold text-[12px] text-primary)
  {actionCentreCountLabel}  (text-secondary text-[11px])
  [↻ Refresh]  transparent text-secondary text-[11px] h-8

──── divider (opacity 0.4) ────

{isBusy && <ActivityIndicator />}

Action items list:
  Empty: "✓  No pending contractor actions"  text-secondary text-[12px] px-3 py-2

  Item row (px-3 py-2, cols: 110px / 1fr / 90px / 70px):
    [ActionType badge]  — rounded-[5px] px-[6px] py-[3px] bg={actionTypeBadgeBg} text={actionTypeBadgeFg} text-[10px] font-medium
    {contractorName}    — text-primary text-[12px] font-medium truncate
    {summary}           — text-secondary text-[11px] truncate
    {createdAtDisplay}  — text-secondary text-[11px] text-right
    [Open →]            — transparent text-primary text-[11px] h-[30px]
```

### 2.5 Contractor table

Horizontally scrollable. Total width: 1100px. Same `<DataTable>` pattern as Phase 2 Jobs table.

```tsx
<div className="flex-1 overflow-y-auto">
  <div className="overflow-x-auto mx-4">
    <table style={{ minWidth: 1100 }} className="w-full">
      <thead>
        <tr className="bg-surface-elevated">
          <th style={{width:185}} className="data-th text-left">Company</th>
          <th style={{width: 90}} className="data-th text-left">Code</th>
          <th style={{width:130}} className="data-th text-left">Contact</th>
          <th style={{width:120}} className="data-th text-left">Phone</th>
          <th style={{width:160}} className="data-th text-left">Email</th>
          <th style={{width: 70}} className="data-th text-center">Rating</th>
          <th style={{width: 85}} className="data-th text-center">Banking</th>
          <th style={{width: 80}} className="data-th text-center">Payment</th>
          <th style={{width:100}} className="data-th text-center">Compliance</th>
          <th style={{width: 80}} className="data-th text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {contractors.map(c => (
          <tr key={c.id} onClick={() => router.push(`/dashboard/contractors/${c.id}`)}
              className="bg-surface-card hover:bg-surface-dark cursor-pointer border-b border-divider">
            <td className="data-td text-primary truncate">{c.name}</td>
            <td className="data-td text-secondary font-medium">{c.contractorCodeDisplay}</td>
            <td className="data-td text-secondary truncate">{c.contactPerson}</td>
            <td className="data-td text-secondary">{c.phone ?? '—'}</td>
            <td className="data-td text-secondary truncate">{c.email ?? '—'}</td>
            <td className="data-td text-center text-secondary">{c.ratingDisplay}</td>
            <td className="data-td text-center"><StatusBadge bg={c.bankingStatusBg} fg={c.bankingStatusFg} label={c.bankingStatusText} /></td>
            <td className="data-td text-center"><StatusBadge bg={c.paymentStatusBg} fg={c.paymentStatusFg} label={c.paymentStatusText} /></td>
            <td className="data-td text-center"><StatusBadge bg={c.complianceStatusBg} fg={c.complianceStatusFg} label={c.complianceStatusText} /></td>
            <td className="data-td text-right"><StatusBadge bg={c.statusBadgeBg} fg={c.statusBadgeFg} label={c.statusLabel} /></td>
          </tr>
        ))}
      </tbody>
    </table>
    {contractors.length === 0 && (
      <p className="text-secondary text-center py-6 text-[13px]">
        No contractors yet. Click + Add to register one.
      </p>
    )}
  </div>
</div>
```

**Status badge colours:**

| Field | Label | Bg | Fg |
|---|---|---|---|
| Banking | Verified | `#DCFCE7` | `#166534` |
| Banking | Pending | `#1E293B` | `#94A3B8` |
| Payment | Clear | `#DCFCE7` | `#166534` |
| Payment | Hold | `#FEF3C7` | `#92400E` |
| Compliance | Compliant | `#DCFCE7` | `#166534` |
| Compliance | Hold | `#FEE2E2` | `#991B1B` |
| Status | Active | `#DCFCE7` | `#166534` |
| Status | Inactive | `#1E293B` | `#94A3B8` |

Badge: `rounded-lg px-2 py-[3px] text-[10px] font-medium inline-block`.

### 2.6 Data fetching

```ts
// app/dashboard/contractors/page.tsx (Server Component)
const { data: contractors } = await supabase
  .from('contractors')
  .select('*')
  .order('name')

// Action Centre items — separate query to contractor_action_items or equivalent RPC
```

Filter (Active/Inactive/All) and search applied client-side in a `'use client'` wrapper component.

---

## §3 `/dashboard/contractors/[id]` — Contractor Detail

### 3.1 Page layout

```
<div className="h-full flex flex-col">
  {/* Header row */}
  {/* Tab bar */}
  {/* Tab panel — flex-1 overflow-y-auto */}
</div>
```

### 3.2 Header row

```tsx
<div className="flex items-center justify-between px-4 py-3">
  <h1 className="text-xl font-semibold text-primary">{contractor?.name ?? 'New Contractor'}</h1>
  <button onClick={save} className="btn-primary h-11 px-5 text-[16px] min-w-[96px]">Save</button>
</div>
```

### 3.3 Tab bar

Horizontally scrollable. 10 tabs total.

```tsx
const tabs = [
  'Information', 'Compliance', 'Payments', 'Team',
  'Jobs', 'Projects', 'Incidents', 'Activity', 'Quotes', 'Invoices'
]
```

Active tab style: `bg-[#1E3A5F] text-white`
Inactive tab style: `bg-[#1E293B] text-[#64748B]`
All tabs: `rounded-[14px] h-[34px] px-3 text-[12px] font-medium border-0`

"Jobs", "Projects", "Incidents" use blue active colour `bg-[#3B82F6]` (operational tabs).

Phase 3 implements **Information** and **Compliance** tabs fully. The remaining 8 tabs render a `<ComingSoon />` placeholder (a centred text "Coming soon" in text-secondary).

### 3.4 Tab 1: Information

Scrollable stack of cards inside `<div className="p-4 space-y-4">`.

#### 3.4.1 Company Details card

```
Section label: COMPANY DETAILS

<input>   Company / trading name *           ← bound to contractor.name
<Select>  Partner type                        ← PartnerKindLabels options
<input>   Registration number

{contractor.hasContractorCode && (
  <div className="flex justify-between items-center">
    <span className="text-primary font-semibold">Code: {contractor.contractorCode}</span>
    <span className="text-secondary text-xs">auto-generated</span>
  </div>
)}

Rating row:
  "Rating"  |  ★ {rating.toFixed(1)} (text-primary)  |  [−] [{rating}] [+] stepper

Active toggle row:
  "Active"  |  <Toggle isOn={contractor.isActive} />
```

Rating stepper: min 0, max 5, step 0.5. Render as `[−]` and `[+]` buttons with the value between.

#### 3.4.2 Tax & Identification card

```
Section label: TAX & IDENTIFICATION

<input>  Tax number (SARS income tax ref.)   ← contractor.taxNumber
VAT Registered row: "VAT Registered"  |  <Toggle isOn={isVatRegistered} />
<input>  VAT number  ← disabled when !isVatRegistered
```

#### 3.4.3 Contractor Portal Code card

Only visible when `showPortalCodeSection` (i.e. contractor has been saved).

```
Section label: CONTRACTOR PORTAL CODE
Helper: "Share with the subcontractor team — one code for sign-in, site time, photos, and messages."

<input>  Auto-generated  ← contractor.contractorCode

[Generate code]    ← secondary button text-[12px]
[Rotate portal code]  ← shown only when hasContractorCode
  style: bg-surface-dark text-[#F59E0B] rounded-lg h-10 text-[12px]

{contractorCodeExpiresAt && (
  <span>Expires: {format(contractorCodeExpiresAt, 'dd MMM yyyy')}</span>
)}
```

#### 3.4.4 Contact card

```
Section label: CONTACT

<input>  Contact person      ← contractor.contactPerson
<input>  Phone               ← contractor.phone  (tel keyboard)
<input>  Email               ← contractor.email  (email keyboard)
<input>  Address             ← contractor.address
```

#### 3.4.5 Notes card

```
Section label: NOTES
<textarea>  Internal notes about this contractor
  ← contractor.notes, auto-grow, min-h-[72px]
```

### 3.5 Tab 2: Compliance

Scrollable stack. Three main sections: new-contractor guard → Pack assignment → Checklist → Overview.

#### 3.5.1 New-contractor guard

```tsx
{isNew && (
  <div className="card flex items-center gap-3 p-4">
    <span className="material-icons text-secondary">info</span>
    <p className="text-secondary text-[13px]">
      Save the contractor on the Information tab first to access compliance documents.
    </p>
  </div>
)}
```

Entire compliance tab is hidden (`isNew` guard) until the contractor has been saved.

#### 3.5.2 Compliance Pack assignment card

```
Section label: COMPLIANCE PACK

<Select> Select compliance pack  ← PackLabels options

{hasPackAssigned && (
  <div className="grid grid-cols-3 gap-2">
    KPI tile: bg-[#1E293B]  value={packRequiredCount}  label="Required"  text-[#94A3B8]
    KPI tile: bg-[#14532D]  value={packCompleteCount}  label="Complete"  text-[#22C55E]
    KPI tile: bg-[#2D0A0A]  value={packMissingCount}   label="Missing"   text-[#FCA5A5]
  </div>
)}

{!hasPackAssigned && (
  <p className="text-secondary text-[12px]">
    Assign a compliance pack to enable pack-based scoring and a required document checklist...
  </p>
)}
```

KPI tile structure: `rounded-lg py-[10px] flex flex-col items-center gap-1` — value `text-[20px] font-semibold`, label `text-[10px]`.

#### 3.5.3 Required Documents Checklist card

Only visible when `packChecklistRows.length > 0`.

```
Section label: REQUIRED DOCUMENTS CHECKLIST
Helper text: "Based on the assigned compliance pack. Required rows (Req.) count toward the compliance score."
──── divider ────

Rows (one per PackChecklistRow):
  cols: [Req badge] | [TypeLabel] | [ExpiryDisplay] | [StatusBadge]

  Req badge: rounded-[6px] px-[6px] py-[3px] bg={requirementBg} text={requirementFg} text-[9px] font-medium
  TypeLabel: text-primary text-[12px]
  ExpiryDisplay: text-secondary text-[11px] (hidden when !showExpiry)
  StatusBadge: rounded-lg px-2 py-[3px] bg={statusBadgeBg} text={statusBadgeFg} text-[10px] font-medium

  ──── divider (0.4 opacity) between rows ────
```

#### 3.5.4 Compliance Overview card

```
Section label: COMPLIANCE OVERVIEW

Top row:
  [Score %]  large text-[30px] font-bold color={compScoreColor}
             sub: "({compRequiredValidLabel} required)" text-[10px] text-secondary
  [Progress bar]  progress={compScoreProgress} color={compScoreColor} bg-[#1E293B] h-[10px]
             sub: "Required documents valid" text-[10px] text-secondary
  [Status badge]  rounded-lg px-[10px] py-[6px] bg={compStatusBadgeBg} text-[12px] font-medium text={compStatusBadgeFg}

5-KPI grid (grid-cols-5 gap-1.5 py-2):
  Valid      bg-[#0F2918] value={compValidRequired}    text-[#22C55E] label-[#4ADE80]
  Expiring   bg-[#292012] value={compExpiringRequired} text-[#FCD34D] label-[#FCD34D]
  Expired    bg-[#2D0A0A] value={compExpiredRequired}  text-[#FCA5A5] label-[#FCA5A5]
  Pending    bg-[#1E293B] value={compPendingRequired}  text-[#94A3B8] label-[#64748B]
  Rejected   bg-[#2D0F0F] value={compRejectedRequired} text-[#F87171] label-[#F87171]

  Each tile: rounded-lg py-2 flex flex-col items-center gap-1
  Value: text-[18px] font-semibold; Label: text-[10px]

Alert banners (each conditionally shown):
  No required docs:   border-[#334155] bg-[#0F172A]  icon=info     text-[#64748B]
  Expired docs:       border-[#7F1D1D] bg-[#2D0A0A]  icon=warning  text-[#FCA5A5]
  Pending docs:       border-[#78350F] bg-[#292012]  icon=info     text-[#FCD34D]
  Rejected docs:      border-[#7F1D1D] bg-[#2D0F0F]  icon=cancel   text-[#F87171]

  Banner: rounded-lg border px-3 py-[10px] flex items-center gap-2
  Icon: material-icons text-[16px]; text: text-[12px] flex-1

Expiring within 30 days section (when expiringDocuments.length > 0):
  ──── divider ────
  Label: EXPIRING WITHIN 30 DAYS
  Rows: [Req badge] | {documentName} | {expiryDisplay} | ⚠ icon
    Req badge: bg-[#450A0A] text-[#FCA5A5] shown only when isRequired
    expiryDisplay + warning icon: text/color = expiryWarningFg (amber or red)
```

---

## §4 `/dashboard/leave/apply` — Apply Leave

Reached via the "Apply Leave" action from the Employees → Leave sub-tab or from the employee detail page.

### 4.1 Page layout

Single scrollable card page.

```
<div className="p-4 space-y-4 overflow-y-auto">
  <div className="card p-4 space-y-3">

    <p className="section-label">LEAVE APPLICATION</p>

    {/* Employee field — read-only */}
    <div className="field-group">
      <label className="field-label">Employee</label>
      <input readOnly value={employeeName}
             className="dark-entry text-secondary cursor-default" />
    </div>

    {/* Leave type */}
    <div className="field-group">
      <label className="field-label">Leave type</label>
      <FormSelect options={leaveTypes} value={leaveType} onChange={setLeaveType} />
    </div>

    {/* Date range */}
    <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-end">
      <div className="field-group">
        <label className="field-label">Start date</label>
        <FormDateInput value={startDate} onChange={setStartDate} />
      </div>
      <span className="text-secondary mb-2">–</span>
      <div className="field-group">
        <label className="field-label">End date</label>
        <FormDateInput value={endDate} onChange={setEndDate} />
      </div>
    </div>

    {/* Total days — auto-calculated info box */}
    <div className="bg-surface-dark rounded-lg px-3 py-2 text-[13px]">
      <span className="text-secondary">Total days: </span>
      <span className="text-primary font-semibold">{totalDays}</span>
    </div>

    {/* Reason */}
    <div className="field-group">
      <label className="field-label">Reason *</label>
      <textarea
        rows={3}
        placeholder="Enter reason for leave…"
        value={reason}
        onChange={e => setReason(e.target.value)}
        className="dark-entry resize-none min-h-[80px] w-full"
      />
    </div>

  </div>

  {errorMessage && <p className="text-error text-[13px]">{errorMessage}</p>}

  <button
    onClick={submit}
    disabled={isBusy}
    className="btn-primary w-full h-11"
  >
    Submit Leave Application
  </button>

  {isBusy && <div className="flex justify-center"><LoadingSpinner /></div>}
</div>
```

### 4.2 Total days calculation

```ts
function calcWorkingDays(start: Date, end: Date): number {
  // Simple calendar day count inclusive (matching MAUI: End - Start + 1 days)
  const msPerDay = 86400000
  return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1
}
```

### 4.3 Leave types

Fetch from the `leave_types` table (or equivalent) for the company. Options include: `Annual Leave`, `Sick Leave`, `Family Responsibility`, `Unpaid Leave`, and any custom types configured in settings.

### 4.4 Mutation

```ts
await supabase.rpc('apply_leave', {
  p_employee_id: employeeId,
  p_leave_type: leaveType,
  p_start_date: startDate.toISOString().split('T')[0],
  p_end_date: endDate.toISOString().split('T')[0],
  p_reason: reason,
})
```

On success, navigate back to the employee's leave tab.

### 4.5 Route context

The page receives `employeeId` via query param: `/dashboard/leave/apply?employeeId=xxx`. The employee name is fetched server-side and passed as a prop.

---

## §5 `/dashboard/notifications` — Notifications

### 5.1 Page layout

```
<div className="p-4 space-y-5 overflow-y-auto">
  {/* IN-APP ALERTS section */}
  {/* PENDING LEAVE REQUESTS section */}
  {/* OPEN INCIDENTS section */}
  {/* PENDING PAYMENT APPROVALS section */}
</div>
```

Pull-to-refresh is not available on web; add a **Refresh** button in the top-right of the page header instead.

### 5.2 Section structure (shared pattern)

Each section:

```tsx
<p className="section-label">{SECTION_TITLE}</p>
{isEmpty && <p className="text-secondary text-[13px]">{emptyText}</p>}
<div className="space-y-2">
  {items.map(item => <SectionCard ... />)}
</div>
```

### 5.3 IN-APP ALERTS

```
Section label: IN-APP ALERTS
Helper: "Client messages and system alerts appear here instantly (not SMS)."
Empty: "No new in-app alerts."

Alert card (clickable):
  <div className="card flex gap-[10px] p-3 cursor-pointer hover:bg-surface-dark">
    <div className="w-1 rounded-full self-stretch" style={{background: item.color}} />
    <div className="flex-1 space-y-1">
      <p className="font-semibold text-[14px] text-primary">{item.title}</p>
      <p className="text-secondary text-[12px]">{item.body}</p>
      <p className="text-primary text-[10px]">{item.when}</p>
    </div>
  </div>
```

The 4px left accent bar (`w-1`) uses `item.color` — a hex colour from the notification payload indicating category/severity.

### 5.4 PENDING LEAVE REQUESTS

```
Section label: PENDING LEAVE REQUESTS
Empty: "No pending leave requests."

Leave card:
  <div className="card p-3">
    <div className="flex justify-between items-start">
      <p className="font-semibold text-[14px] text-primary">{leaveRequest.leaveType}</p>
      <span className="badge" style={{background:'#FEF3C7', color:'#92400E'}}>Pending</span>
    </div>
    <p className="text-secondary text-[12px] mt-1">
      {format(leaveRequest.startDate, 'dd MMM yyyy')}
    </p>
  </div>
```

Badge: `rounded-[10px] px-2 py-[3px] text-[11px] font-semibold`.

### 5.5 OPEN INCIDENTS

```
Section label: OPEN INCIDENTS
Empty: "No open incidents."

Incident card:
  <div className="card p-3 flex justify-between items-start">
    <div className="flex-1 space-y-0.5 mr-2">
      <p className="text-primary text-[13px] font-medium line-clamp-2">{incident.description}</p>
      <p className="text-secondary text-[12px]">{format(incident.createdAt, 'dd MMM yyyy')}</p>
    </div>
    <span className="badge" style={{background: severityBg, color: severityFg}}>
      {incident.severityRaw}
    </span>
  </div>
```

**Severity badge colours:**

| severity | bg | fg |
|---|---|---|
| critical | `#FEE2E2` | `#991B1B` |
| high | `#FEF3C7` | `#92400E` |
| medium | `#DBEAFE` | `#1E40AF` |
| low / default | `#DCFCE7` | `#166534` |

### 5.6 PENDING PAYMENT APPROVALS

```
Section label: PENDING PAYMENT APPROVALS
Empty: "No pending payment approvals."

Payment card:
  <div className="card p-3 flex justify-between items-center">
    <div>
      <p className="font-semibold text-[13px] text-primary">{payment.periodLabel}</p>
      <p className="text-secondary text-[12px]">R {payment.grossPay.toFixed(2)}</p>
    </div>
    <span className="badge" style={{background:'#FEF3C7', color:'#92400E'}}>Pending</span>
  </div>
```

### 5.7 Data fetching

```ts
// app/dashboard/notifications/page.tsx (Server Component)
const [appNotifications, pendingLeave, openIncidents, pendingPayments] = await Promise.all([
  supabase.from('notifications').select('*').eq('is_read', false).order('created_at', { ascending: false }),
  supabase.from('leave_requests').select('*').eq('status', 'pending'),
  supabase.from('incident_reports').select('*').eq('status', 'open'),
  supabase.from('payment_approvals').select('*').eq('status', 'pending'),
])
```

---

## §6 `/dashboard/jobs/[id]/chat` — Thread Chat

### 6.1 Page layout

Full-height flex column. Messages fill the space; input bar is pinned to the bottom.

```tsx
<div className="h-full flex flex-col">
  {/* Message list — flex-1, overflow-y-auto, scroll to bottom on new message */}
  <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
    {messages.length === 0 && <EmptyState />}
    {messages.map(msg => <ChatBubble key={msg.id} message={msg} />)}
  </div>

  {/* Input bar */}
  <div className="bg-surface-dark border-t border-divider px-3 py-2">
    <div className="flex gap-2 items-center">
      <input
        value={newMessage}
        onChange={e => setNewMessage(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && send()}
        placeholder="Type a message..."
        className="flex-1 bg-transparent text-primary placeholder:text-secondary text-[14px] outline-none"
      />
      <button onClick={send}
              className="bg-primary text-white rounded-2xl px-4 py-2 text-[13px]">
        Send
      </button>
    </div>
  </div>
</div>
```

### 6.2 Empty state

```tsx
<div className="flex flex-col items-center justify-center h-full gap-2 py-8">
  <p className="text-secondary text-[13px]">No messages yet.</p>
  <p className="text-secondary text-[12px] text-center max-w-[260px]">
    Messages sent here are visible to crew assigned to this job.
  </p>
</div>
```

### 6.3 ChatBubble component

```tsx
function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.isOwn) {
    return (
      <div className="flex justify-end">
        <div className="bg-primary rounded-2xl px-3 py-2 max-w-[280px] space-y-0.5">
          <p className="text-white text-[14px]">{message.body}</p>
          <p className="text-[#E8E8FF] text-[11px] text-right">{message.timeDisplay}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start max-w-[280px] gap-0.5">
      <p className="text-accent text-[12px] font-semibold">{message.senderName}</p>
      <div className="bg-surface-dark rounded-2xl px-3 py-2 space-y-0.5">
        <p className="text-primary text-[14px]">{message.body}</p>
        <p className="text-secondary text-[11px] text-right">{message.timeDisplay}</p>
      </div>
    </div>
  )
}
```

### 6.4 Auto-scroll

```ts
useEffect(() => {
  listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
}, [messages])
```

### 6.5 Real-time subscription

```ts
useEffect(() => {
  const channel = supabase
    .channel(`job-chat-${jobId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'job_messages',
      filter: `job_id=eq.${jobId}`,
    }, payload => {
      setMessages(prev => [...prev, mapMessage(payload.new)])
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [jobId])
```

### 6.6 Send mutation

```ts
async function send() {
  if (!newMessage.trim()) return
  const text = newMessage
  setNewMessage('')
  try {
    await supabase.from('job_messages').insert({
      job_id: jobId,
      body: text,
      sender_id: currentUserId,
    })
  } catch (e) {
    setNewMessage(text) // restore on failure
  }
}
```

---

## §7 Shared components added in Phase 3

### 7.1 `<StatusBadge />`

```tsx
// components/ui/StatusBadge.tsx
export function StatusBadge({
  label, bg, fg
}: { label: string; bg: string; fg: string }) {
  return (
    <span
      className="inline-block rounded-lg px-2 py-[3px] text-[10px] font-medium whitespace-nowrap"
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  )
}
```

### 7.2 `<FilterChip />`

```tsx
// components/ui/FilterChip.tsx
export function FilterChip({
  label, active, onClick
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-[14px] h-8 px-3 text-[12px] font-medium border-0"
      style={{
        backgroundColor: active ? '#1E3A5F' : '#1E293B',
        color: active ? '#FFFFFF' : '#64748B',
      }}
    >
      {label}
    </button>
  )
}
```

### 7.3 `<ComingSoon />` tab placeholder

```tsx
// components/ui/ComingSoon.tsx
export function ComingSoon() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-secondary text-[14px]">Coming soon</p>
    </div>
  )
}
```

### 7.4 `<KpiTile />` (compliance grid)

```tsx
// components/ui/KpiTile.tsx
export function KpiTile({
  value, label, bg, valueFg, labelFg
}: { value: number; label: string; bg: string; valueFg: string; labelFg: string }) {
  return (
    <div
      className="rounded-lg py-2 flex flex-col items-center gap-1"
      style={{ backgroundColor: bg }}
    >
      <span className="text-[18px] font-semibold" style={{ color: valueFg }}>{value}</span>
      <span className="text-[10px]" style={{ color: labelFg }}>{label}</span>
    </div>
  )
}
```

---

## §8 Sidebar nav wiring

The Phase 1 sidebar already includes "Contractors" and "Notifications" nav items. Confirm the routes are correct:

| Nav item | Icon codepoint | Route |
|---|---|---|
| Contractors | `&#xE7EF;` (people) | `/dashboard/contractors` |
| Notifications | `&#xE7F4;` (notifications) | `/dashboard/notifications` |

No sidebar changes needed — Phase 3 just implements the destination pages.

---

## §9 New routes summary

```
app/
  dashboard/
    jobs/
      [id]/
        page.tsx          ← §1 (replaces stub)
        chat/
          page.tsx        ← §6
    contractors/
      page.tsx            ← §2
      [id]/
        page.tsx          ← §3
    leave/
      apply/
        page.tsx          ← §4
    notifications/
      page.tsx            ← §5
```

Total new/replaced pages: **6**

---

## §10 Engineering handoff notes

1. **`supabase.rpc()` — never chain `.catch()`**  
   `supabase.rpc()` returns `PostgrestFilterBuilder` which exposes `.then()` but **not** `.catch()`. Always wrap in `try/catch`:
   ```ts
   try {
     const { data, error } = await supabase.rpc('apply_leave', { ... })
     if (error) throw error
   } catch (e) {
     setErrorMessage('Failed to submit leave request.')
   }
   ```

2. **Chat real-time — client component only**  
   The chat page must be `'use client'` (Supabase Realtime requires a browser WebSocket). Fetch initial messages server-side as a prop, then subscribe client-side.

3. **Scroll to bottom on chat load**  
   After initial render, call `listRef.current?.scrollTop = listRef.current.scrollHeight` (no animation on first load, `behavior: 'smooth'` on new messages only).

4. **Date formatting — use `Intl.DateTimeFormat`, never `Date.toLocaleDateString()`**  
   ```ts
   const fmt = new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
   fmt.format(new Date(dateString)) // → "09 Jul 2026"
   ```
   For datetime (job start/end): add `hour: '2-digit', minute: '2-digit', hour12: false`.

5. **Horizontal tables — `overflow-x-auto` wrapper**  
   The contractors table (1100px) and the job contractors sub-table need an `overflow-x-auto` parent. Do **not** use `table-layout: fixed` unless column widths are explicitly set via `style={{ width: Npx }}`.

6. **File uploads (job photos)**  
   ```ts
   const file = e.target.files?.[0]
   if (!file) return
   const path = `jobs/${jobId}/${type}/${Date.now()}_${file.name}`
   await supabase.storage.from('workforce-media').upload(path, file)
   ```
   Use a signed URL for display: `supabase.storage.from('workforce-media').createSignedUrl(path, 3600)`.

7. **`/dashboard/leave/apply` — requires `employeeId` query param**  
   If `employeeId` is missing, redirect to `/dashboard/employees`.

8. **Contractor Details — 8 deferred tabs**  
   Payments, Team, Jobs, Projects, Incidents, Activity, Quotes, Invoices — render `<ComingSoon />` for Phase 3. These are Phase 4 scope.

9. **`/dashboard/contractors/new`**  
   Create page is Phase 4 scope. The "+ Add" button can be rendered but should navigate to a "coming soon" route or show a toast for now.

10. **`proxy.ts` — no changes needed**  
    Phase 3 routes all live under `/dashboard/*` which is already protected by the existing `proxy.ts` auth guard from Phase 1.
