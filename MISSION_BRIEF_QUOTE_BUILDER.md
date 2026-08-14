# MISSION BRIEF — Quote Builder (4-Tab Redesign)
## For Claude Code | KaiSync Workforce App

---

## OVERVIEW

The quote builder is a 4-tab interface for creating customer quotes. It guides
the user from capturing what the customer needs, through checking stock and
sourcing from suppliers, to setting prices and generating the final quote.

Key concepts:
- **RFQ (Request for Quote)** — one email/communication to ONE supplier covering
  MULTIPLE items. A quote can have many RFQs (one per supplier contacted).
- **Service delivery toggle** — service and labour lines declare upfront:
  "We provide this" (own catalogue rate) or "We outsource this" (contractor RFQ).
- **Phase 1** (this build): RFQ creation and manual response logging.
- **Phase 2** (later): outbound email from system, inbound email auto-parse,
  PDF/Excel response extraction. Design for it — don't build it yet.

---

## STEP 1: READ EXISTING TABLES FIRST

Before touching any code, run these in Supabase MCP:

```sql
-- 1. Confirm quote-related table names
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name ILIKE '%quote%'
ORDER BY table_name;

-- 2. Read commercial_quote_lines columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'commercial_quote_lines'
ORDER BY ordinal_position;

-- 3. Read commercial_quotes columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'commercial_quotes'
ORDER BY ordinal_position;
```

Note the actual column names (especially: qty column on quote lines, price
columns, the FK from lines to quotes). Adjust all code to match reality.

---

## STEP 2: APPLY MIGRATION

Apply `supabase/migrations/20260812000400_quote_builder.sql` via Supabase MCP.

**Important**: the migration has a FK note — if the quotes table is not called
`commercial_quotes` or if the quote FK column on lines is not `quote_id`,
update the migration and the RPC accordingly before applying.

Verify:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('quote_rfqs','quote_rfq_lines');
-- → 2 rows

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_quote_sourcing_summary','get_rfq_comparison');
-- → 2 rows
```

---

## STEP 3: TYPES — `src/types/quotes.ts` (new file)

```typescript
import type { CatalogueItem, ItemVariant } from './inventory'

export type RfqStatus =
  | 'draft'
  | 'sent'
  | 'partially_responded'
  | 'responded'
  | 'expired'
  | 'cancelled'

export type QuoteLineSourceType =
  | 'inventory'
  | 'rfq'
  | 'catalogue'
  | 'manual'

export type ServiceDelivery = 'self' | 'outsourced'

export interface QuoteRfq {
  id: string
  company_id: string
  quote_id: string
  supplier_id: string
  supplier_name?: string        // joined
  rfq_number: string
  status: RfqStatus
  sent_via: 'manual' | 'email'
  sent_at: string | null
  responded_at: string | null
  notes: string | null
  response_document_path: string | null
  response_document_name: string | null
  created_by: string | null
  created_at: string
  lines?: QuoteRfqLine[]        // loaded separately
}

export interface QuoteRfqLine {
  id: string
  company_id: string
  rfq_id: string
  catalogue_item_id: string
  variant_id: string | null
  qty_requested: number
  // supplier response (null until filled in)
  supplier_price: number | null
  supplier_ref: string | null
  supplier_qty_available: number | null
  lead_time_days: number | null
  supplier_notes: string | null
  responded_at: string | null
  is_selected: boolean
  // joined
  item_name?: string
  item_sku?: string | null
}

export interface QuoteSourcingSummaryRow {
  line_id: string
  catalogue_item_id: string
  item_name: string
  item_sku: string | null
  item_type: string
  qty_requested: number
  service_delivery: ServiceDelivery | null
  qty_in_stock: number
  is_stockable: boolean
  source_type: QuoteLineSourceType | null
  rfq_count: number
  rfq_responded_count: number
  is_confirmed: boolean
}

export interface RfqComparisonRow {
  rfq_line_id: string
  rfq_id: string
  rfq_number: string
  supplier_id: string
  supplier_name: string
  rfq_status: RfqStatus
  supplier_price: number | null
  supplier_ref: string | null
  supplier_qty: number | null
  lead_time_days: number | null
  supplier_notes: string | null
  responded_at: string | null
  is_selected: boolean
}

// A requested line in the builder (before it becomes a quote line)
export interface RequestLine {
  tempId: string          // client-side only, uuid
  catalogue_item_id: string | null
  variant_id: string | null
  item_name: string
  item_sku: string | null
  item_type: 'part' | 'service' | 'material' | 'labour' | null
  qty: number
  unit_of_measure: string
  service_delivery: ServiceDelivery | null  // only for service/labour
  notes: string | null
}
```

---

## STEP 4: FILE STRUCTURE

```
src/
  types/
    quotes.ts                               ← NEW (Step 3)

  lib/
    rfq.ts                                  ← NEW (Step 5)

  app/dashboard/money/quotes/
    new/
      page.tsx                              ← NEW — new quote shell
    [id]/
      page.tsx                              ← NEW — edit existing quote (same component)

  components/quotes/
    QuoteBuilder.tsx                        ← NEW — main 4-tab wrapper
    tabs/
      RequestTab.tsx                        ← NEW
      StockSourcingTab.tsx                  ← NEW
      PricingTab.tsx                        ← NEW
      PreviewTab.tsx                        ← NEW
    RfqBoard.tsx                            ← NEW — bottom RFQ cards section
    RfqCard.tsx                             ← NEW — one supplier card
    RfqSidePanel.tsx                        ← NEW — slide-in panel for RFQ details
    RfqComparisonPanel.tsx                  ← NEW — side panel: compare supplier prices
    ServiceDeliveryToggle.tsx               ← NEW
    VariantPickerModal.tsx                  ← from MISSION_BRIEF_ITEM_VARIANTS.md
```

---

## STEP 5: `src/lib/rfq.ts` — RFQ helpers

```typescript
import type { RfqStatus } from '@/types/quotes'

export function generateRfqNumber(quoteNumber: string, rfqIndex: number): string {
  // e.g. QT-2026-0041 → RFQ-2026-0041-01
  const base = quoteNumber.replace(/^QT-/, '')
  return `RFQ-${base}-${String(rfqIndex).padStart(2, '0')}`
}

export interface RfqStatusConfig {
  label: string
  colour: string   // Tailwind text class
  bgColour: string // Tailwind bg class
  icon: string     // Material icon
}

export const RFQ_STATUS_CONFIG: Record<RfqStatus, RfqStatusConfig> = {
  draft:                { label: 'Draft',        colour: 'text-gray-500',   bgColour: 'bg-gray-100',   icon: 'draft' },
  sent:                 { label: 'Sent',          colour: 'text-blue-600',   bgColour: 'bg-blue-50',    icon: 'send' },
  partially_responded:  { label: 'Partial',       colour: 'text-amber-600',  bgColour: 'bg-amber-50',   icon: 'hourglass_bottom' },
  responded:            { label: 'Responded',     colour: 'text-green-600',  bgColour: 'bg-green-50',   icon: 'check_circle' },
  expired:              { label: 'Expired',       colour: 'text-red-500',    bgColour: 'bg-red-50',     icon: 'schedule' },
  cancelled:            { label: 'Cancelled',     colour: 'text-gray-400',   bgColour: 'bg-gray-50',    icon: 'cancel' },
}

export function rfqProgress(rfq: { lines?: { supplier_price: number | null }[] }): string {
  if (!rfq.lines?.length) return '0 items'
  const responded = rfq.lines.filter(l => l.supplier_price !== null).length
  return `${responded} / ${rfq.lines.length} responded`
}
```

---

## STEP 6: QuoteBuilder.tsx — main wrapper

File: `src/components/quotes/QuoteBuilder.tsx`

```typescript
interface Props {
  quoteId: string | null     // null = new quote
  companyId: string
  employeeId: string
}
```

### State
```typescript
const [activeTab, setActiveTab] = useState<'request'|'stock'|'pricing'|'preview'>('request')
const [requestLines, setRequestLines] = useState<RequestLine[]>([])
const [rfqs, setRfqs] = useState<QuoteRfq[]>([])
const [sourcingSummary, setSourceSummary] = useState<QuoteSourcingSummaryRow[]>([])
const [quoteId, setQuoteId] = useState<string | null>(props.quoteId)
```

### Layout
```
┌────────────────────────────────────────────────────────────────┐
│  New quote  ·  QT-2026-0041  ·  Draft       [Save]  [Generate] │
├────────────────────────────────────────────────────────────────┤
│  [1 · Request]  [2 · Stock & Sourcing]  [3 · Pricing]  [4 · Preview] │
├────────────────────────────────────────────────────────────────┤
│  <active tab content>                                          │
└────────────────────────────────────────────────────────────────┘
```

Tab labels show a status dot when complete:
- Request: green dot when ≥1 line added
- Stock & Sourcing: green dot when all lines confirmed
- Pricing: green dot when all lines have sell price set
- Preview: always accessible

"Generate quote" button is accent-coloured but disabled until all lines
in Pricing have a sell price.

---

## STEP 7: TAB 1 — RequestTab.tsx

### Purpose
Capture what the customer is asking for. One line per item/service.

### Layout
```
┌─ Action bar ───────────────────────────────────────────────────┐
│  [Upload PO / PDF]  [Upload image]                             │
└────────────────────────────────────────────────────────────────┘

┌─ Upload drop zone (shown until first line added) ──────────────┐
│  Drop a customer PO, image, or PDF here                        │
│  Items will be extracted automatically  (Phase 2)              │
└────────────────────────────────────────────────────────────────┘

┌─ Lines table ──────────────────────────────────────────────────┐
│  #  Code      Name                 Qty  Unit  Type    Delivery │
│  1  C18221OC  Sub set, oil & cooler  1  each  Part    —        │
│  2  —         Engine flush service  1  job   Service [toggle]  │
└────────────────────────────────────────────────────────────────┘

[ + Add line (search input) ]                  [ Process items → ]
```

### Line entry
- Search input at the bottom: type a part number or name
- Shows matching catalogue items from `quote_catalogue_items`
- If item has variants (`variant_group_id IS NOT NULL`): opens `VariantPickerModal`
  to choose brand/condition before adding the line
- If no match: allows adding as a free-text line (item_name manually typed,
  catalogue_item_id = null)

### Service/Labour delivery toggle
For lines where `item_type IN ('service','labour')`, show a `ServiceDeliveryToggle`:

```
  Delivery:  [We provide this]  [Outsource to contractor]
```

Default: 'self' if item exists in catalogue with a cost price.

If 'outsourced' is selected: the line will appear in the RFQ board in Tab 2,
same as a part that's not in stock.

### Columns
| Column | Notes |
|---|---|
| # | sequence, drag handle for reordering |
| Code | item SKU (read-only, from catalogue) |
| Name | editable text |
| Qty | number input |
| Unit | from catalogue (read-only) |
| Type | badge: Part / Service / Material / Labour |
| Delivery | ServiceDeliveryToggle (service/labour only) |
| × | remove line |

### "Process items" button
Saves the request lines to the quote (creates `commercial_quote_lines`
if quoteId exists, or creates the quote first), then navigates to Tab 2.

---

## STEP 8: TAB 2 — StockSourcingTab.tsx

### Purpose
Shows the stock status of every line and manages the RFQ process for
anything not in inventory.

### Layout
```
┌─ Items & Status table ─────────────────────────────────────────┐
│  (top ~55% of tab height)                                       │
│  Click a row → highlights it                                   │
│  "Outsource" button on rows that need sourcing                 │
└────────────────────────────────────────────────────────────────┘

┌─ RFQ board ────────────────────────────────────────────────────┐
│  (bottom ~45%, scrollable horizontally)                        │
│  [Supplier A card]  [Supplier B card]  [+ New RFQ]             │
└────────────────────────────────────────────────────────────────┘

RfqSidePanel (420px, slides in from right, z-50)
  — appears when "Outsource" or an RFQ card is clicked
  — does NOT push the main layout; overlays it
```

### Items & Status table

Load data: `get_quote_sourcing_summary(companyId, quoteId)`

Columns:
| Column | Notes |
|---|---|
| # | sequence |
| Code | SKU, monospace |
| Name | item name |
| Type | badge |
| Qty | requested |
| Stock status | see below |
| Sourcing | see below |
| Action | see below |

**Stock status column values:**
- `is_stockable = false`: grey "—" (not tracked)
- `qty_in_stock >= qty_requested`: green "In stock (N)" 
- `qty_in_stock > 0 AND qty_in_stock < qty_requested`: amber "Partial (N)"
- `qty_in_stock = 0`: red "Not in stock"
- Service with `service_delivery = 'self'`: blue "We provide"
- Service with `service_delivery = 'outsourced'`: grey "Outsource"

**Sourcing column values:**
- `is_confirmed = true`: green "✓ Confirmed" with source name
- `rfq_count = 0`: muted "—"
- `rfq_responded_count = rfq_count AND rfq_count > 0`: amber "N quotes — select one"
- `rfq_count > 0 AND rfq_responded_count < rfq_count`: muted "Waiting (X/N)"

**Action column:**
- If `is_confirmed = true`: grey "Change source" button
- If `rfq_responded_count > 0`: green "Select source" button → opens `RfqComparisonPanel`
- If `(qty_in_stock = 0 OR service_delivery = 'outsourced') AND !is_confirmed`:
  amber "Outsource" button → opens `RfqSidePanel` for adding to an RFQ
- If `qty_in_stock >= qty_requested AND !is_confirmed`:
  blue "Use stock" button → confirms source as 'inventory', sets source_type

**Multi-select for bulk RFQ:**
Checkboxes appear on hover (left of the row number). When ≥2 rows are checked,
a floating action bar appears above the table:

```
  2 items selected  [Create RFQ for these items]  [Clear]
```

Clicking "Create RFQ" → opens `RfqSidePanel` with those items pre-loaded,
in "create new RFQ" mode (supplier not yet selected).

### RFQ Board

File: `RfqBoard.tsx`

Load: all `quote_rfqs` for this quote, with their lines (`quote_rfq_lines`).

```
── RFQs ──────────────────────────────────────── [+ New RFQ]

[Supplier A card]  [Supplier B card]  [+ Add supplier]
```

Each `RfqCard.tsx`:
```
┌──────────────────────────────┐
│ Parts World SA               │
│ [Sent]   3 items             │
│ ████░░  2 / 3 responded      │
│ Sent: 12 Aug · R 95–R 120    │
│ [View / log response]        │
└──────────────────────────────┘
```

- Status badge coloured by `RFQ_STATUS_CONFIG`
- Progress bar: responded lines / total lines
- Price range: min–max of supplier_price values received
- "View / log response" → opens `RfqSidePanel` for that RFQ

### RfqSidePanel.tsx

Slides in from the RIGHT. 420px wide. Does not push the main content.

```tsx
<div className={cn(
  'fixed top-0 right-0 h-full w-[420px] bg-background border-l border-divider z-50',
  'shadow-xl transition-transform duration-200',
  isOpen ? 'translate-x-0' : 'translate-x-full'
)}>
```

**Panel header:**
```
← [close]   RFQ — Parts World SA
            RFQ-2026-0041-01 · [status badge]
```

**Panel body — two modes:**

**Mode A: Create new RFQ (no supplier yet)**
```
Supplier
[ Search or add new supplier... ]   ← combobox searching contractors
                                       WHERE partner_kind IN ('supplier','contractor')
                                       + "Add as new supplier" if no match

Items in this RFQ
┌─────────────────────────────────────────────────┐
│ ✓  C18221OC  Sub set, oil & cooler    qty: 1    │
│ ✓  FLT-OIL-2 Oil filter replacement  qty: 2    │
│ + Add another item                              │
└─────────────────────────────────────────────────┘

Notes (optional)
[ textarea ]

[Cancel]          [Create RFQ — draft]
                  [Create RFQ + mark as sent manually]
```

**Mode B: View / log response (existing RFQ)**
```
Supplier: Parts World SA
Items: 3  ·  Status: [Sent]  ·  Sent: 12 Aug 2026

──── Items & responses ────

C18221OC · Sub set, oil & cooler  (qty requested: 1)
  Their price (R)  [ 101.00 ]
  Their ref        [ PW-2026-4411 ]
  Qty available    [ 5 ]
  Lead time (days) [ 2 ]
  Notes            [ _________ ]

FLT-OIL-2 · Oil filter replacement  (qty requested: 2)
  Their price (R)  [ _______ ]    ← not yet filled
  Their ref        [ _______ ]
  ...

──── Response document ────
[Upload their PDF / Excel]   or   [rfq-response-partworld.pdf ✓]

Phase 2 note (shown as muted helper text):
"When email integration is enabled, responses will be parsed automatically."

[Save responses]
```

**Supplier duplicate check:**
When typing in the supplier search:
- Fuzzy-match against `contractors.name` using pg_trgm (already enabled)
- If similarity > 0.8 with an existing contractor: show "Did you mean [X]?" warning
- If truly new: show "Add '[name]' as new supplier" → creates contractor record
  with `partner_kind = 'supplier'`

### RfqComparisonPanel.tsx

Opens when user clicks "Select source" on a confirmed item.

```
← [close]   Select source — C18221OC

Available quotes (3 received)

┌── Parts World SA ────────────────── RFQ-2026-0041-01 ──┐
│  R 101.00 / unit  ·  Ref: PW-4411  ·  5 available      │
│  Lead time: 2 days                                      │
│                                       [Select this →]   │
└────────────────────────────────────────────────────────┘

┌── AAA Parts ───────────────────────── RFQ-2026-0041-02 ─┐
│  R 95.00 / unit  ·  Ref: AAA-998   ·  12 available      │
│  Lead time: 5 days                                      │
│                                       [Select this →]   │
└────────────────────────────────────────────────────────┘

Or use from your own inventory:
┌── CEP / New — 3 in stock ─────────────────────────────┐
│  Cost: R 88.50 (last avg)  ·  Bin: W2-K21B6            │
│                                       [Use stock →]    │
└────────────────────────────────────────────────────────┘
```

Clicking "Select this":
1. Sets `is_selected = true` on the winning `quote_rfq_line`
2. Sets `is_selected = false` on all other lines for this item + quote
3. Updates `commercial_quote_lines`: `source_type = 'rfq'`, `rfq_line_id = …`,
   cost_price = supplier_price
4. Closes panel, updates sourcing summary (item shows "✓ Confirmed")

Clicking "Use stock":
1. Updates `commercial_quote_lines`: `source_type = 'inventory'`,
   `catalogue_item_id` = variant or item id
2. cost_price = item's avg cost or last cost from `catalogue_item_suppliers`

---

## STEP 9: TAB 3 — PricingTab.tsx

### Purpose
Set sell price and margin for every quote line. Costs are pre-populated
from sourcing decisions made in Tab 2.

### Layout
```
Default margin: [ 15 ] %  [Apply to all unfilled]

#  Name         Source      Cost (R)  Sell (R)  Margin %  Qty  Line total
1  C18221OC     Parts World  101.00   [116.15]  [15.0]    1    R 116.15
2  Oil filter   Inventory     88.50   [101.78]  [15.0]    2    R 203.56
3  Engine flush Catalogue     —       [450.00]  [—]       1    R 450.00
```

### Pricing rules
- **Cost**, **Sell price**, and **Margin %** are all editable on every row
- Editing any one recalculates the other two:
  - Change cost → sell updates (margin held)
  - Change sell → margin updates (cost held)
  - Change margin → sell updates (cost held)
- `Line total = sell_price × qty`
- Rows where `source_type = 'catalogue'` (services we provide): cost may be
  pulled from catalogue item's cost_price; leave editable

### Validation
- All rows must have `sell_price > 0` before Tab 4 is accessible
- Rows with `margin < 0`: show red highlight on margin cell (warning, not a block)
- Rows with `margin < 5`: show amber highlight (low margin warning)

### Footer totals (sticky at bottom)
```
Total cost  |  Subtotal (excl. VAT)  |  VAT (15%)  |  Total (incl. VAT)  |  Gross profit  |  Avg margin %
```

All calculated live as prices change.

### Save
On any price change: debounce 800ms → `UPDATE commercial_quote_lines SET sell_price, cost_price WHERE id = …`

---

## STEP 10: TAB 4 — PreviewTab.tsx

### Purpose
Shows what the customer will see. Final review before generating.

### Layout
```
┌─ Quote header ─────────────────────────────────────────────────┐
│  [Company logo]           Quote QT-2026-0041                   │
│  [Customer name]          Date: 14 Aug 2026                    │
│                           Valid until: 28 Aug 2026             │
└────────────────────────────────────────────────────────────────┘

┌─ Line items (customer view — no cost, no source) ──────────────┐
│  #  Description             Qty  Unit  Unit price  Total       │
│  1  Sub set, oil & cooler   1    each  R 116.15    R 116.15    │
│  2  Oil filter replacement  2    each  R 101.78    R 203.56    │
│  3  Engine flush service    1    job   R 450.00    R 450.00    │
└────────────────────────────────────────────────────────────────┘

Subtotal (excl. VAT)             R 769.71
VAT (15%)                        R 115.46
Total (incl. VAT)                R 885.17

Notes / terms
[ textarea — visible on generated quote ]

[← Back to Pricing]    [Generate quote PDF]   [Mark as sent to customer]
```

"Generate quote PDF" — Phase 2 (PDF generation via server function or Puppeteer).
For Phase 1: button visible but shows a "Coming soon" toast.
"Mark as sent to customer" — updates `commercial_quotes.status = 'sent'`.

---

## STEP 11: ROUTING

```typescript
// src/app/dashboard/money/quotes/new/page.tsx
export default function NewQuotePage() {
  return <QuoteBuilder quoteId={null} />
}

// src/app/dashboard/money/quotes/[id]/page.tsx
export default function EditQuotePage({ params }: { params: { id: string } }) {
  return <QuoteBuilder quoteId={params.id} />
}
```

Ensure the sidebar link "New quote" under Money points to `/dashboard/money/quotes/new`.

---

## PHASE 2 NOTES (design for now, don't build)

These features are NOT part of this build but the data model already supports them.
Leave placeholder UI (buttons that show "Coming soon" toast) where appropriate.

1. **Send RFQ email from system**: `quote_rfqs.sent_via = 'email'`. Needs an
   email service (SendGrid, Resend, etc.) and a dedicated reply-to address.
   The RFQ side panel's "Mark as sent" button will eventually become "Send email".

2. **Inbound email parsing**: when supplier replies, system intercepts at the
   reply-to address, parses the email body/attachment, and auto-fills
   `quote_rfq_lines.supplier_price`, `supplier_ref`, etc. User just confirms.

3. **PDF/Excel response parsing**: "Upload their response" already stores the file.
   Phase 2 adds extraction (AI or structured parsing) to pull prices into lines.

4. **Quote PDF generation**: "Generate quote PDF" tab action.

5. **Post-acceptance PO generation**: after customer accepts, the system uses
   the confirmed RFQ lines to pre-fill purchase orders for each supplier.

---

## BUILD ORDER

1. Apply migration — verify `quote_rfqs`, `quote_rfq_lines` tables + RPCs
2. Create `src/types/quotes.ts`
3. Create `src/lib/rfq.ts`
4. Create `ServiceDeliveryToggle.tsx`
5. Create `RequestTab.tsx` (Tab 1)
6. Create `RfqCard.tsx` and `RfqBoard.tsx`
7. Create `RfqSidePanel.tsx` (create + log-response modes)
8. Create `RfqComparisonPanel.tsx`
9. Create `StockSourcingTab.tsx` (Tab 2) — wires RfqBoard + RfqSidePanel
10. Create `PricingTab.tsx` (Tab 3) with live margin calculation
11. Create `PreviewTab.tsx` (Tab 4)
12. Create `QuoteBuilder.tsx` — assembles all tabs
13. Add routing pages (`/quotes/new`, `/quotes/[id]`)
14. `tsc --noEmit` — 0 errors

---

## DELIVERABLES

- [ ] Migration applied — `quote_rfqs`, `quote_rfq_lines`, extended `commercial_quote_lines`
- [ ] `src/types/quotes.ts` — all types
- [ ] `src/lib/rfq.ts` — status config + helpers
- [ ] Tab 1 — request lines with item search, variant picker, service delivery toggle
- [ ] Tab 2 — items/status table + RFQ board + RfqSidePanel (create + log modes)
- [ ] Tab 2 — multi-select rows → bulk "Create RFQ for these items"
- [ ] Tab 2 — RfqComparisonPanel with "Select source" that confirms the line
- [ ] Tab 2 — "Use stock" confirms inventory source
- [ ] Tab 2 — new supplier added on the spot with duplicate check
- [ ] Tab 3 — cost/sell/margin all editable, live recalc, sticky footer totals
- [ ] Tab 4 — customer-view preview, notes, "Mark as sent" action
- [ ] Routing — `/dashboard/money/quotes/new` and `/dashboard/money/quotes/[id]`
- [ ] Phase 2 buttons present but show "Coming soon" toast
- [ ] `tsc --noEmit` — 0 errors
