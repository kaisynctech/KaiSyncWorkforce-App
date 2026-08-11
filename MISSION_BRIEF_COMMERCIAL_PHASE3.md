# MISSION BRIEF — Commercial Engine Phase 3: Project Financials
## For Claude Code | KaiSync Workforce App

---

## CRITICAL CONSTRAINTS
- **Never break existing project pages** — only ADD new tabs and components
- **Existing project tabs** are: details, docs, quotation, pipeline, payments, activity — keep all of these untouched
- **`client_deals` IS the projects table** — always use this table, never rename it
- **`projects.financials` permission** gates all cost/margin data — never show cost or margin to roles without it
- **`complete_milestone` RPC** handles all milestone completion side-effects — don't replicate this logic in the UI

---

## STEP 0 — Apply Migration

```
Tool: apply_migration
Project: vcivtjwreybaxgtdhtou
File: supabase/migrations/20260811000200_commercial_engine_phase3.sql
```

Verify after applying:
- `project_milestones` table exists
- `project_cost_entries` table exists
- `project_financial_summary` view exists
- `finance_invoices.milestone_id` column exists
- `complete_milestone` function exists
- `sync_project_costs` function exists

---

## TYPESCRIPT TYPES

Add to `/types/commercial.ts`:

```typescript
// ─── Project Milestones ───────────────────────────────────────────────────────
export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface ProjectMilestone {
  id: string
  company_id: string
  deal_id: string
  sort_order: number
  name: string
  description: string | null
  due_date: string | null
  completion_date: string | null
  invoice_amount: number
  invoice_percentage: number
  triggers_invoice: boolean
  invoice_id: string | null
  is_retention_release: boolean
  status: MilestoneStatus
  completed_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ─── Project Cost Entries ─────────────────────────────────────────────────────
export type CostType = 'estimated' | 'committed' | 'actual'
export type CostCategory = 'labour' | 'materials' | 'subcontract' | 'equipment' | 'overhead' | 'other'
export type CostSource = 'manual' | 'purchase_order' | 'supplier_invoice' | 'quote_estimate'

export interface ProjectCostEntry {
  id: string
  company_id: string
  deal_id: string
  cost_type: CostType
  category: CostCategory
  source: CostSource
  source_id: string | null
  source_reference: string | null
  description: string
  quantity: number
  unit_cost: number
  total_cost: number
  cost_date: string
  notes: string | null
  created_at: string
}

// ─── Project Financial Summary (from view) ────────────────────────────────────
export interface ProjectFinancialSummary {
  deal_id: string
  company_id: string
  title: string
  status: string
  contract_type: string
  contract_value: number
  budget_amount: number
  estimated_cost: number
  committed_cost: number
  actual_cost: number
  retention_percent: number
  retention_amount_held: number
  retention_released_at: string | null
  total_invoiced: number
  total_received: number
  invoice_count: number
  outstanding_balance: number
  estimated_cost_entries: number
  committed_cost_entries: number
  actual_cost_entries: number
  total_po_value: number
  total_po_received: number
  total_supplier_invoiced: number
  total_supplier_paid: number
  total_milestones: number
  completed_milestones: number
  invoiced_milestones: number
  best_actual_cost: number
  gross_profit: number
  gross_margin_percent: number
  estimated_budget_variance: number
  actual_budget_variance: number
}
```

---

## SECTION 1 — Milestones Tab (on Project Detail Page)

### Location
File: `/src/app/dashboard/projects/[id]/page.tsx`

**Add `'milestones'` to the PROJECT_TABS array** (between `'pipeline'` and `'payments'`):
```typescript
const PROJECT_TABS = ['details', 'docs', 'quotation', 'pipeline', 'milestones', 'payments', 'activity']
const TAB_LABELS: Record<string, string> = {
  ...existing,
  milestones: 'Milestones',
}
```

**Create a `ProjectMilestonesTab` component** at `/src/components/ProjectMilestonesTab.tsx`.

### Component: `ProjectMilestonesTab`

Props:
```typescript
interface Props {
  dealId: string
  companyId: string
  contractValue: number  // deal.offer_amount — for percentage calculations
  canEdit: boolean
}
```

**Layout:**

Header: "Project Milestones" title + "Add Milestone" button (canEdit only)

**Milestone list** — each row is a card:
```
[drag handle] [status indicator] [name] [due date] [invoice amount / %] [status badge] [actions]
```

Status indicator dot colours:
- pending = gray
- in_progress = blue
- completed = green
- cancelled = red/strikethrough

**Status badge** — same colour scheme as above.

**"Invoice" chip** (amber) — shown if `triggers_invoice = true` + invoice_amount > 0. Shows "Invoices R {amount}" or "Invoices {%}% of contract".

**Retention badge** (purple) — shown if `is_retention_release = true`. Shows "Retention Release".

**Linked invoice chip** (green) — shown if `invoice_id` is set. Shows "INV created" with link to `/money/invoices/{invoice_id}`.

**Actions per milestone (canEdit only):**
- Edit (opens drawer)
- Mark Complete → shows confirm dialog (below)
- Delete (only if status = 'pending')

**Milestone completion confirm dialog:**
```
Title: "Complete milestone: {name}"
Body: 
  If triggers_invoice AND invoice_amount > 0:
    "This will mark the milestone complete and create a draft invoice for R {amount}."
    Checkbox: "Create invoice now" (default checked)
  Else:
    "Mark this milestone as complete?"
  
Buttons: Cancel | Mark Complete
```

On confirm: call `complete_milestone` RPC:
```typescript
const { data } = await supabase.rpc('complete_milestone', {
  p_milestone_id: milestone.id,
  p_create_invoice: createInvoice,
  p_invoice_due_days: 30,
})
// data = { milestone_id, invoice_id, invoice_amount }
// If invoice_id is not null: show success toast with link to the invoice
```

**Retention Release milestone** — when `is_retention_release = true` and user clicks "Mark Complete":
- Show extra confirmation: "This will release the retention of R {retention_amount_held} and create a retention invoice."

**Add/Edit Milestone Drawer:**
```
Name (required)
Description
Due Date (date picker)
Triggers Invoice toggle
  → If on: Invoice Amount field OR Invoice % of contract (radio)
     Invoice % shows live calculation: "{%}% of R{contract_value} = R{calculated}"
Is Retention Release toggle (only one milestone can have this; warn if another already has it)
Notes
```

**Progress bar** at top of milestones tab:
```
{completed} of {total} milestones complete  [=====>----] {percent}%
```

---

## SECTION 2 — Financials Tab (on Project Detail Page)

### Gate: `projects.financials` permission

If user lacks `projects.financials` — show a locked state:
```
🔒 Financial data is restricted to Owners and Administrators.
```

### Add `'financials'` to PROJECT_TABS (after `'milestones'`):
```typescript
const PROJECT_TABS = ['details', 'docs', 'quotation', 'pipeline', 'milestones', 'financials', 'payments', 'activity']
```

**Create a `ProjectFinancialsTab` component** at `/src/components/ProjectFinancialsTab.tsx`.

Props:
```typescript
interface Props {
  dealId: string
  companyId: string
  canViewFinancials: boolean
}
```

### Data source:
```typescript
const { data: summary } = await supabase
  .from('project_financial_summary')
  .select('*')
  .eq('deal_id', dealId)
  .single()
```

### Layout — 3 sections:

**Section A: Revenue Summary**

4 KPI tiles (same style as existing KpiTile component):
- Contract Value: `summary.contract_value`
- Total Invoiced: `summary.total_invoiced`
- Received: `summary.total_received`
- Outstanding: `summary.outstanding_balance` (red if > 0)

**Section B: Cost & Profitability**

2-column grid of tiles:
- Estimated Cost: `summary.estimated_cost || summary.estimated_cost_entries` (whichever > 0)
- Committed (POs): `summary.total_po_value`
- Actual Cost: `summary.best_actual_cost`
- Gross Profit: `summary.gross_profit` (green if positive, red if negative)
- Margin %: `summary.gross_margin_percent`% (colour: green ≥ 20%, amber 10–20%, red < 10%)

**Budget Variance bar** (show only if `budget_amount > 0`):
```
Budget: R{budget_amount}  |  Spent: R{best_actual_cost}  |  Variance: ±R{actual_budget_variance}
[progress bar: spent / budget, red if over budget]
```

**Retention panel** (show only if `retention_percent > 0`):
```
Retention: {retention_percent}%  |  Held: R{retention_amount_held}
Released: {retention_released_at ? date : 'Not yet released'}
[Release Retention button — only if canEdit AND retention_released_at is null]
```

Release Retention button opens a confirmation modal:
- "Release R{retention_amount_held} retention for this project?"
- On confirm: find the `is_retention_release = true` milestone and call `complete_milestone` RPC

**Section C: Cost Entries**

Table of `project_cost_entries` filtered to this deal:
- Columns: Date | Category | Type | Description | Source | Amount
- Source pill: manual=gray, purchase_order=blue, supplier_invoice=amber, quote_estimate=purple
- Type pill: estimated=gray, committed=amber, actual=green
- "Add Cost Entry" button (opens drawer)

**Add Cost Entry Drawer:**
```
Cost Type: estimated | committed | actual (radio)
Category: labour | materials | subcontract | equipment | overhead | other (select)
Description (required)
Quantity (default 1)
Unit Cost (required)
Total Cost (calculated = qty × unit_cost, shown read-only)
Date (date picker, default today)
Source Reference (optional, e.g. "PO-2026-0012")
Notes
```

On save:
```typescript
await supabase.from('project_cost_entries').insert({
  company_id: companyId,
  deal_id: dealId,
  cost_type,
  category,
  source: 'manual',
  description,
  quantity,
  unit_cost,
  total_cost: quantity * unit_cost,
  cost_date,
  notes,
  source_reference,
})
// Then call sync_project_costs to update client_deals.actual_cost
await supabase.rpc('sync_project_costs', { p_deal_id: dealId })
```

---

## SECTION 3 — Project Profitability Report Page

### Page: `/dashboard/reports/project-profitability`

Check if a reports section already exists at `/dashboard/reports/`. If yes, add this as a new route. If no, create the layout.

**Page layout:**

Header: "Project Profitability"

**Filters:**
- Date range (site_start_date between)
- Status filter (multi-select: in_progress, won)
- Contract type filter (fixed_price, cost_plus, time_and_material)

**KPI summary row** (aggregated across filtered projects):
- Total Contract Value
- Total Invoiced
- Total Cost
- Average Margin %

**Profitability table** — one row per project:

| Project | Client | Contract Value | Invoiced | Actual Cost | Gross Profit | Margin % | Status |
|---|---|---|---|---|---|---|---|

Data query:
```typescript
const { data } = await supabase
  .from('project_financial_summary')
  .select(`
    deal_id, title, status, contract_type,
    contract_value, total_invoiced, best_actual_cost,
    gross_profit, gross_margin_percent,
    total_received, outstanding_balance,
    client:clients(name)
  `)
  // NOTE: project_financial_summary doesn't JOIN clients — need to join via client_deals
  .eq('company_id', companyId)
  .in('status', ['in_progress', 'won'])
  .order('gross_margin_percent', { ascending: true }) // worst margin first
```

**Alternative if view doesn't support nested joins**: query `project_financial_summary` then fetch client names separately from `client_deals`.

```typescript
// Correct approach — query the view then join client names
const { data: summaries } = await supabase
  .from('project_financial_summary')
  .select('*')
  .eq('company_id', companyId)

const dealIds = summaries.map(s => s.deal_id)
const { data: deals } = await supabase
  .from('client_deals')
  .select('id, client_id, clients(id, name)')
  .in('id', dealIds)

// Merge client name into summaries
```

**Margin colour coding in table:**
- ≥ 20% → green text
- 10–19% → amber text
- < 10% → red text
- Negative → bold red

**Row click** → navigates to `/dashboard/projects/{deal_id}?tab=financials`

**Gate**: Check `reports.view_financial` permission. If user lacks it, show locked state.

---

## SECTION 4 — Sync Project Costs (Auto-wire POs and Supplier Invoices)

When a **purchase order** status changes to `approved` or `sent`, call `sync_project_costs`:
```typescript
// In the PO detail page, after updating status:
if (newStatus === 'approved' || newStatus === 'sent') {
  if (po.deal_id) {
    await supabase.rpc('sync_project_costs', { p_deal_id: po.deal_id })
  }
}
```

When a **supplier invoice** is marked as paid:
```typescript
// In supplier invoice detail page, after payment recording:
if (invoice.project_id) {
  await supabase.rpc('sync_project_costs', { p_deal_id: invoice.project_id })
}
```

---

## BUILD ORDER

```
1. Apply migration (Step 0) — verify all objects exist
2. Add TypeScript types to /types/commercial.ts
3. ProjectMilestonesTab component
4. ProjectFinancialsTab component  
5. Add both tabs to /projects/[id]/page.tsx
6. Project profitability page at /reports/project-profitability
7. Wire sync_project_costs calls in PO and supplier invoice pages
8. TypeScript clean build, no regressions
```

---

## KEY PATTERNS

**Permission check — financials gate:**
```typescript
const { data: canViewFinancials } = await supabase.rpc('user_has_permission', {
  p_company_id: companyId,
  p_key: 'projects.financials'
})
```

**Complete milestone RPC:**
```typescript
const { data, error } = await supabase.rpc('complete_milestone', {
  p_milestone_id: milestoneId,
  p_create_invoice: true,
  p_invoice_due_days: 30
})
// Returns: { milestone_id, invoice_id, invoice_amount }
```

**Sync project costs:**
```typescript
await supabase.rpc('sync_project_costs', { p_deal_id: dealId })
```

**Query project financial summary:**
```typescript
const { data: summary } = await supabase
  .from('project_financial_summary')
  .select('*')
  .eq('deal_id', dealId)
  .single()
```

**Currency formatting (match existing pattern in codebase):**
```typescript
const fmtCurrency = (n: number) =>
  `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`
```

---

## DELIVERABLES CHECKLIST

- [ ] Migration applied, all DB objects verified
- [ ] TypeScript types added
- [ ] `ProjectMilestonesTab` — list, add/edit drawer, completion flow with invoice creation
- [ ] `ProjectFinancialsTab` — revenue tiles, cost tiles, margin display, retention panel, cost entries table
- [ ] Both tabs added to `/projects/[id]/page.tsx` with permission gates
- [ ] `/reports/project-profitability` — table with margin colour coding, row click → project
- [ ] `sync_project_costs` wired in PO + supplier invoice pages
- [ ] TypeScript clean build, no regressions
