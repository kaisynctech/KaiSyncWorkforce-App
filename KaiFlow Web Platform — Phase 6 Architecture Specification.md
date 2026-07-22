# KaiFlow Web Platform — Phase 6 Architecture Specification

**Source:** `KaiFlow.Timesheets.Maui/Views/Hr/`  
**Target:** `kaisync-web/app/dashboard/`  
**Mandate:** Pixel-perfect replica of the MAUI app. No creative deviation.

---

## Routes in this phase

| # | Route | XAML Source |
|---|-------|-------------|
| 1 | `/dashboard/suppliers` | `HrSuppliersPage.xaml` |
| 2 | `/dashboard/activity-log` | `HrActivityLogPage.xaml` |
| 3 | `/dashboard/active-sessions` | `HrActiveSessionsPage.xaml` |
| 4 | `/dashboard/assets` | `HrAssetsPage.xaml` |
| 5 | `/dashboard/reports` | `HrReportsPage.xaml` + `HrReportsView.xaml` |
| 6 | `/dashboard/scheduling` | `HrSchedulingPage.xaml` |
| 7 | `/dashboard/team-punch` | `HrTeamPunchPage.xaml` |
| 8 | `/dashboard/properties` | `HrPropertiesPage.xaml` |
| 9 | `/dashboard/residents` | `HrResidentsPage.xaml` |
| 10 | `/dashboard/employees/import` | `HrImportEmployeesPage.xaml` |
| 11 | `/dashboard/payroll/settings` | `HrPayrollSettingsPage.xaml` |
| 12 | `/dashboard/jobs/[id]/contractor-docs` | `HrJobContractorDocsPage.xaml` |

---

## Global conventions (carry-forward)

- Poppins font, Material Icons, CSS variables, ZAR currency, `dd MMM yyyy` dates — unchanged from prior phases
- `try/catch` around all `await supabase.rpc(...)` — never `.catch()`
- Server components for initial data; `'use client'` only where required
- All existing shared components (`StatusBadge`, `FilterChip`, `KpiTile`, `SectionLabel`, `CardFrame`, `FormInput`, `FormSelect`, `FormDateInput`, `Switch`, `SearchInput`, `EmptyState`, `ActivityIndicator`, `InfoBanner`, `PayrollLineItemsTable`, `ComingSoon`) reused without re-definition

---

## §1 — `/dashboard/suppliers`

**XAML:** `HrSuppliersPage.xaml`

### 1.1 Page header

```
flex items-center justify-between px-4 py-3
Left:  <h1>Suppliers</h1>  HeadlineMedium  (Title bound to VM)
Right: [+ Add] primary button  (ToolbarItem)
```

### 1.2 Sub-header row

```
flex items-center justify-between px-4 py-2
Left:  "{count} suppliers"  text-secondary text-xs
Right: [Refresh] TextButton text-[13px]
```

### 1.3 Suppliers table

Scrollable wrapper → `<table>` with `min-width: 900px`.

**Columns (px):** Supplier(200) / Contact(140) / Phone / Email(160) / Address(140) / Status(120)

**Header row** (`bg-surface-elevated`): Supplier / Contact / Phone / Email / Address / Status (right-aligned)

**Data rows** (`bg-surface-card`, clickable → opens supplier detail/edit modal):

| Column | Style |
|--------|-------|
| Supplier | `text-primary text-sm font-medium` |
| Contact | `text-secondary text-sm` |
| Phone / Email | `text-secondary text-sm` (`ContactDisplay` — phone · email combined) |
| Address | `text-secondary text-sm` `truncate` |
| Status | `text-secondary text-sm text-right` (`StatusLabel`) |

**Empty state:** "No suppliers yet. Add suppliers here or from an inventory item."

Note: suppliers share the `Contractor` model in MAUI — the table uses `contractor.Name`, `ContactPerson`, `ContactDisplay` (phone + email), `Address`, `StatusLabel`. The detail/edit page for a supplier opens the contractor detail at the Information tab. On web, [+ Add] and row click both navigate to `/dashboard/contractors/new?type=supplier` and `/dashboard/contractors/[id]` respectively — the contractor detail page already exists from Phase 3.

---

## §2 — `/dashboard/activity-log`

**XAML:** `HrActivityLogPage.xaml`  
**Title:** "Activity Log"

The page is a single scrollable feed split into three sections. Pull-to-refresh → [Refresh] button on web.

### 2.1 RECENT CLOCK INS/OUTS

`<SectionLabel>RECENT CLOCK INS/OUTS</SectionLabel>`

Empty state: "No recent punches."

**Punch card** (`CardFrame mb-1.5`):
```
grid grid-cols-[1fr_auto] items-center gap-3

Col 0 (vertical stack):
  EmployeeName      font-semibold text-[13px] text-primary
  DateTime          text-[12px] text-secondary   format: "ddd dd MMM, HH:mm"
                    → use Intl.DateTimeFormat with weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'
  Address           text-[11px] text-secondary truncate  (hidden if null)

Col 1 (type badge):
  TypeLabel === "Clock In"  → bg-[#DCFCE7] text-primary
  TypeLabel === "Clock Out" → bg-[#FEE2E2] text-primary
  pill: CornerRadius 10, px-2 py-0.5 text-[11px] font-semibold
```

### 2.2 RECENT INCIDENTS

`<SectionLabel>RECENT INCIDENTS</SectionLabel>`

Empty state: "No recent incidents."

**Incident card** — same layout as on `/dashboard/notifications` (Phase 3):
```
grid grid-cols-[1fr_auto] items-start gap-3

Col 0:
  Description   font-medium text-[13px]  line-clamp-2
  CreatedAt     text-[12px] text-secondary  dd MMM yyyy

Col 1 (severity badge):
  critical → bg-[#FEE2E2]
  high     → bg-[#FEF3C7]
  medium   → bg-[#DBEAFE]
  low/other→ bg-[#DCFCE7]
  text: text-primary text-[11px] font-semibold  CornerRadius 10 px-2 py-0.5
```

### 2.3 RECENT LEAVE REQUESTS

`<SectionLabel>RECENT LEAVE REQUESTS</SectionLabel>`

Empty state: "No recent leave requests."

**Leave card** (`CardFrame mb-1.5`):
```
grid grid-cols-[1fr_auto] items-center gap-3

Col 0:
  LeaveType    font-semibold text-[13px] text-primary
  StartDate    text-[12px] text-secondary  format: "dd MMM – "

Col 1 (status badge):
  approved → bg-[#DCFCE7]
  declined → bg-[#FEE2E2]
  pending  → bg-[#FEF3C7]
  text: text-primary text-[11px] font-semibold  CornerRadius 10 px-2 py-0.5
```

---

## §3 — `/dashboard/active-sessions`

**XAML:** `HrActiveSessionsPage.xaml`

### 3.1 Page header

```
grid grid-cols-[1fr_auto] items-center px-4 py-3
Left:  <h1>{title}</h1>   HeadlineMedium
Right: [Refresh] bg-surface-dark text-primary h-[40px] px-4 rounded-lg text-[13px] font-semibold
       disabled when isBusy
```

### 3.2 Error banner

```
{errorMessage && <p className="text-error text-[13px] mt-1 px-4">{errorMessage}</p>}
```

### 3.3 Empty state

Shown when `sessions.length === 0`:
```
flex flex-col items-center gap-2 mt-8
<p className="text-secondary text-sm">No active sessions</p>
<p className="text-secondary text-xs">All employees are signed out.</p>
```

### 3.4 Session cards

`flex flex-col gap-1` — one `CardFrame` per session:

```
CardFrame p-4

grid grid-rows-[auto_auto_auto] grid-cols-[1fr_auto] gap-x-3 gap-y-1

Row 0:
  Col 0: EmployeeName   text-sm font-["PoppinsSemiBold"]
  Col 1: LoginMethodDisplay  text-[11px] text-primary

Row 1 (spans both cols):
  "Signed in: " text-secondary text-[11px]  +  CreatedAt text-primary text-[11px]  (dd MMM yyyy HH:mm)
  "Expires: "   text-secondary text-[11px]  +  ExpiresAt text-secondary text-[11px]  (dd MMM yyyy HH:mm)

Row 2 (spans both cols, mt-1):
  [Revoke session]  bg-[#7F1D1D] text-[#FCA5A5] h-[36px] px-3 text-[12px] rounded-md
                    HorizontalOptions="Start" → w-fit
                    onClick → rpc('revoke_session', { session_id: sessionId })
```

---

## §4 — `/dashboard/assets`

**XAML:** `HrAssetsPage.xaml`

### 4.1 Page header

```
flex items-center justify-between px-4 py-3
Left:  <h1>Assets</h1>  HeadlineMedium
Right: [+ Asset] primary button
```

### 4.2 KPI banner

`CardFrame mx-4 mt-2 py-3 px-4` (matches `KpiCard` style):
```
<p className="text-sm text-accent">{warrantyExpiringSoon} warranties expiring in 30 days</p>
```
`text-accent` = `var(--color-accent)`.

### 4.3 Asset card list

`flex flex-col gap-2 px-4 mt-2` — one `CardFrame` per asset (clickable → edit modal):

```
CardFrame p-4

grid grid-cols-[1fr_auto] grid-rows-[auto_auto_auto] gap-x-2 gap-y-1

Row 0:
  Col 0: DisplayName    font-semibold text-[14px] text-primary
  Col 1: Status badge
    active  → bg-[#DCFCE7]
    retired → bg-[#F3F4F6]
    other   → bg-[#FEF3C7]
    text: text-primary text-xs  CornerRadius 8 px-2 py-0.5

Row 1:
  Col 0: AssetType  text-xs text-secondary
  Col 1: "S/N: {SerialNumber}"  text-xs text-secondary  (hidden if null)

Row 2:
  Col 0: Manufacturer  text-xs text-secondary  (hidden if null)
  Col 1: "Warranty: {WarrantyExpires:dd MMM yyyy}"  text-xs text-secondary  (hidden if null)
```

SwipeView Delete → web: [Delete] button inline in footer of edit modal (confirm dialog first).  
[+ Asset] and row click → open asset edit modal (inline on this page, not a separate route — MAUI uses shell navigation to a detail page but the spec defers a full asset detail route; implement as a slide-over modal).

---

## §5 — `/dashboard/reports`

**XAML:** `HrReportsView.xaml` (hosted by `HrReportsPage.xaml`)  
**'use client'** — tab switching is client-side.

### 5.1 Filter preset bar

```
flex flex-col gap-2 mb-2

<p className="text-xs text-secondary">{filterPeriodLabel}</p>

Horizontal scrollable row of secondary buttons (h-[32px] text-[11px] px-2.5):
  [7d]  [30d]  [Month]  [Year]  [↻ Refresh]
```

### 5.2 Category tab bar

Horizontally scrollable pill-tab bar inside a rounded container (`bg-surface-card border border-divider rounded-xl p-1`):

11 tabs — **Executive / Financial / Payroll / Workforce / Operational / Incidents / Inventory / Contractors / Property / Telemetry / Exports**

Active tab: `bg-[#3B82F6] text-white`  
Inactive tab: `bg-transparent text-[#6B7280]`

Each tab button: `text-sm px-3 py-1 rounded-lg whitespace-nowrap`

### 5.3 Tab content

Each tab is conditionally rendered (show active, hide others via `hidden` class).

---

#### Executive tab

**FINANCIAL section** — `grid grid-cols-2 gap-2.5`:
8 `<KpiTile>` components: Revenue / Outstanding / A/R / A/P / Payroll / VAT due / Cashflow / Profit est.
Each tile: Title + Value (R formatted) + Caption

**WORKFORCE section** — `grid grid-cols-3 gap-2`:
6 KPIs: Present / Late / Leave / Incidents / Active jobs / Overtime

**OPERATIONS & SYSTEM section** — `grid grid-cols-3 gap-2`:
6 KPIs: Completion / Projects / Inventory / Realtime / Offline Q / Errors

**Charts** (2):
- "Revenue trend" — Monthly bar/line chart using Recharts `<LineChart>` or `<BarChart>`
- "Attendance trend" — Clock-ins line chart

Chart container: `bg-surface-card border border-divider rounded-xl p-4 mt-4`; chart height 140px.  
Data fetched from `supabase.rpc('get_executive_report', { period_start, period_end })`.

---

#### Financial tab

4 KPIs (`grid grid-cols-2 gap-2.5`): Revenue / Outstanding / Payables / Profit

Charts (rendered with Recharts, height 160px):
- "Revenue vs expenses" — bar chart
- Aging/VAT summary — additional KPIs + simple table

Data: `supabase.rpc('get_financial_report', { period_start, period_end })`

---

#### Payroll tab

KPIs: Total gross / Total net / PAYE / UIF  
Table: payroll summary by period

Data: `supabase.rpc('get_payroll_report', { period_start, period_end })`

---

#### Workforce tab

KPIs: Headcount / Present today / On leave / Late this period  
Charts: Attendance trend, leave trend

Data: `supabase.rpc('get_workforce_report', { period_start, period_end })`

---

#### Operational tab

KPIs: Active jobs / Completed / On-time % / Overdue  
Chart: Job completion trend

Data: `supabase.rpc('get_operational_report', { period_start, period_end })`

---

#### Incidents tab

KPIs: Open / Resolved this period / By severity breakdown  
List of recent incidents (same card pattern as activity log)

Data: `supabase.rpc('get_incidents_report', { period_start, period_end })`

---

#### Inventory tab

KPIs: Total items / Low stock count / Stock value / Items on jobs  
Table: top items by value

Data: `supabase.rpc('get_inventory_report', { period_start, period_end })`

---

#### Contractors tab

KPIs: Active contractors / Pending compliance / Pending payments  
Table: contractor payment summary

Data: `supabase.rpc('get_contractors_report', { period_start, period_end })`

---

#### Property tab

KPIs: Total sites / Occupied units / Vacant / Expiring compliance  

Data: `supabase.rpc('get_property_report', { period_start, period_end })`

---

#### Telemetry tab

KPIs: Realtime status / Offline queue count / Error rate  
Simple key-value display.

Data: `supabase.rpc('get_telemetry_report', { period_start, period_end })`

---

#### Exports tab

List of export buttons:
- [Export P&L PDF] — `supabase.rpc('export_finance_pdf', {...})`
- [Export Payroll CSV]
- [Export Attendance CSV]
- [Export Inventory CSV]

Each renders as a secondary button with an icon (`download`). Response is a download URL or blob — trigger browser download.

---

## §6 — `/dashboard/scheduling`

**XAML:** `HrSchedulingPage.xaml`

### 6.1 Page header (bg-surface-dark section)

```
flex items-center justify-between px-4 py-3 bg-surface-dark
Left:  <h1>Scheduling</h1>  HeadlineMedium
Right: [+ Shift] primary button
       [Export]  secondary text button (ToolbarItem)
```

### 6.2 Date picker bar (bg-surface-dark, border-b border-divider)

```
px-4 py-2.5 flex items-center gap-3
<label className="text-xs font-medium text-secondary">Date:</label>
<FormDateInput value={selectedDate} onChange={...} format="EEEE, d MMMM yyyy" />
```

On date change → refetch events for that date.

### 6.3 Events list

`flex flex-col gap-2 p-4`

**Empty state:**
```
flex flex-col items-center gap-4 py-8
📅 emoji  text-[56px]
"No events scheduled"   EmptyState style
"Use the + Event button to add shifts, meetings or reminders"  text-secondary text-sm text-center
```

**Event card** (`CardFrame p-0 overflow-hidden`):
```
grid grid-cols-[4px_1fr] h-full

Col 0: colored bar  bg-primary  (4px wide, full height, CornerRadius 2)
Col 1: p-3
  Title      text-sm font-["PoppinsRegular"] BodyLarge style
  flex gap-2 items-center:
    StartTime  text-xs text-primary  (HH:mm)
    "–"        text-xs text-secondary
    EndTime    text-xs text-secondary  (HH:mm)
  Description  text-xs text-secondary mt-1  (hidden if null)
```

[+ Shift] → opens create-event modal/sheet:
- Title field
- Date (pre-filled with `selectedDate`)
- Start time / End time pickers
- Description textarea (optional)
- [Save] primary, [Cancel] secondary

---

## §7 — `/dashboard/team-punch`

**XAML:** `HrTeamPunchPage.xaml`  
**'use client'** — checkbox selection and clock-in/out require full interactivity.  
**Title:** "Team Clock In/Out"

### 7.1 Location bar (bg-surface-card, border-b border-divider)

```
flex items-center gap-2 px-4 py-2.5

Material icon  (location_on = )  text-primary text-[18px]
CurrentAddress  text-[12px] text-secondary  truncate flex-1
{isGettingLocation && <ActivityIndicator size="sm" />}
```

On web, location is obtained via `navigator.geolocation.getCurrentPosition()`. Reverse-geocode to display address (use a free geocoding API, or display coordinates if unavailable).

### 7.2 Controls card (`CardFrame mx-4 mt-3 p-3.5`)

**Team picker row** (`grid grid-cols-[1fr_auto] gap-2.5`):
```
Col 0: <FormSelect placeholder="Select a team…" options={teams} value={selectedTeam} onChange={...}
               className="bg-surface-elevated border-divider rounded-[10px]" />
Col 1: [+ Team]  bg-surface-elevated text-primary border border-primary h-[44px] px-3 text-[12px] rounded-[10px]
```

**Add members / select controls** (`grid grid-cols-[1fr_auto_auto_auto] gap-2 mt-2.5`):
```
[+ Add Members]  bg-surface-elevated text-primary border border-divider h-[34px] px-2.5 text-[12px] rounded-lg  w-auto
"{selectedCount} selected"  text-secondary text-[12px]  (hidden if !hasEmployees)
[All]   transparent text-primary text-[12px] h-[32px] px-2  (hidden if !hasEmployees)
[None]  transparent text-secondary text-[12px] h-[32px] px-2  (hidden if !hasEmployees)
```

**"Also clock me in/out" row** (`grid grid-cols-[auto_1fr] gap-2.5 mt-2 items-center`):
```
<input type="checkbox" checked={includeSelfInTeamPunch} className="accent-primary" />
<div>
  <p className="text-[13px] font-medium">Also clock me in/out</p>
  <p className="text-[11px] text-secondary">{managerSelfSummary}</p>
</div>
```

### 7.3 Employee list (`flex flex-col gap-1 px-4 mt-2 flex-1 overflow-y-auto`)

**Empty state:**
```
flex flex-col items-center gap-2 py-10
"No employees in this team yet."  EmptyState
[+ Add members to team]  TextButton text-[13px]
[Or create a new team →]  TextButton text-[13px]
```

**Employee punch row** (`CardFrame p-3.5 opacity-{rowOpacity}`):
```
grid grid-cols-[auto_48px_1fr_auto] gap-3 items-center

Col 0: <input type="checkbox" checked={isSelected} disabled={!canSelect} className="accent-primary" />

Col 1: Avatar circle  w-11 h-11 rounded-full bg-primary flex items-center justify-center
       <span className="font-semibold text-[15px] text-white">{employee.initials}</span>

Col 2: vertical stack
  FullName   font-medium text-[14px] text-primary
  Position   text-[11px] text-secondary  (hidden if null)

Col 3: vertical stack items-end
  Status badge: bg={statusBackgroundColor} text={statusColor}  text-[10px] font-semibold px-1.5 py-0.5 rounded-md
  LastPunchTime    text-[10px] text-secondary  (hidden if null)
  UnavailabilityNote  text-[10px] text-secondary  (hidden if null)
```

`rowOpacity` → `opacity-50` if `canSelect === false` (employee is on leave/unavailable), else full opacity.

### 7.4 Bottom action bar (fixed to bottom, bg-surface-dark, border-t border-divider)

```
px-4 py-3 grid grid-cols-2 gap-3

[Clock In {N} Selected]  bg-[#22C55E] text-white h-[50px] rounded-xl font-semibold text-[14px]
                          disabled if !canClockIn
[Clock Out {N} Selected] bg-[#EF4444] text-white h-[50px] rounded-xl font-semibold text-[14px]
                          disabled if !canClockOut
```

Button labels bound to `clockInButtonLabel` / `clockOutButtonLabel` (e.g. "Clock In 3 Selected").

---

## §8 — `/dashboard/properties`

**XAML:** `HrPropertiesPage.xaml`

### 8.1 Page header (bg-surface-dark)

```
flex items-center justify-between px-4 py-3 bg-surface-dark
Left:  <h1>Properties & Sites</h1>  HeadlineMedium
Right: [+] circular primary button  w-10 h-10 rounded-full text-[20px]
```

### 8.2 Expiring compliance banner

Shown when `expiringCompliance.count > 0`:
```
bg-[#FEE2E2] border-b border-error px-3 py-2
flex items-center gap-2
⚠  text-error text-[16px]
"{n} compliance item(s) expiring soon or overdue"  text-error text-sm
  — "{n}" in font-bold
```

### 8.3 Site card list

`flex flex-col gap-2 p-4` — one `CardFrame` per site, clickable → site detail:

```
CardFrame p-3

grid grid-cols-[auto_1fr_auto] gap-3 items-center

Col 0: Icon box  w-11 h-11 rounded-lg bg-primary flex items-center justify-center
       🏢 text-[18px]

Col 1: vertical stack gap-0.5
  Name     BodyLarge style (text-sm font-["PoppinsRegular"] or similar)
  Address  text-secondary text-xs  (hidden if null)
  "Radius: {RadiusMeters:0}m"  text-secondary text-[12px]
    — "Radius: " normal, value in font-bold

Col 2: GPS badge
  hasCoordinates → bg-[#DCFCE7] text-[#166534]  "GPS"
  !hasCoordinates→ bg-[#F3F4F6] text-[#6B7280]  "No GPS"
  text-[11px] font-bold px-2 py-1 rounded-xl
```

**Empty state:**
```
flex flex-col items-center gap-3 py-8
🏢 text-[48px]
"No properties yet"  EmptyState
"Add your first site to start tracking properties"  text-secondary text-sm text-center
```

[+] → opens create-site modal/sheet (name, address, radius, GPS coordinates).

---

## §9 — `/dashboard/residents`

**XAML:** `HrResidentsPage.xaml`

### 9.1 Page header (bg-surface-dark)

```
flex items-center justify-between px-4 py-3 bg-surface-dark
Left:  <h1>Residents & Units</h1>  HeadlineMedium
Right: flex gap-2
  [+ Resident]  primary  CornerRadius 16  text-[12px] px-3 py-2  (shown if activeTab === 'residents')
  [+ Unit]      primary  CornerRadius 16  text-[12px] px-3 py-2  (shown if activeTab === 'units')
```

### 9.2 Site picker bar (bg-surface-dark, border-b)

```
px-3 py-2 flex items-center gap-2
<label>Site:</label>
<FormSelect options={sites} value={selectedSite} onChange={...} placeholder="Select a site..." className="flex-1 bg-transparent border-none" />
```

### 9.3 Tab toggle (horizontal scroll)

`flex gap-2 px-2 py-2 overflow-x-auto` — three pill tabs:
- **Residents** / **Units** / **Compliance**

Active: `bg-[#3B82F6] text-white`  
Inactive: `bg-white text-[#6B7280]`  
Each: `CornerRadius 16 h-[32px] px-3 text-[12px] whitespace-nowrap`

### 9.4 Residents tab

Shown when `activeTab === 'residents'`.

**Resident card** (`CardFrame my-1`):
```
grid grid-cols-[auto_1fr_auto] gap-3 items-center

Col 0: Avatar circle  w-11 h-11 rounded-full bg-primary flex items-center justify-center
       Initials  text-[16px] font-bold text-white  (first letter of Name)

Col 1: vertical stack
  FullName    BodyLarge
  Phone       text-secondary text-xs  (hidden if null)
  "Moved in: {MoveInDate:dd MMM yyyy}"  text-secondary text-xs  (hidden if null)

Col 2: Status badge
  isCurrentResident → bg-[#DCFCE7] text-[#166534]  "Active"
  !isCurrentResident→ bg-[#F3F4F6] text-[#6B7280]  "Moved Out"
  text-[11px] font-bold px-2 py-1 rounded-xl
```

Empty state: 👥 emoji + "No residents found."

### 9.5 Units tab

Shown when `activeTab === 'units'`.

**Unit card** (`CardFrame my-1`):
```
grid grid-cols-[1fr_auto] items-center

Col 0: vertical stack
  DisplayName  BodyLarge
  UnitType     text-secondary text-xs  (hidden if null)

Col 1: Occupancy badge
  isOccupied → bg-[#DCFCE7] text-[#166534]  "Occupied"
  !isOccupied→ bg-[#F3F4F6] text-[#6B7280]  "Vacant"
  text-[11px] font-bold px-2 py-1 rounded-xl
```

Empty state: "No units found."

### 9.6 Compliance tab

Shown when `activeTab === 'compliance'`.

**Compliance card** (`CardFrame my-1`):
```
grid grid-cols-[1fr_auto] items-start

Col 0: vertical stack
  Title     BodyLarge
  Category  text-secondary text-xs
  "Expires: {ExpiryDate:dd MMM yyyy}"  text-secondary text-xs  (hidden if null)

Col 1: Status badge
  bg-surface-dark text-primary text-[11px] font-bold px-2 py-0.5 rounded-[10px]
  Text: {Status}
```

Empty state: "No compliance items."

---

## §10 — `/dashboard/employees/import`

**XAML:** `HrImportEmployeesPage.xaml`  
**'use client'** — file picking and preview state are client-side.  
**Title:** "Import Employees"

Layout: `Grid RowDefinitions="*,Auto"` → scrollable content area + sticky import button at bottom.

### 10.1 STEP 1 — DOWNLOAD TEMPLATE card

```
CardFrame

STEP 1 — DOWNLOAD TEMPLATE  <SectionLabel>
"Download the blank Excel template, fill in your employees, then import the file."  text-secondary text-sm
{defaultTemplateHint && <p className="text-xs text-secondary">{defaultTemplateHint}</p>}

[📥  Download Blank Template]
  bg-primary text-white font-semibold rounded-[10px] h-[46px] full-width
  onClick → call rpc or download a pre-built .xlsx template file
```

### 10.2 STEP 2 — SELECT YOUR FILE card

```
CardFrame

STEP 2 — SELECT YOUR FILE  <SectionLabel>
"Select your completed .xlsx file — use our template or your own spreadsheet with similar column names (Name, Surname, ID Number, Access Level, etc.)."  text-secondary text-sm

[📂  Browse File]
  bg-surface-elevated text-primary border border-divider rounded-[10px] h-[46px] full-width
  onClick → <input type="file" accept=".xlsx,.xls" hidden ref={fileInputRef} />; trigger fileInputRef.current.click()
  On file selected → parse client-side with SheetJS (already available in kaisync-web)
```

### 10.3 Error banner

Shown when `errorMessage` is non-null:
```
bg-[#FEE2E2] border border-[#FCA5A5] rounded-[10px] px-3.5 py-2.5
<p className="text-error font-medium text-[13px]">{errorMessage}</p>
```

### 10.4 Parse warnings banner

Shown when `parseWarnings.length > 0`:
```
bg-[#EFF6FF] border border-[#93C5FD] rounded-[10px] px-3.5 py-2.5
NOTES  text-[11px] font-semibold text-[#1D4ED8]
{parseWarnings.map(w => <p className="text-[11px] text-[#1E40AF]">{w}</p>)}
```

### 10.5 Parse errors banner

Shown when `parseErrors.length > 0`:
```
bg-[#FEF3C7] border border-[#FCD34D] rounded-[10px] px-3.5 py-2.5
ROWS SKIPPED OR ISSUES  text-[11px] font-semibold text-[#92400E]
{parseErrors.map(e => <p className="text-[11px] text-[#B45309]">{e}</p>)}
```

### 10.6 STEP 3 — PREVIEW card

Shown when `showPreview === true` (file parsed successfully):

```
CardFrame

grid grid-cols-[1fr_auto]:
  Left:  STEP 3 — PREVIEW  <SectionLabel>
  Right: PreviewSummary  text-xs text-primary

MappingSummary  text-xs text-secondary  (hidden if null)

Preview employee list (vertical stack gap-1.5):
  Each employee row: bg-surface-elevated border border-divider rounded-lg px-3 py-2
  
  grid grid-cols-[1fr_auto]
  Col 0: vertical stack
    FullName    font-medium text-[13px] text-primary
    flex gap-2:
      Email           text-[11px] text-secondary  (fallback "No email")
      Position        text-[11px] text-secondary  (hidden if null)
      "· {template}"  text-[11px] text-primary   (hidden if null)
  Col 1: EmploymentType badge  bg-[#DCFCE7] text-[#166534] text-[10px] rounded-md px-1.5 py-0.5
```

### 10.7 Sticky import button (bottom bar)

Shown when `hasPreview === true`:
```
px-4 py-2 bg-background-dark border-t border-divider (sticky bottom-0)

[Import {n} Employee(s)]
  bg-[#16A34A] text-white font-["PoppinsBold"] text-[16px] h-[52px] rounded-xl full-width
  onClick → supabase.rpc('import_employees', { employees: preview })
```

ActivityIndicator overlay shown when `isBusy`.

---

## §11 — `/dashboard/payroll/settings`

**XAML:** `HrPayrollSettingsPage.xaml`  
**'use client'** — all fields are editable.

### 11.1 Intro card

```
CardFrame
PAYROLL ENGINE  <SectionLabel>
"Configure how payslips are calculated, taxed, and released. These settings apply company-wide."
text-secondary text-xs
```

### 11.2 PAY CALCULATION card

`<SectionLabel>PAY CALCULATION</SectionLabel>`

Settings grid (`grid grid-cols-[1fr_auto] items-center gap-y-2`):

| Label | Control |
|-------|---------|
| Default pay basis | `<FormSelect options={payBasisOptions} value={payrollDefaultPayBasis} w-[140px]>` |
| Default hourly rate (R) | `<input type="number" className="w-[80px] text-right DarkEntry">` |
| OT multiplier | `<input type="number" step="0.1" className="w-[80px] text-right DarkEntry">` |
| Daily OT threshold (hrs) | `<input type="number" className="w-[80px] text-right DarkEntry">` |
| OT for salary staff | `<Switch>` |
| Full salary for mid-month joiners | `<Switch>` |
| Pay salary on public holidays | `<Switch>` |
| Pay hourly on public holidays | `<Switch>` |

### 11.3 TIME & ATTENDANCE card

`<SectionLabel>TIME & ATTENDANCE</SectionLabel>`  
Caption: "Used when building sessions and calculating late/OT for payroll."

Settings grid:

| Label | Control |
|-------|---------|
| Sign-in grace period (minutes) | `<input type="number" w-[80px] DarkEntry text-right>` |
| OT starts after (minutes past shift end) | `<input type="number" w-[80px] DarkEntry text-right>` |
| Deduct absent days from pay | `<Switch>` |
| Salary staff: ignore attendance penalties | `<Switch>` |

Below grid:
```
[Manage Time Templates]
  bg-surface-dark text-primary rounded-lg text-[13px] px-3.5 py-2.5
  → navigate('/dashboard/time-templates')
```

### 11.4 ATTENDANCE PENALTIES card

`<SectionLabel>ATTENDANCE PENALTIES</SectionLabel>`

Settings grid — 6 rows:

| Label | Control |
|-------|---------|
| Absent penalty mode | `<FormSelect options={penaltyModeOptions} w-[140px]>` |
| Absent threshold / deduct days | Two `w-[50px]` numeric inputs side-by-side |
| Late penalty mode | `<FormSelect options={penaltyModeOptions} w-[140px]>` |
| Late threshold / deduct hrs | Two `w-[50px]` numeric inputs |
| Early penalty mode | `<FormSelect options={penaltyModeOptions} w-[140px]>` |
| Early threshold / deduct hrs | Two `w-[50px]` numeric inputs |

### 11.5 STATUTORY & TAX (SARS) card

`<SectionLabel>STATUTORY & TAX (SARS)</SectionLabel>`

Settings grid — 6 rows:

| Label | Control |
|-------|---------|
| UIF enabled | `<Switch>` |
| UIF rate % / ceiling (R) | Two inputs: `w-[50px]` + `w-[80px]` side-by-side |
| PAYE enabled | `<Switch>` |
| Default PAYE rate (%) | `<input type="number" w-[80px] DarkEntry text-right>` |
| Use SARS PAYE tax tables | `<Switch>` |
| Caption spanning both cols | "When SARS tables are on, employee DOB and tax directive on their profile drive PAYE. Otherwise use employee PAYE rate/fixed or default % above." text-xs text-secondary |

### 11.6 PAYSLIPS & RELEASE card

`<SectionLabel>PAYSLIPS & RELEASE</SectionLabel>`

Settings grid — 3 rows:

| Label | Control |
|-------|---------|
| Payslip release day (0 = manual) | `<input type="number" w-[80px] DarkEntry text-right placeholder="25">` |
| Auto-release on release day | `<Switch>` |
| Public holidays (yyyy-MM-dd, comma-separated) | `<input type="text" w-[160px] DarkEntry>` |

### 11.7 Footer

```
{errorMessage && <p className="text-error text-center text-sm">{errorMessage}</p>}
[Save Payroll Settings]  primary button  full-width  disabled when isBusy
{isBusy && <ActivityIndicator className="mx-auto" />}
```

---

## §12 — `/dashboard/jobs/[id]/contractor-docs`

**XAML:** `HrJobContractorDocsPage.xaml`

This page is accessed from a job detail — it shows documents uploaded for a specific contractor assignment on a job. The route is nested under jobs.

### 12.1 Page header

Title: `{pageTitle}` (e.g. "Contractor Documents")  
Subtitle: `{subTitle}` — job title (text-secondary text-[13px], hidden if null)

Error banner: `text-[#FCA5A5] text-[13px] font-semibold` (hidden if null)

### 12.2 ASSIGNMENT DOCUMENTS card

**Card header row** (`grid grid-cols-[1fr_auto_auto] gap-2 items-center`):
```
Left:  ASSIGNMENT DOCUMENTS  <SectionLabel>
Mid:   {isDocsBusy && <ActivityIndicator size="sm" />}
Right: [Upload]  primary  text-[12px] h-[36px] px-3.5  disabled when isDocsBusy
```

**Document type picker** (`flex items-center gap-2`):
```
<label className="text-[12px] text-secondary">Type:</label>
<FormSelect options={documentTypeLabels} value={selectedDocTypeLabel} onChange={...} className="flex-1 bg-transparent" />
```

**Divider** `<hr className="border-divider" />`

**Documents list** (`flex flex-col gap-0`):

Empty state: "No documents uploaded yet."

**Document row** (`grid grid-cols-[30px_1fr_auto_auto] gap-2 py-1.5 items-center`):
```
Col 0: TypeIcon  text-[18px]  (emoji or material icon from document type)
Col 1: vertical stack gap-0.5
  DocumentName  font-semibold text-[13px] text-primary  truncate
  TypeLabel     text-[11px] text-primary
  CreatedDisplay text-[10px] text-secondary
Col 2: [Open]   outlined button  text-[11px] h-[32px] px-2.5
Col 3: [✕]      bg-transparent text-secondary text-[12px] w-9 h-8 p-0
```

[Upload] → opens file picker; uploads to `workforce-media` bucket, inserts record into `job_contractor_documents`.  
[Open] → fetches signed URL from `workforce-media` bucket and opens in new tab.  
[✕] → confirm dialog → deletes from storage + DB.

---

## New shared components in this phase

None — all patterns reuse existing components. The only new pattern is the two-pane reports view, which is self-contained within `/dashboard/reports/page.tsx`.

---

## Data / Supabase notes

### Suppliers
- `supabase.from('contractors').select('*').eq('is_supplier', true)` — suppliers are a subset of the contractors table
- Detail → existing `/dashboard/contractors/[id]` page

### Activity Log
- `supabase.from('attendance_sessions').select('*, employee:employees(full_name)').order('created_at', desc).limit(50)` — recent punches
- `supabase.from('incident_reports').select('*').order('created_at', desc).limit(20)` — recent incidents
- `supabase.from('leave_requests').select('*, employee:employees(full_name)').order('created_at', desc).limit(20)` — recent leave

### Active Sessions
- `supabase.from('employee_sessions').select('*, employee:employees(full_name)').eq('is_active', true)`
- Revoke: `supabase.rpc('revoke_employee_session', { session_id })`

### Assets
- `supabase.from('assets').select('*').order('created_at', desc)`
- Upsert: `supabase.from('assets').upsert({...})`
- Delete: `supabase.from('assets').delete().eq('id', id)`
- `warrantyExpiringSoon`: count assets where `warranty_expires` is within 30 days

### Reports
- All data via RPCs per tab: `get_executive_report`, `get_financial_report`, `get_payroll_report`, `get_workforce_report`, `get_operational_report`, `get_incidents_report`, `get_inventory_report`, `get_contractors_report`, `get_property_report`, `get_telemetry_report`
- Period calculated from preset: 7d = last 7 days; 30d = last 30 days; month = current calendar month; year = current tax year
- Export RPCs return `{ download_url: string }` — open in new tab

### Scheduling
- `supabase.from('calendar_events').select('*').eq('date', selectedDate.toISOString().split('T')[0])`
- Create: `supabase.from('calendar_events').insert({...})`
- Export: `supabase.rpc('export_schedule', { date: selectedDate })`

### Team Punch
- `supabase.from('work_teams').select('*, members:work_team_members(*, employee:employees(full_name, position, initials))')` 
- Clock in: `supabase.rpc('team_clock_in', { employee_ids: [...], location: { lat, lng }, address })`
- Clock out: `supabase.rpc('team_clock_out', { employee_ids: [...], location: { lat, lng }, address })`

### Properties
- `supabase.from('sites').select('*')`
- Expiring compliance: `supabase.from('site_compliance').select('*').lte('expiry_date', thirtyDaysFromNow)`
- Create/edit site: `supabase.from('sites').upsert({...})`

### Residents
- `supabase.from('residents').select('*').eq('site_id', selectedSite?.id)`
- `supabase.from('units').select('*').eq('site_id', selectedSite?.id)`
- `supabase.from('site_compliance').select('*').eq('site_id', selectedSite?.id)`

### Import Employees
- Download template: `supabase.rpc('get_employee_import_template_url')` → signed URL
- Parse client-side with SheetJS (`import * as XLSX from 'xlsx'` — already in kaisync-web)
- Import: `supabase.rpc('import_employees', { rows: parsedRows })`

### Payroll Settings
- Load: `supabase.from('payroll_settings').select('*').single()`
- Save: `supabase.from('payroll_settings').upsert({...})`

### Contractor Docs
- `supabase.from('job_contractor_documents').select('*').eq('job_id', jobId).eq('contractor_id', contractorId)`
- Upload: `supabase.storage.from('workforce-media').upload(path, file)` + insert into `job_contractor_documents`
- Open: `supabase.storage.from('workforce-media').createSignedUrl(path, 300)` → open in new tab
- Delete: delete from storage + `supabase.from('job_contractor_documents').delete().eq('id', id)`

---

## TypeScript types to add to `lib/database.ts`

```typescript
// Suppliers — reuses existing Contractor type (is_supplier: true)

// Activity Log
export interface PunchActivity {
  id: string
  employee_id: string
  employee_name: string
  date_time: string
  type_label: 'Clock In' | 'Clock Out'
  address: string | null
}

// Active Sessions
export interface ActiveSession {
  session_id: string
  employee_id: string
  employee_name: string
  login_method_display: string
  created_at: string
  expires_at: string
}

// Assets
export interface Asset {
  id: string
  display_name: string
  asset_type: string | null
  serial_number: string | null
  manufacturer: string | null
  warranty_expires: string | null  // ISO date
  status_raw: 'active' | 'retired' | string
}

// Scheduling
export interface CalendarEvent {
  id: string
  title: string
  start_time: string   // ISO datetime
  end_time: string     // ISO datetime
  description: string | null
  date: string         // YYYY-MM-DD
}

// Team Punch
export interface EmployeePunchRow {
  employee_id: string
  employee: {
    full_name: string
    position: string | null
    initials: string
  }
  is_selected: boolean
  can_select: boolean
  status_label: string
  status_background_color: string
  status_color: string
  last_punch_time: string | null
  unavailability_note: string | null
  row_opacity: number  // 1 or 0.5
}

// Properties / Sites
export interface Site {
  id: string
  name: string
  address: string | null
  radius_meters: number
  has_coordinates: boolean
  latitude: number | null
  longitude: number | null
}

// Residents
export interface Resident {
  id: string
  full_name: string
  name: string
  phone: string | null
  move_in_date: string | null
  is_current_resident: boolean
}

export interface Unit {
  id: string
  display_name: string
  unit_type: string | null
  is_occupied: boolean
}

export interface SiteComplianceEntry {
  id: string
  title: string
  category: string
  expiry_date: string | null
  status: string
}

// Import Employees — reuses existing Employee type

// Payroll Settings
export interface PayrollSettings {
  id: string
  payroll_default_pay_basis: string
  default_hourly_rate: number
  overtime_multiplier: number
  overtime_threshold_hours: number
  allow_overtime_for_salary: boolean
  pay_full_salary_for_mid_month_joiners: boolean
  pay_salary_on_public_holidays: boolean
  pay_hourly_on_public_holidays: boolean
  late_threshold_minutes: number
  ot_start_after_minutes: number
  deduct_absent_from_pay: boolean
  salary_ignore_attendance_deductions: boolean
  absent_penalty_mode: string
  absent_penalty_threshold: number
  absent_penalty_deduct_days: number
  late_penalty_mode: string
  late_penalty_threshold: number
  late_penalty_deduct_hours: number
  early_penalty_mode: string
  early_penalty_threshold: number
  early_penalty_deduct_hours: number
  uif_enabled: boolean
  uif_rate_percent: number
  uif_ceiling_monthly: number
  paye_enabled: boolean
  default_paye_rate_percent: number
  use_sars_tax_tables: boolean
  payslip_release_day: number
  auto_release_payslips_on_release_day: boolean
  public_holidays_text: string
}

// Contractor Docs (job assignment)
export interface JobContractorDocument {
  id: string
  job_id: string
  contractor_id: string
  document_name: string
  type_label: string
  type_icon: string
  storage_path: string
  created_display: string
}
```

---

## Verification checklist for engineers

- [ ] `/dashboard/suppliers` — 900px table, 5 cols; row click navigates to existing contractor detail; empty state correct
- [ ] `/dashboard/activity-log` — 3 sections; punch badge: "Clock In" = green, "Clock Out" = red; leave badge: approved/declined/pending correct colours
- [ ] `/dashboard/active-sessions` — Revoke button: bg-`#7F1D1D` text-`#FCA5A5`; dates formatted dd MMM yyyy HH:mm; empty state shown when no sessions
- [ ] `/dashboard/assets` — KPI banner uses `text-accent`; status badges: active=`#DCFCE7`, retired=`#F3F4F6`, other=`#FEF3C7`; Delete via confirm dialog
- [ ] `/dashboard/reports` — 11 tabs in horizontal scroll bar; active = `bg-[#3B82F6] text-white`; Executive tab renders 20 KPI tiles across 3 grids; Recharts charts render without errors
- [ ] `/dashboard/scheduling` — Date picker bar on bg-surface-dark; event card has 4px primary color bar; empty state shows 📅 emoji
- [ ] `/dashboard/team-punch` — Location bar at top; [All]/[None] buttons hidden when no employees; Clock In = `#22C55E`, Clock Out = `#EF4444`; bottom bar is sticky; checkbox accent-primary
- [ ] `/dashboard/properties` — bg-surface-dark header; expiring banner bg-`#FEE2E2`; GPS badge correct colours; 🏢 icon box bg-primary
- [ ] `/dashboard/residents` — 3 tabs; [+ Resident] shown only on Residents tab, [+ Unit] only on Units tab; initials avatar bg-primary; Active/Moved Out badge correct; Occupied/Vacant badge correct
- [ ] `/dashboard/employees/import` — SheetJS parsing; error/warning/notes banners display correctly; sticky import button at bottom; import count in button label
- [ ] `/dashboard/payroll/settings` — All 5 cards rendered; penalty pairs (threshold + deduct) render two inputs side-by-side; [Manage Time Templates] navigates to `/dashboard/time-templates`; Save button disabled when busy
- [ ] `/dashboard/jobs/[id]/contractor-docs` — [Upload] button disabled when isDocsBusy; doc row: icon + name + type + date + Open + ✕; Open fires signed URL; ✕ requires confirm
- [ ] TypeScript build: 0 errors across all routes
