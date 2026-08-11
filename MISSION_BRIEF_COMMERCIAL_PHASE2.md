# MISSION BRIEF — Commercial Engine Phase 2: Procurement
## For Claude Code | KaiSync Workforce App

---

## CRITICAL CONSTRAINTS
- **Never break existing functionality** — all new pages and tables are additive
- **Suppliers are NOT a separate table** — they are `contractors WHERE partner_kind = 'supplier'`
- **UUID primary keys** on all new tables (consistent with Phase 1 pattern)
- **RLS on every table** using `user_company_ids()` + `user_has_permission(company_id, 'key')`
- **TypeScript must compile clean** — no `any` types without explicit comment

---

## STEP 0 — Apply Migration

Apply the migration file via Supabase MCP:

```
Tool: apply_migration
Project: vcivtjwreybaxgtdhtou
File: supabase/migrations/20260811000100_commercial_engine_phase2.sql
```

After applying, verify these tables exist:
- `rfqs`
- `rfq_lines`
- `rfq_recipients`
- `rfq_response_lines`
- `purchase_orders`
- `purchase_order_lines`
- `goods_received_notes`
- `goods_received_lines`

Also verify `supplier_invoices` now has a `po_id` column.

---

## TYPESCRIPT TYPES

Add to `/types/commercial.ts` (or create if not exists):

```typescript
// ─── Suppliers ───────────────────────────────────────────────────────────────
// Suppliers ARE contractors with partner_kind = 'supplier'
// No separate type needed — reuse existing Contractor type, filter by partner_kind

// ─── RFQs ────────────────────────────────────────────────────────────────────
export type RfqStatus = 'draft' | 'sent' | 'responses_received' | 'closed' | 'cancelled'

export interface Rfq {
  id: string
  company_id: string
  rfq_number: string | null
  title: string
  deal_id: string | null
  quote_id: string | null
  status: RfqStatus
  description: string | null
  delivery_address: string | null
  required_by_date: string | null
  response_deadline: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined
  deal?: { id: string; title: string }
  client?: { id: string; name: string }
  recipients?: RfqRecipient[]
}

export interface RfqLine {
  id: string
  company_id: string
  rfq_id: string
  sort_order: number
  quote_line_id: string | null
  inventory_item_id: string | null
  description: string
  unit: string
  quantity: number
  specifications: string | null
  created_at: string
}

export interface RfqRecipient {
  id: string
  company_id: string
  rfq_id: string
  supplier_id: string
  status: 'pending' | 'sent' | 'viewed' | 'responded' | 'declined' | 'selected' | 'not_selected'
  sent_at: string | null
  responded_at: string | null
  response_subtotal: number
  response_vat_amount: number
  response_total: number
  response_delivery_days: number | null
  response_valid_until: string | null
  response_notes: string | null
  is_selected: boolean
  // Joined
  supplier?: { id: string; name: string; email: string | null; phone: string | null }
}

export interface RfqResponseLine {
  id: string
  company_id: string
  rfq_id: string
  recipient_id: string
  rfq_line_id: string
  unit_price: number
  quantity: number
  subtotal: number
  vat_rate: number
  vat_amount: number
  line_total: number
  lead_time_days: number | null
  availability_notes: string | null
}

// ─── Purchase Orders ─────────────────────────────────────────────────────────
export type PoStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'partially_received' | 'received' | 'cancelled'
export type PoApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface PurchaseOrder {
  id: string
  company_id: string
  po_number: string | null
  supplier_id: string | null
  deal_id: string | null
  quote_id: string | null
  rfq_id: string | null
  status: PoStatus
  approval_status: PoApprovalStatus
  currency: string
  subtotal: number
  vat_amount: number
  total_amount: number
  amount_received_value: number
  delivery_address: string | null
  required_delivery_date: string | null
  actual_delivery_date: string | null
  notes: string | null
  internal_notes: string | null
  approved_by: string | null
  approved_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
  // Joined
  supplier?: { id: string; name: string; email: string | null }
  deal?: { id: string; title: string }
}

export interface PurchaseOrderLine {
  id: string
  company_id: string
  po_id: string
  sort_order: number
  rfq_line_id: string | null
  rfq_response_line_id: string | null
  inventory_item_id: string | null
  quote_line_id: string | null
  description: string
  unit: string
  quantity_ordered: number
  unit_price: number
  subtotal: number
  vat_rate: number
  vat_amount: number
  line_total: number
  quantity_received: number
  quantity_invoiced: number
}

// ─── Goods Received Notes ────────────────────────────────────────────────────
export type GrnStatus = 'draft' | 'received' | 'partial'

export interface GoodsReceivedNote {
  id: string
  company_id: string
  grn_number: string | null
  po_id: string | null
  supplier_id: string | null
  deal_id: string | null
  status: GrnStatus
  received_date: string
  received_by: string | null
  delivery_note_number: string | null
  notes: string | null
  created_at: string
  // Joined
  supplier?: { id: string; name: string }
  po?: { id: string; po_number: string | null }
}

export interface GoodsReceivedLine {
  id: string
  company_id: string
  grn_id: string
  po_line_id: string | null
  inventory_item_id: string | null
  description: string
  unit: string
  quantity_expected: number
  quantity_received: number
  unit_cost: number
  condition_notes: string | null
}

// ─── Three-Way Match ─────────────────────────────────────────────────────────
export type MatchStatus = 'NO_ORDER' | 'OVER_INVOICED' | 'SHORT_DELIVERY' | 'MATCHED' | 'PARTIAL'

export interface ThreeWayMatchLine {
  po_line_id: string
  po_id: string
  po_number: string | null
  supplier_id: string | null
  description: string
  unit: string
  unit_price: number
  quantity_ordered: number
  quantity_received: number
  quantity_invoiced: number
  value_ordered: number
  value_received: number
  value_invoiced: number
  receipt_variance: number
  invoice_variance: number
  match_status: MatchStatus
  company_id: string
}
```

---

## SECTION 1 — Supplier Management (extend Contractors)

### What already exists
The `contractors` table has everything we need. `partner_kind` is `'contractor'` by default.

### Changes needed
**Page: `/dashboard/supply/suppliers`**

Create a new "Suppliers" page as a filtered view of contractors where `partner_kind = 'supplier'`.

```
Navigation: Supply → Suppliers (if Supply section exists, add here; otherwise add to sidebar)
```

Layout: Same pattern as `/dashboard/supply/contractors` but filtered to `partner_kind = 'supplier'`.

**Supplier form**: Reuse the contractor form/drawer. The only difference is that the create action sets `partner_kind = 'supplier'` instead of `'contractor'`.

**Supplier detail page `/dashboard/supply/suppliers/[id]`**: Show contractor detail with:
- Standard contractor details (name, email, phone, vat, payment terms)
- Additional tab: **Purchase History** — list of purchase_orders for this supplier
- Additional tab: **RFQ History** — list of rfq_recipients where supplier_id = this supplier

---

## SECTION 2 — RFQ Module

### Page: `/dashboard/supply/rfqs`

**RFQ List**
- Table columns: RFQ Number | Title | Project/Deal | Suppliers Invited | Responses | Status | Created
- Status badge colours: draft=gray, sent=blue, responses_received=amber, closed=green, cancelled=red
- Actions: New RFQ button, row click → detail
- Filter by status

### Page: `/dashboard/supply/rfqs/new` and `/dashboard/supply/rfqs/[id]`

**RFQ Builder** — two-panel layout:

**Left panel: Details**
```
Title (required)
Link to Project (deal_id — optional, dropdown search client_deals)
Description
Required By Date
Response Deadline
Delivery Address
Notes
```

**Right panel: Line Items**
- Table with: Description | Unit | Quantity | Specifications | [delete]
- "Add Line" button
- "Add from Quote" button — opens modal to pick a `commercial_quote` then pulls its lines in
- Drag-to-reorder (sort_order)

**Recipients section (below panels)**
- "Add Supplier" button — search contractors WHERE partner_kind = 'supplier'
  - If no suppliers exist yet, show inline prompt: "No suppliers yet — add one first" with link to /supply/suppliers
- Supplier chips showing: name | status badge | response total (once responded)

**RFQ Actions (header)**
- Save Draft
- Send to Suppliers — changes status to 'sent', sets sent_at on each recipient, updates rfq_recipients.status to 'sent'
  - Sending is internal record-keeping only (no email integration required in Phase 2; add placeholder "Email feature coming soon")
- Close RFQ (when status = 'sent' or 'responses_received')
- Cancel

**Auto-number**: Call `generate_rfq_number(company_id)` RPC on first save if rfq_number is null.

---

## SECTION 3 — Supplier Response Entry

### Page: `/dashboard/supply/rfqs/[id]/responses`

This page is for manually entering supplier responses (quotations received by email/phone/portal).

**Layout**: One tab per supplier in rfq_recipients.

**Per-supplier tab**:
- Supplier name + response status badge
- Fields: Response Valid Until date | Delivery Days | VAT rate | Notes
- Line items table matching rfq_lines:
  - Each row: Description (read-only from rfq_line) | Quantity (read-only) | **Unit Price** (editable) | Lead Time Days (editable) | Line Total (calculated)
  - Auto-calculate: subtotal, vat_amount, total from unit_price × quantity
- "Mark as Responded" button — updates rfq_recipients.status to 'responded', sets responded_at, saves response_total
- "Mark as Declined" — sets status to 'declined', prompts for decline_reason

**Update rfq_recipients totals** whenever response lines are saved:
```typescript
// Recalculate rfq_recipient totals from rfq_response_lines
const lines = await getResponseLines(recipientId)
const subtotal = lines.reduce((s, l) => s + l.subtotal, 0)
const vat = lines.reduce((s, l) => s + l.vat_amount, 0)
await supabase.from('rfq_recipients').update({
  response_subtotal: subtotal,
  response_vat_amount: vat,
  response_total: subtotal + vat,
  updated_at: new Date().toISOString()
}).eq('id', recipientId)
```

---

## SECTION 4 — Supplier Comparison Engine

### Page: `/dashboard/supply/rfqs/[id]/compare`

**This is the key value-add page.** Show all supplier prices side by side.

**Data**: Call `get_rfq_comparison(rfq_id)` RPC. Returns all lines with all supplier unit prices.

**Layout**:

Header row: | Item | Unit | Qty | [Supplier A] | [Supplier B] | [Supplier C] |

Each row: item description | unit | qty | unit price per supplier | (lowest price highlighted in green)

Footer: Total per supplier (highlighted in green for lowest)

**Supplier column header**: supplier name | response status | delivery days | total price

**"Select Supplier" button** per supplier column:
- Marks rfq_recipients.is_selected = true (and others = false) for this RFQ
- Shows confirmation modal: "Create Purchase Order from [Supplier Name]?"
  - If confirmed → redirects to `/dashboard/supply/purchase-orders/new?rfq_id=[rfq_id]&recipient_id=[recipient_id]`

**Status guard**: If not all suppliers have responded, show a banner: "X of Y suppliers have responded. You can still compare what's been received."

---

## SECTION 5 — Purchase Orders Module

### Page: `/dashboard/supply/purchase-orders`

**PO List**
- Table columns: PO Number | Supplier | Project | Total | Status | Approval | Received % | Date
- Status badges: draft=gray, pending_approval=yellow, approved=blue, sent=indigo, partially_received=amber, received=green, cancelled=red
- "New PO" button

### Page: `/dashboard/supply/purchase-orders/new` and `/dashboard/supply/purchase-orders/[id]`

**PO Builder**

**Header fields:**
```
Supplier (required) — search contractors WHERE partner_kind = 'supplier'
Link to Project (deal_id)
Link to RFQ (rfq_id — optional, populated automatically when created from RFQ comparison)
Required Delivery Date
Delivery Address
Terms & Conditions
Notes (visible to supplier)
Internal Notes (internal only)
```

**Line Items table:**
```
Description | Unit | Qty | Unit Price | VAT% | Line Total | [delete]
```
- "Add Line" button
- If created from RFQ (`?rfq_id=...&recipient_id=...`): auto-populate lines from the selected supplier's rfq_response_lines
  ```typescript
  // On mount if rfq_id + recipient_id in query params:
  const lines = await getResponseLines(recipientId) // rfq_response_lines
  // Map to PO lines, pre-filling unit_price from response
  ```

**Totals panel (right side):**
- Subtotal | VAT | Total | Amount Received Value (auto-calculated from GRNs)

**Auto-number**: Call `generate_po_number(company_id)` on first save.

**PO Actions:**
- Save Draft
- Submit for Approval — status → 'pending_approval'
- Approve (owner/hr only, checks `purchase_orders.approve` permission) — status → 'approved', sets approved_by, approved_at
- Reject (same permission) — prompts for reason, status → 'draft', approval_status → 'rejected'
- Mark as Sent — status → 'sent', sets sent_at
- Receive Goods → opens GRN creation modal (or navigates to new GRN pre-filled)
- Cancel

**Approval guard**: If user lacks `purchase_orders.approve` permission, Approve/Reject buttons are hidden entirely.

---

## SECTION 6 — Goods Received Notes

### Page: `/dashboard/supply/goods-received`

**GRN List**
- Table: GRN Number | Supplier | PO Ref | Received Date | Status | Received By
- "New GRN" button

### Page: `/dashboard/supply/goods-received/new` and `/dashboard/supply/goods-received/[id]`

**GRN Form**

**Header:**
```
Purchase Order (po_id — required, dropdown of approved/sent POs)
Supplier (auto-populated from PO, read-only)
Received Date (date picker, default today)
Received By (employee dropdown)
Delivery Note Number (supplier's doc reference)
Notes
```

**When a PO is selected**, auto-populate lines from `purchase_order_lines`:
```typescript
const poLines = await getPOLines(poId)
// Map to GRN lines: description, unit, quantity_expected = quantity_ordered - quantity_received
// User edits quantity_received (defaults to quantity_expected)
```

**Lines table:**
```
Description | Unit | Expected | Received (editable) | Unit Cost | Condition Notes
```

**Save GRN** — on save:
1. Insert `goods_received_notes` row
2. Insert `goods_received_lines` rows
3. **Update `purchase_order_lines`**: increment `quantity_received` for each matched `po_line_id`
4. **Update `purchase_orders`**: recalculate `amount_received_value` from all GRN lines for this PO
5. **Update `purchase_orders.status`**:
   - If all lines fully received → 'received'
   - If some received → 'partially_received'
6. **Update `inventory_items.quantity_on_hand`** if `inventory_item_id` is set on GRN line (increment)

```typescript
// Status update logic
const po = await getPO(poId)
const allLines = await getPOLines(poId)
const allReceived = allLines.every(l => l.quantity_received >= l.quantity_ordered)
const anyReceived = allLines.some(l => l.quantity_received > 0)
const newStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status
await supabase.from('purchase_orders').update({ status: newStatus, amount_received_value: totalReceived }).eq('id', poId)
```

**Auto-number**: Call `generate_grn_number(company_id)` on first save.

---

## SECTION 7 — Three-Way Matching View

### On the PO Detail Page `/dashboard/supply/purchase-orders/[id]`

Add a "Three-Way Match" tab (visible once at least one GRN exists for this PO).

**Query:** `po_three_way_match` view filtered to `po_id = [id]`

**Table:**
| Item | Ordered | Received | Invoiced | Receipt Variance | Invoice Variance | Status |
|---|---|---|---|---|---|---|

**Status badge:**
- MATCHED → green "✓ Matched"
- OVER_INVOICED → red "⚠ Over-invoiced"
- SHORT_DELIVERY → amber "Short delivery"
- PARTIAL → blue "Partial"
- NO_ORDER → gray "No order"

**Summary banner** at top:
- If all lines MATCHED: green "All lines matched — ready to approve payment"
- If any OVER_INVOICED: red "Discrepancy detected — review before paying"
- If PARTIAL: amber "Partial receipt — some lines still outstanding"

**Link supplier invoice**: On the PO detail header, show a "Link Supplier Invoice" button.
- Opens modal: search `supplier_invoices` (filtered to same supplier + company)
- On link: sets `supplier_invoices.po_id = po.id`
- After linking: updates `purchase_order_lines.quantity_invoiced` from supplier_invoice_lines where inventory_item matches or description matches (best-effort, editable)

---

## SECTION 8 — Supply Section Navigation

Ensure the sidebar navigation under "Supply" (or create if not exists) includes:

```
Supply
  ├── Suppliers          /dashboard/supply/suppliers
  ├── RFQs               /dashboard/supply/rfqs
  ├── Purchase Orders    /dashboard/supply/purchase-orders
  ├── Goods Received     /dashboard/supply/goods-received
  └── Supplier Invoices  /dashboard/supply/supplier-invoices (already exists — leave as-is)
```

If the Supply section doesn't exist in the sidebar, add it. Pattern matches the Money section pattern from Phase 1.

---

## SECTION 9 — Supplier Invoices Upgrade

**Page: `/dashboard/supply/supplier-invoices/[id]`** (already exists — extend only)

Add to the detail view:
- **Linked PO** section: If `po_id` is set, show PO number + link. If not set, show "Link to PO" button (same modal as Section 7 above).
- **Three-way match summary** (read-only): show total ordered | total received | total invoiced | match status for the linked PO.

No changes to list page or create flow.

---

## BUILD ORDER

```
1. Apply migration (Step 0)
2. Add TypeScript types
3. Suppliers page (thin — just filtered contractor list)
4. RFQ builder + list
5. Response entry page
6. Comparison engine page
7. PO builder + list
8. GRN builder + list
9. Three-way match tab on PO detail
10. Supplier invoice upgrade (link to PO)
11. Sidebar navigation update
```

---

## KEY PATTERNS TO FOLLOW (from Phase 1)

**Permission check pattern:**
```typescript
const { data: canEdit } = await supabase.rpc('user_has_permission', {
  p_company_id: companyId,
  p_key: 'purchase_orders.edit'
})
```

**Suppliers query (critical — never forget the filter):**
```typescript
const { data: suppliers } = await supabase
  .from('contractors')
  .select('id, name, email, phone, vat_number, payment_terms')
  .eq('company_id', companyId)
  .eq('partner_kind', 'supplier')  // ← always filter this
  .eq('is_active', true)
  .order('name')
```

**Auto-number RPC call:**
```typescript
const { data: rfqNumber } = await supabase.rpc('generate_rfq_number', { p_company_id: companyId })
```

**Comparison RPC call:**
```typescript
const { data: comparison } = await supabase.rpc('get_rfq_comparison', { p_rfq_id: rfqId })
// Returns: { rfq_id, lines: [...], recipients: [...] }
```

---

## DELIVERABLES CHECKLIST

- [ ] Migration applied, 8 tables verified
- [ ] TypeScript types added, build clean
- [ ] `/supply/suppliers` — filtered contractor list + create
- [ ] `/supply/rfqs` — list + builder + send
- [ ] `/supply/rfqs/[id]/responses` — response entry per supplier
- [ ] `/supply/rfqs/[id]/compare` — comparison table with select + PO creation
- [ ] `/supply/purchase-orders` — list + builder + approval flow
- [ ] `/supply/goods-received` — list + GRN form + inventory update
- [ ] Three-way match tab on PO detail
- [ ] Supplier invoice → PO link
- [ ] Sidebar navigation updated
- [ ] TypeScript clean build, no regressions
