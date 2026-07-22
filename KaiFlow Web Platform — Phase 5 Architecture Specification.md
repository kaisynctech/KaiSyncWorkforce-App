# KaiFlow Web Platform — Phase 5 Architecture Specification

**Source:** `KaiFlow.Timesheets.Maui/Views/Hr/`  
**Target:** `kaisync-web/app/dashboard/`  
**Mandate:** Pixel-perfect replica of the MAUI app. No creative deviation. Every dimension, colour, and behaviour must match the XAML source exactly.

---

## Routes in this phase

| # | Route | XAML Source |
|---|-------|-------------|
| 1 | `/dashboard/payroll` | `HrPaymentsPage.xaml` |
| 2 | `/dashboard/payroll/[id]` | `HrPayslipDetailPage.xaml` |
| 3 | `/dashboard/inventory` | `HrInventoryPage.xaml` |
| 4 | `/dashboard/inventory/[id]` | `HrInventoryDetailPage.xaml` |
| 5 | `/dashboard/compliance-packs` | `HrCompliancePacksPage.xaml` |
| 6 | `/dashboard/time-templates` | `HrShiftTemplatesPage.xaml` |
| 7 | `/dashboard/time-templates/new` + `/dashboard/time-templates/[id]/edit` | `HrCreateTimeTemplatePage.xaml` |
| 8 | `/dashboard/work-teams` | `HrWorkTeamsPage.xaml` |
| 9 | `/dashboard/work-teams/[id]` | `HrWorkTeamDetailsPage.xaml` |

---

## Global conventions (carry-forward from previous phases)

- **Font:** Poppins (400/500/600/700) — import via Google Fonts in `layout.tsx`
- **Icons:** Material Icons via Google-hosted font; use Unicode codepoints as `&#xXXXX;` or `\uXXXX` in CSS `content`
- **Colours:** Use CSS variables from `@theme {}` in `globals.css`; never hard-code a value that has a token equivalent
- **Date format:** `dd MMM yyyy` everywhere; use `Intl.DateTimeFormat('en-ZA', {day:'2-digit', month:'short', year:'numeric'})` — never `.toLocaleDateString()`
- **Currency:** ZAR, prefix `R`; format with `Intl.NumberFormat('en-ZA', {minimumFractionDigits:2, maximumFractionDigits:2})`
- **Supabase RPC:** Always `try { await supabase.rpc(...) } catch(e) {}` — never chain `.catch()`
- **Scrollable tables:** Use `overflow-x: auto` wrapper + fixed `min-width` on the inner `<table>`
- **Server components** for initial data fetch; `'use client'` only where interactivity requires it
- **Empty states:** Use the same `<EmptyState>` pattern as prior phases
- **Section labels:** `<SectionLabel>` — uppercase, `text-[11px]` tracking-wider, `text-secondary`

---

## §1 — `/dashboard/payroll`

**XAML:** `HrPaymentsPage.xaml`  
**Title:** "Payroll"

### 1.1 Action bar (top toolbar)

Row of text/icon buttons, right-aligned, in the page header area:

| Button | Style |
|--------|-------|
| Settings | `bg-surface-dark` icon button (``) |
| Lock / Unlock | `bg-surface-dark` icon button (`` / ``) |
| Register | secondary text button |
| IRP5 | secondary text button |
| Release All | secondary text button |
| Generate | secondary text button |
| Approve All | primary button |
| Bank CSV | secondary text button |
| Export | secondary text button |

These map directly to toolbar items in MAUI. Render as a horizontal `flex gap-2 flex-wrap` row in the page header alongside the "Payroll" `<h1>`.

### 1.2 KPI row

Two `<KpiTile>` components side by side (`grid grid-cols-2 gap-4`):
- **Pending gross** — label + formatted R value
- **Approved gross** — label + formatted R value

### 1.3 Date range

`grid grid-cols-2 gap-4`:
- From: `<FormDateInput label="From" />`
- To: `<FormDateInput label="To" />`

### 1.4 Status labels (conditional)

- **PayslipReleaseHint:** plain label, `text-primary text-sm`, shown when hint text is non-null
- **PeriodLockLabel:** plain label, `text-error text-sm font-medium`, shown when period is locked

### 1.5 Filter toolbar

Horizontal row (`flex items-center gap-3`):
- Search input (`<SearchInput />` — same pattern as prior pages)
- Status filter chips: **All / Pending / Approved / Paid** — use existing `<FilterChip />` component

### 1.6 Payroll table

Scrollable wrapper → `<table>` with `min-width: 980px`.

**Column definitions (px):** Employee(150) / Period(120) / Gross(85) / Deduct.(85) / Net(85) / Hours(90) / Status(80) / Visible(100) / Actions(200)

**Header row** (`bg-surface-elevated`):
- Employee — sortable (click fires sort by employee name)
- Period — no sort
- Gross — sortable, `text-right`
- Deduct. — no sort, `text-right`
- Net — sortable (label bound to `NetHeaderLabel`, defaults "Net"), `text-right`
- Hours — no sort
- Status — sortable (label bound to `StatusHeaderLabel`, defaults "Status")
- Visible — no sort
- Actions — no sort

**Data rows** (`bg-surface-card`, divider between rows):

Each row is clickable (→ navigates to `/dashboard/payroll/[id]`).

| Column | Rendering |
|--------|-----------|
| Employee | `text-primary text-sm font-medium` |
| Period | `text-secondary text-sm` |
| Gross | `text-sm text-right` |
| Deduct. | `text-secondary text-sm text-right` |
| Net | `text-primary text-sm text-right` |
| Hours | `text-secondary text-sm` |
| Status | `<StatusBadge />` component |
| Visible | `text-[11px]`; `text-[#16A34A]` if visible to employee, `text-[#6B7280]` otherwise; display "Shown" / "Hidden" |
| Actions | See below |

**Actions cell** — `flex items-center gap-1.5`:

```
[Open]    bg-surface-dark text-primary   h-[30px] px-2 text-[11px] rounded-md   always visible
[Approve] primary button style           h-[30px] px-2 text-[11px]              visible only if status === 'pending'
[Show]    bg-[#7C3AED] text-white        h-[30px] px-2 text-[11px] rounded-md   visible only if canReleaseToEmployee
[Reject]  danger button style            h-[30px] px-2 text-[11px]              visible only if status === 'pending'
```

---

## §2 — `/dashboard/payroll/[id]`

**XAML:** `HrPayslipDetailPage.xaml`  
**'use client'** — HR overrides require live state.

### 2.1 Page header

```
[Employee Name]    font-semibold text-[18px]
[Period label]     text-secondary text-sm      (e.g. "Jul 2026")
[Status badge]     inline pill
```

**Status badge colours:**

| Status | Background | Text |
|--------|-----------|------|
| approved | `#DCFCE7` | `#166534` |
| paid | `#DBEAFE` | `#1E40AF` |
| rejected | `#FEE2E2` | `#991B1B` |
| pending | `#FEF9C3` | `#854D0E` |

### 2.2 Payslip summary card (`<SectionCard>`)

`<table>` with columns: Item(`*`) / Value(`110px`, `text-right`)

All rows have `bg-surface-card` except NET PAY which has `bg-surface-elevated`.

| Row | Label | Value style | Conditional |
|-----|-------|-------------|-------------|
| 1 | Days Worked | default | always |
| 2 | Approved Leave | `text-primary` | always |
| 3 | Absent Days | `text-error` | only if absentDays > 0 |
| 4 | Regular Hours | default | always |
| 5 | Overtime Hours | `text-[#F59E0B]` | only if overtimeHours > 0 |
| 6 | Regular Pay | default | always |
| 7 | Overtime Pay | `text-[#F59E0B]` | only if overtimePay > 0 |
| 8 | Gross Pay | default | always |
| 9 | Deductions | `text-error` | only if deductions > 0 |
| 10 | **NET PAY** | label: `font-["PoppinsBold"] text-[14px]`; value: `font-["PoppinsBold"] text-[16px] text-primary` | always, `bg-surface-elevated` row |

### 2.3 Period locked banner

Shown only when `isPeriodLocked === true`.

```
bg-[#FEE2E2] border border-[#DC2626] rounded-xl p-4
"This pay period is locked — recalculation and overrides are disabled."
text-[#DC2626] text-sm
```

### 2.4 HR Adjustments card

Shown only when `canEditOverrides === true` (i.e. payslip status is pending and current user has HR role).

Title: **HR ADJUSTMENTS** (`<SectionLabel>`)  
Caption: "Override payroll before approving. Tap Recalculate to apply — PAYE and settings save to the employee profile for next month." (`text-secondary text-xs`)

Grid of overrides (`grid grid-cols-[1fr_auto] gap-y-2.5 items-center`):

| Label | Control |
|-------|---------|
| Pay full monthly salary (ignore mid-month join pro-rate) | `<Switch>` |
| Waive attendance penalties | `<Switch>` |
| Manual PAYE (R) | `<input type="number" className="w-[100px] text-right" placeholder="Auto" />` (DarkEntry style) |
| Extra deduction (R) | `<input type="number" className="w-[100px] text-right" />` |
| Adjustment note | `<input type="text" className="w-[160px]" />` |
| Bonus (R) | `<input type="number" className="w-[100px] text-right" />` |
| Bonus note | `<input type="text" className="w-[160px]" />` |

Below grid: **[Recalculate Payslip]** primary button, full width.

### 2.5 Earnings Breakdown card

Shown only when `hasEarningsLines === true`.

Title: **EARNINGS BREAKDOWN** (`<SectionLabel>`)  
`<PayrollLineItemsTable items={earningsLines} />` — a reusable table component (see §2.8).

### 2.6 Deductions Breakdown card

Shown only when `hasDeductionLines === true`.

Title: **DEDUCTIONS BREAKDOWN** (`<SectionLabel>`)  
`<PayrollLineItemsTable items={deductionLines} showAsDeductions />` — negative amounts rendered in `text-error`.

### 2.7 Year to Date card

Shown only when `hasYtd === true`.

Title: **YEAR TO DATE (TAX YEAR)** (`<SectionLabel>`)

`<table>` with cols Item(`*`) / Amount(`110px`, `text-right`):

| Row | Label | Colour |
|-----|-------|--------|
| YTD Gross | `text-secondary` | default |
| YTD PAYE | `text-error` | `text-error` |
| YTD UIF | `text-error` | `text-error` |
| YTD Net | default | `text-primary` |

### 2.8 Policy at generation card

Shown only when `hasPolicySnapshot === true`.

Title: **POLICY AT GENERATION** (`<SectionLabel>`)  
Single `<p>` with `policySnapshotSummary`, `text-secondary text-sm`.

### 2.9 Audit Trail card

Shown only when `hasAuditEntries === true`.

Title: **AUDIT TRAIL** (`<SectionLabel>`)

`<table>` cols Action(`*`) / When(`120px`, `text-right`):

Each audit row:
- Action column: `<div><p className="text-sm">{action}</p>{detail && <p className="text-[11px] text-secondary">{detail}</p>}</div>`
- When column: formatted as `dd MMM HH:mm`

### 2.10 New shared component: `<PayrollLineItemsTable />`

```tsx
interface PayrollLineItemsTableProps {
  items: { label: string; amount: number }[]
  showAsDeductions?: boolean
  emptyMessage?: string
}
```

Renders a `<table>` with cols Description(`*`) / Amount(`110px`, `text-right`). When `showAsDeductions`, amount is rendered in `text-error`. Empty state shows `emptyMessage`.

---

## §3 — `/dashboard/inventory`

**XAML:** `HrInventoryPage.xaml`

### 3.1 Header row

```
flex items-center justify-between
Left:  <SearchInput placeholder="Search inventory..." />
Right: [Refresh] icon button (bg-surface-dark)
```

### 3.2 Sub-header row

```
flex items-center justify-between
Left:  "{count} items" text-secondary text-sm
Right: "Low stock only" label + <Switch> toggle
```

### 3.3 Inventory table

Scrollable wrapper → `<table>` with `min-width: 1020px`.

**Columns (px):** Item(160) / SKU(80) / Supplier(140) / On hand(90) / Unit(90) / Unit cost(100) / Stock value(100) / Alert(70)

All headers left-aligned, plain `<SectionLabel>` style.

**Data rows:**
- Row background: `needsReorder ? 'bg-[#FEF2F2]' : 'bg-surface-card'`
- Clickable row → navigates to `/dashboard/inventory/[id]`

| Column | Style |
|--------|-------|
| Item | `text-primary text-sm font-medium` |
| SKU | `text-secondary text-sm` |
| Supplier | `text-sm` |
| On hand | `text-sm` |
| Unit | `text-secondary text-sm` |
| Unit cost | `text-sm` — formatted `R{value}` |
| Stock value | `text-sm` — formatted `R{value}` |
| Alert | "Low" → `text-[#F87171] text-sm font-medium`; "OK" → `text-[#9CA3AF] text-sm` |

---

## §4 — `/dashboard/inventory/[id]`

**XAML:** `HrInventoryDetailPage.xaml`

### 4.1 Page header

```
grid grid-cols-[1fr_auto] items-center px-4 py-3
Left:  <h1>{title}</h1>   (HeadlineMedium — new item = "New Item", edit = item name)
Right: [Save] primary button  h-[44px] px-5 text-[16px] font-semibold rounded-lg
```

### 4.2 ITEM DETAILS card

```
ITEM DETAILS  <SectionLabel>
<FormInput placeholder="Item name *" binding={name} />
<FormInput placeholder="SKU / code" binding={sku} />
<Textarea placeholder="Description" autoSize minHeight={64} binding={description} />
<FormInput placeholder="Unit (each, box, kg…)" binding={unitOfMeasure} />
<div className="grid grid-cols-2 gap-3">
  <FormInput label="Unit cost (R)" type="number" binding={unitCostText} />
  <FormInput label="Selling price (R)" type="number" binding={sellingPriceText} />
</div>
```

### 4.3 SUPPLIER card

```
SUPPLIER  <SectionLabel>
<p className="text-[11px] text-secondary">Where you purchase this item (used on jobs and costing).</p>
<div className="flex items-center gap-2">
  <FormSelect placeholder="Select supplier" options={suppliers} binding={selectedSupplier} className="flex-1" />
  <button className="text-primary text-sm">+ New</button>
</div>
```

Clicking `+ New` opens a modal/sheet to create a new supplier inline (same pattern as other inline-create flows in prior phases).

### 4.4 STOCK card

```
STOCK  <SectionLabel>
<div className="grid grid-cols-2 gap-3">
  <FormInput label="Quantity on hand" type="number" binding={quantityOnHandText} />
  <FormInput label="Reorder level" type="number" binding={reorderLevelText} />
</div>
<p className="text-primary text-sm">{stockValuePreview}</p>   e.g. "Stock value: R 1,250.00"
<div className="flex items-center justify-between">
  <span className="text-sm">Active item</span>
  <Switch checked={isActive} onColor="#16A34A" />
</div>
```

### 4.5 Allocate button

```
<OutlinedButton className={isNew ? 'hidden' : ''}>
  Allocate stock to open job
</OutlinedButton>
```

Hidden when creating a new item.

---

## §5 — `/dashboard/compliance-packs`

**XAML:** `HrCompliancePacksPage.xaml`  
**'use client'** — master-detail interaction is fully client-side.

### 5.1 Layout

```
<div className="grid grid-cols-[300px_1fr] gap-0 h-full">
  <LeftPanel />
  <RightPanel />
</div>
```

### 5.2 Left panel (300px)

Fixed-width left column with its own scroll.

**Header:**
```
<SectionLabel>COMPLIANCE PACKS</SectionLabel>
<button className="primary w-full mt-2">+ Create Pack</button>
```

**Error state** (shown on load failure):
```
bg-error-subtle border border-error rounded-xl p-3
"Failed to load packs."
[Retry] outlined button
```

**Empty state:** "No compliance packs yet. Create one above." (`EmptyState` style)

**Pack card list** (scrollable `VerticalStackLayout` equivalent = `flex flex-col gap-2 mt-3 overflow-y-auto`):

Each pack card (`CardFrame` — `bg-surface-card rounded-xl border border-divider p-3`):

```
Row 1: flex items-center justify-between
  Left:  pack name  text-sm font-semibold
  Right: "★ Default" badge  bg-[#14532D] text-[#22C55E] text-[10px] px-2 py-0.5 rounded-full
         (hidden if !showDefaultBadge)

Row 2: flex gap-2 mt-1
  Required badge:   bg-[#7F1D1D] text-[#FCA5A5] text-[10px] px-1.5 py-0.5 rounded  "{n} Required"
  Recommended badge: bg-[#292012] text-[#FCD34D] text-[10px] px-1.5 py-0.5 rounded "{n} Recommended"
                     (hidden if recommendedCount === 0)

Row 3 (action buttons): flex gap-1.5 mt-2
  [★ Set Default]  bg-[#1E293B] text-[#94A3B8] text-[10px] h-[28px] px-2 rounded-md
                   hidden if showDefaultBadge (i.e. already default)
  [Edit]           bg-primary text-white text-[10px] h-[28px] px-2 rounded-md
  [Delete]         bg-transparent text-error text-[10px] h-[28px] px-2 rounded-md
```

Clicking [Edit] sets `isEditing=true` and loads the pack into the right panel edit form.

### 5.3 Right panel — idle state

Shown when `isEditing === false`:

```
flex flex-col items-center justify-center h-full text-secondary
<span className="material-icons text-[48px]">inbox</span>   (icon  = "inbox" / folder outline)
<p className="text-[15px] font-medium mt-2">Select a pack to edit</p>
<p className="text-[12px]">or create a new pack using the button on the left.</p>
```

### 5.4 Right panel — edit/create form

Shown when `isEditing === true`. `CardFrame` with `p-5` and inner `ScrollView`.

**Form header:** "Create Compliance Pack" or "Edit Compliance Pack" — `HeadlineSmall` (`text-[18px] font-semibold`)

**Pack Name field:**
```
<label className="text-[11px] text-secondary uppercase tracking-wider">Pack Name *</label>
<FormInput placeholder="e.g. Security Contractor" binding={editName} />
```

**Description field:**
```
<label className="text-[11px] text-secondary uppercase tracking-wider">Description</label>
<Textarea placeholder="Short description of when to use this pack…"
          autoSize minHeight={60} binding={editDescription} />
```

**Default toggle:**
```
grid grid-cols-[1fr_auto] items-center
Left:
  "Set as Company Default"  text-sm
  "Auto-assigned to new contractors when no pack is selected."  text-xs text-secondary
Right: <Switch checked={editIsDefault} onColor primary />
```

**Divider:** `<hr className="border-divider" />`

**DOCUMENT REQUIREMENTS section:**
```
<SectionLabel>DOCUMENT REQUIREMENTS</SectionLabel>
<p className="text-xs text-secondary">
  Set each document type to Required (counts toward score), Recommended (advisory), or Exclude (not shown).
</p>
```

**Legend row:** `flex gap-2 mt-2`
```
Required:    bg-[#7F1D1D] text-[#FCA5A5] text-[10px] px-2 py-0.5 rounded
Recommended: bg-[#78350F] text-[#FCD34D] text-[10px] px-2 py-0.5 rounded
Exclude:     bg-[#1E293B] text-[#475569] text-[10px] px-2 py-0.5 rounded
```

**EditRows list** — for each document type in the company's doc-type catalogue:

```
grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 py-1.5
Col 0: document type label  text-sm
Col 1: [Required]    button  h-[28px] px-2.5 text-[10px] rounded-md  bg={requiredBg} text={requiredFg}
Col 2: [Recommend]   button  h-[28px] px-2.5 text-[10px] rounded-md  bg={recommendedBg} text={recommendedFg}
Col 3: [Exclude]     button  h-[28px] px-2.5 text-[10px] rounded-md  bg={noneBg} text={noneFg}
```

Active state colours for each button (from XAML — the active button has a saturated background, inactive has a muted `#1E293B`/`#475569`):
- **Required active:** `bg-[#7F1D1D]` `text-[#FCA5A5]`
- **Recommended active:** `bg-[#78350F]` `text-[#FCD34D]`
- **Exclude active:** `bg-[#1E293B]` `text-[#475569]`
- **Inactive (any button not selected):** `bg-[#1E293B]` `text-[#475569]` with reduced opacity

**Divider:** `<hr className="border-divider" />`

**Save/Cancel row:** `flex justify-end gap-2.5`
```
[Cancel]    secondary button  h-[42px] px-5 text-[13px]
[Save Pack] primary button    h-[42px] px-5 text-[13px] font-semibold  disabled when isBusy
```

---

## §6 — `/dashboard/time-templates`

**XAML:** `HrShiftTemplatesPage.xaml`

### 6.1 Page header

```
flex items-center justify-between
Left:  <h1>Time Templates</h1>  HeadlineMedium
Right: [+ Add Template] primary button
```

### 6.2 Template card list

`flex flex-col gap-3` — one `CardFrame` per template:

```
CardFrame (bg-surface-card rounded-xl border border-divider p-4)

Row 1: flex items-center gap-2
  Name:           text-sm font-["PoppinsBold"]   (BodyLarge Bold)
  "Default" badge: bg-[#DCFCE7] text-[#166534] text-[10px] px-2 py-0.5 rounded-full
                   visible only if isDefault

Row 2: flex gap-2 mt-2
  [Default]  bg-surface-dark text-sm h-[30px] px-3 rounded-md
             hidden if already default (isDefault === true)
  [Edit]     text-primary text-sm  (TextButton style)
  [Delete]   bg-[#FEE2E2] text-[#DC2626] text-sm h-[30px] px-3 rounded-md

Row 3 (Summary):
  <p className="text-xs text-secondary mt-1">{summary}</p>
  e.g. "08:00 – 17:00 · 1 break · 8.5 paid hrs"
```

[+ Add Template] → navigates to `/dashboard/time-templates/new`  
[Edit] → navigates to `/dashboard/time-templates/[id]/edit`  
[Default] → fires `setDefaultTemplate(id)` RPC, optimistic update  
[Delete] → confirm dialog → fires delete RPC

---

## §7 — `/dashboard/time-templates/new` and `/dashboard/time-templates/[id]/edit`

**XAML:** `HrCreateTimeTemplatePage.xaml`  
**'use client'** — live paid-hours preview requires reactive state.

The same page component is used for both create and edit. The page title is bound to VM: "New Template" vs "Edit Template".

### 7.1 TEMPLATE DETAILS card

```
TEMPLATE DETAILS  <SectionLabel>

<FormInput
  label="Template name *"
  placeholder="e.g. Office Hours, Night Shift, Cleaners"
  binding={name}
/>

<div className="flex flex-col gap-1.5">
  <label className="text-xs text-secondary font-medium">Start time</label>
  <div className="bg-surface-dark rounded-lg px-3 py-1">
    <input type="time" value={startTime} onChange={...} className="bg-transparent text-primary" />
  </div>
</div>

<div className="flex flex-col gap-1.5">
  <label className="text-xs text-secondary font-medium">End time</label>
  <div className="bg-surface-dark rounded-lg px-3 py-1">
    <input type="time" value={endTime} onChange={...} className="bg-transparent text-primary" />
  </div>
</div>
```

### 7.2 BREAKS card

**Header row:**
```
flex items-center justify-between
Left:  <SectionLabel>BREAKS</SectionLabel>
Right: [+ Add Break]  bg-surface-dark text-primary h-[32px] px-3 text-[12px] rounded-lg
```

**Empty state** (when no breaks): `text-xs text-secondary` — "No breaks added. Tap '+ Add Break' to add a tea break, lunch, etc."

**Break item list** (`flex flex-col gap-1.5`):

Each break item (`bg-surface-dark rounded-lg px-3 py-2`):
```
grid grid-cols-[1fr_auto] items-center gap-2
Left:
  <p className="text-[13px] font-semibold text-primary">{label}</p>
  <p className="text-[11px] text-secondary">{minutes} minutes</p>
Right:
  [✕]  bg-transparent text-error text-[16px] w-9 h-9
```

Clicking [+ Add Break] opens an inline modal or sheet:
- Label field (e.g. "Tea break", "Lunch")
- Minutes field (numeric)
- [Add] primary, [Cancel] secondary

### 7.3 Live paid hours preview

```
bg-surface-dark border border-primary rounded-xl px-5 py-3.5
flex flex-col items-center gap-1

<p className="font-['PoppinsBold'] text-[20px] text-primary">{paidHoursPreview}</p>
e.g. "8h 30m"

<p className="text-[11px] text-secondary">updates as you change times and breaks</p>
```

The `paidHoursPreview` is computed client-side: `(endTime - startTime) - sum(break.minutes)`, formatted as `{h}h {mm}m`. Recalculates on every state change.

### 7.4 Footer

```
{errorMessage && <p className="text-error text-[13px]">{errorMessage}</p>}
[Save Template]  primary button  full-width
{isBusy && <ActivityIndicator />}
```

---

## §8 — `/dashboard/work-teams`

**XAML:** `HrWorkTeamsPage.xaml`

### 8.1 Page header (bg-surface-dark section)

```
flex items-center justify-between px-4 py-3 bg-surface-dark
Left:  <h1 className="text-sm font-semibold uppercase tracking-wider">Work Teams</h1>
Right: [+ Team] primary button
```

Note: XAML uses `bg-surface-dark` for the heading container — replicate this exactly.

### 8.2 Team card list

`flex flex-col gap-3 p-4` — pull-to-refresh mapped to a [Refresh] button or auto-refresh on focus.

Each team card (`CardFrame p-3`):

```
grid grid-cols-[auto_1fr_auto] items-center gap-3

Col 0: Team icon circle  w-11 h-11 rounded-full flex items-center justify-center
       bg: isActive ? '#1D4ED8' : '#374151'
       Content: 👥 emoji  text-xl

Col 1: Team info (vertical stack)
       Name:        text-sm font-["PoppinsBold"]   (BodyLarge)
       Description: text-xs text-secondary  line-clamp-1  (hidden if null)
       "{memberCount} member(s)":  text-xs
         — memberCount number rendered in text-primary, rest in text-secondary

Col 2: Active badge
       isActive  → bg-[#DCFCE7] text-[#166534] text-[11px] font-bold px-2 py-1 rounded-xl  "Active"
       !isActive → bg-[#F3F4F6] text-[#6B7280] text-[11px] font-bold px-2 py-1 rounded-xl  "Inactive"
```

Tapping a card → navigates to `/dashboard/work-teams/[id]`.

[+ Team] → navigates to `/dashboard/work-teams/new` (same detail page with empty state).

---

## §9 — `/dashboard/work-teams/[id]`

**XAML:** `HrWorkTeamDetailsPage.xaml`  
**'use client'** — member management is interactive.

Also handles `/dashboard/work-teams/new` — when `id === 'new'`, the VM starts with an empty team object.

### 9.1 Page header

```
grid grid-cols-[1fr_auto] items-center px-4 py-3
Left:  <h1>{title}</h1>   "New Team" or team name
Right: [Save] primary button  h-[44px] px-5 text-[16px] font-semibold rounded-lg
```

The entire page is wrapped in a null-guard: if `team === null` (loading), show `<ActivityIndicator />`.

### 9.2 TEAM INFO card

```
TEAM INFO  <SectionLabel>

<div className="flex flex-col gap-1.5">
  <label className="text-xs font-medium">Team name *</label>
  <FormInput placeholder="Team name" binding={name} />
</div>

<div className="flex flex-col gap-1.5">
  <label className="text-xs font-medium">Description</label>
  <FormInput placeholder="Description (optional)" binding={description} />
</div>
```

### 9.3 Mixed Branches warning

Shown only when `hasMixedBranches === true`:

```
bg-warning-dark border border-warning rounded-lg px-3 py-2
<p className="text-[13px] font-semibold text-warning">Mixed Branches in This Team</p>
<p className="text-sm text-primary">Members from: {branchSummary}</p>
```

Use `bg-[var(--color-warning-dark)]` and `border-[var(--color-warning)]` — these tokens already exist from prior phases.

### 9.4 Members section

**Header row:**
```
flex items-center justify-between
Left:  <SectionLabel>MEMBERS</SectionLabel>
Right: [+ Add Member] primary button  h-[36px] text-[13px]
```

**Member list** (`flex flex-col gap-2`):

Empty state: "No members yet. Add some above." (`EmptyState` style)

Each member card (`CardFrame`):
```
grid grid-cols-[1fr_auto] items-center gap-2

Col 0: Member info
  <p className="text-sm font-medium">{fullName}</p>
  {branch && <p className="text-xs text-secondary">{branch}</p>}
  {isLeader && <p className="text-xs text-accent">Leader</p>}

Col 1: flex items-center gap-1
  [Set Leader / Unset Leader]  TextButton text-[12px]
  [Remove]  text-error text-[12px] TextButton
           (MAUI uses SwipeView, web exposes Remove button inline in the card)
```

Note: MAUI's SwipeView (right-swipe to reveal Remove) does not translate to web. Render [Remove] as a visible inline button — text-error, TextButton style.

**[+ Add Member]** opens a modal/sheet with employee picker (same `FormSelect` + employee list pattern used elsewhere).

### 9.5 Footer

```
{errorMessage && <p className="text-error text-[13px]">{errorMessage}</p>}
{isBusy && <ActivityIndicator className="mx-auto" />}
```

---

## New shared components in this phase

| Component | Location | Description |
|-----------|----------|-------------|
| `<PayrollLineItemsTable />` | `components/payroll-line-items-table.tsx` | 2-col table for earnings/deductions lines; `showAsDeductions` prop renders amounts in `text-error` |

No other net-new components — all other patterns (`CardFrame`, `SectionLabel`, `FormInput`, `FormSelect`, `FormDateInput`, `Switch`, `StatusBadge`, `FilterChip`, `KpiTile`, `ActivityIndicator`, `EmptyState`, `SearchInput`) are already defined in prior phases.

---

## Data / Supabase notes

### Payroll
- List page: `supabase.from('employee_payments').select('*, employee:employees(full_name)')` filtered by date range + status
- Detail page: `supabase.from('employee_payments').select('*, earnings_lines(*), deduction_lines(*), ytd_totals(*), audit_entries(*)')` by id
- RPC for approve: `supabase.rpc('approve_payslip', { payment_id: id })`
- RPC for reject: `supabase.rpc('reject_payslip', { payment_id: id })`
- RPC for release to employee: `supabase.rpc('release_payslip_to_employee', { payment_id: id })`
- RPC for recalculate: `supabase.rpc('recalculate_payslip', { payment_id: id, overrides: {...} })`
- All RPCs: wrap in `try/catch`, never chain `.catch()`

### Inventory
- List: `supabase.from('inventory_items').select('*, supplier:suppliers(name)')`
- Detail: `supabase.from('inventory_items').select('*, supplier:suppliers(*)')` by id
- Upsert: `supabase.from('inventory_items').upsert({...})`

### Compliance Packs
- List: `supabase.from('compliance_packs').select('*, items:compliance_pack_items(*, doc_type:document_types(name))')`
- Upsert pack + items: `supabase.rpc('upsert_compliance_pack', { pack: {...}, items: [...] })`
- Set default: `supabase.rpc('set_default_compliance_pack', { pack_id: id })`
- Delete: `supabase.from('compliance_packs').delete().eq('id', id)`

### Time Templates
- List: `supabase.from('shift_templates').select('*, breaks:shift_template_breaks(*)')`
- Upsert: `supabase.rpc('upsert_shift_template', { template: {...}, breaks: [...] })`
- Set default: `supabase.rpc('set_default_shift_template', { template_id: id })`
- Delete: `supabase.from('shift_templates').delete().eq('id', id)`

### Work Teams
- List: `supabase.from('work_teams').select('*, members:work_team_members(count)')`
- Detail: `supabase.from('work_teams').select('*, members:work_team_members(*, employee:employees(full_name, branch))')` by id
- Add member: `supabase.from('work_team_members').insert({ team_id, employee_id })`
- Remove member: `supabase.from('work_team_members').delete().match({ team_id, employee_id })`
- Set leader: `supabase.rpc('set_team_leader', { team_id, employee_id })`

---

## TypeScript types to add to `lib/database.ts`

```typescript
// Payroll
export interface EmployeePayment {
  id: string
  employee_id: string
  period_label: string
  gross_pay: number
  deductions: number
  net_pay: number
  hours: number
  status: 'pending' | 'approved' | 'paid' | 'rejected'
  is_visible_to_employee: boolean
  can_release_to_employee: boolean
  is_period_locked: boolean
  can_edit_overrides: boolean
  pay_full_base_salary: boolean
  waive_penalties: boolean
  manual_paye_override: number | null
  manual_adjustment: number | null
  adjustment_note: string | null
  bonus_amount: number | null
  bonus_note: string | null
  days_worked: number
  approved_leave: number
  absent_days: number
  regular_hours: number
  overtime_hours: number
  regular_pay: number
  overtime_pay: number
  has_earnings_lines: boolean
  has_deduction_lines: boolean
  has_ytd: boolean
  has_policy_snapshot: boolean
  has_audit_entries: boolean
  policy_snapshot_summary: string | null
}

export interface PayrollLineItem {
  label: string
  amount: number
}

export interface YtdTotals {
  gross_pay: number
  paye: number
  uif: number
  net_pay: number
}

export interface PayrollAuditEntry {
  action: string
  detail: string | null
  at: string
}

// Inventory
export interface InventoryItem {
  id: string
  name: string
  sku: string | null
  description: string | null
  unit_of_measure: string | null
  unit_cost: number
  selling_price: number | null
  quantity_on_hand: number
  reorder_level: number
  is_active: boolean
  needs_reorder: boolean
  stock_value: number
  supplier_id: string | null
  supplier?: { id: string; name: string }
}

// Compliance Packs
export interface CompliancePack {
  id: string
  name: string
  description: string | null
  is_default: boolean
  required_count: number
  recommended_count: number
  items: CompliancePackItem[]
}

export interface CompliancePackItem {
  doc_type_id: string
  requirement: 'required' | 'recommended' | 'none'
  doc_type?: { name: string }
}

// Shift Templates
export interface ShiftTemplate {
  id: string
  name: string
  start_time: string   // "HH:mm"
  end_time: string     // "HH:mm"
  is_default: boolean
  summary: string      // computed: "08:00 – 17:00 · 1 break · 8.5 paid hrs"
  breaks: BreakSlot[]
}

export interface BreakSlot {
  id: string
  label: string
  minutes: number
}

// Work Teams
export interface WorkTeam {
  id: string
  name: string
  description: string | null
  is_active: boolean
  member_count: number
  members?: TeamMember[]
}

export interface TeamMember {
  id: string
  employee_id: string
  is_leader: boolean
  employee?: { full_name: string; branch: string | null }
}
```

---

## Verification checklist for engineers

- [ ] `/dashboard/payroll` — KPI tiles, date range, status chips, 980px table with 9 cols; Actions cell shows correct conditional buttons
- [ ] `/dashboard/payroll/[id]` — Status badge colours correct; HR Adjustments card hidden unless `canEditOverrides`; NET PAY row has `bg-surface-elevated` and bold 16px text; YTD / Audit cards conditionally shown
- [ ] `/dashboard/inventory` — Low-stock rows have `bg-[#FEF2F2]`; Alert column renders "Low" in `#F87171` / "OK" in `#9CA3AF`
- [ ] `/dashboard/inventory/[id]` — Allocate button hidden for new items; stock value preview updates reactively
- [ ] `/dashboard/compliance-packs` — Master-detail layout; right panel idle state shows correct icon + copy; edit form legend colours exactly match spec; EditRows three-button toggle works correctly; Save Pack disabled when busy
- [ ] `/dashboard/time-templates` — Default badge shown only when isDefault; [Default] button hidden if already default; [Delete] has `bg-[#FEE2E2]`
- [ ] `/dashboard/time-templates/new` + `[id]/edit` — TimePicker renders as `<input type="time">`; live paid-hours preview recalculates on every change; break cards in `bg-surface-dark`
- [ ] `/dashboard/work-teams` — Team icon circle colours correct (active `#1D4ED8`, inactive `#374151`); memberCount number in text-primary; active/inactive badge colours correct
- [ ] `/dashboard/work-teams/[id]` — Mixed Branches warning only shown when `hasMixedBranches`; Remove button inline (not swipe); [Set Leader / Unset Leader] label toggles correctly
- [ ] TypeScript build: 0 errors across all routes
