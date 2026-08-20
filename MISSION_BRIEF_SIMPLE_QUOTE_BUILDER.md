# MISSION BRIEF — Simple Quote Builder
## For Claude Code | KaiSync Workforce App

---

## OVERVIEW

Replace the existing 4-tab `QuoteBuilder` with a single-screen quote builder.
Target user: field service and construction companies. They know what they're
quoting. They just need to describe the work, price it, and send it.

No tabs. No stock sourcing. No RFQ board. Just: customer → lines → total → send.

The DB tables from the 4-tab build (quote_rfqs, etc.) stay untouched.
We're only replacing the UI.

---

## STEP 1: READ EXISTING FILES FIRST

```bash
# Check what currently exists
cat src/components/quotes/QuoteBuilder.tsx | head -50
cat src/app/dashboard/money/quotes/new/page.tsx
cat src/app/dashboard/money/quotes/[id]/page.tsx
```

Also confirm:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'commercial_quotes' ORDER BY ordinal_position;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'commercial_quote_lines' ORDER BY ordinal_position;
```

---

## STEP 2: FILES TO CREATE / REPLACE

```
src/components/quotes/
  SimpleQuoteBuilder.tsx        ← NEW — replaces QuoteBuilder.tsx
  SimpleQuoteLineRow.tsx        ← NEW — one editable line
  RateCardPicker.tsx            ← NEW — mini catalogue search popover
```

Update:
```
src/app/dashboard/money/quotes/new/page.tsx   ← swap QuoteBuilder → SimpleQuoteBuilder
src/app/dashboard/money/quotes/[id]/page.tsx  ← same
```

Do NOT delete `QuoteBuilder.tsx` or any of the tab files — just stop importing them.

---

## STEP 3: LAYOUT — SimpleQuoteBuilder.tsx

```
┌─ Header ───────────────────────────────────────────────────────┐
│  ← New quote                            [Save draft] [Send →]  │
│  [Quote title / optional description]                          │
└────────────────────────────────────────────────────────────────┘

┌─ Quote meta ───────────────────────────────────────────────────┐
│  Customer          Quote #         Date         Valid until     │
│  [search/select]   QT-2026-0042   14 Aug 2026   28 Aug 2026 ▼  │
└────────────────────────────────────────────────────────────────┘

┌─ Lines ────────────────────────────────────────────────────────┐
│  #   Description              Qty    Unit    Unit price   Total │
│  1   [_________________]      [1]   [ea ▼]  [R 0.00]   R 0.00 │
│  2   [_________________]      [1]   [ea ▼]  [R 0.00]   R 0.00 │
│                                                                 │
│  [+ Add line]   [⊞ From rate card]                             │
└────────────────────────────────────────────────────────────────┘

┌─ Totals ───────────────────────────────────────────────────────┐
│                               Subtotal (excl. VAT)   R 0.00   │
│                               VAT (15%)               R 0.00   │
│                               Total (incl. VAT)       R 0.00   │
└────────────────────────────────────────────────────────────────┘

┌─ Notes ────────────────────────────────────────────────────────┐
│  [Notes / terms / conditions — visible on the quote]           │
└────────────────────────────────────────────────────────────────┘

┌─ Upload (Phase 2 placeholder) ─────────────────────────────────┐
│  [📄 Upload PO / PDF]  [🖼 Upload image]   AI extraction — Phase 2 │
└────────────────────────────────────────────────────────────────┘
```

---

## STEP 4: TYPES

```typescript
// In component or src/types/quotes.ts — add if not present

interface SimpleQuoteLine {
  id: string | null          // null for new unsaved lines
  tempId: string             // client-side key
  description: string
  qty: number
  unit: string
  unit_price: number
  total: number              // computed: qty × unit_price
  catalogue_item_id: string | null
  sort_order: number
}

interface SimpleQuote {
  id: string | null
  quote_number: string | null
  title: string
  client_id: string | null
  client_name: string        // for display
  date: string               // ISO date
  valid_until: string        // ISO date
  notes: string
  lines: SimpleQuoteLine[]
  status: string
}
```

---

## STEP 5: SimpleQuoteBuilder.tsx — component spec

### Props
```typescript
interface Props {
  quoteId: string | null   // null = new quote
  companyId: string
  employeeId: string
}
```

### State
```typescript
const [quote, setQuote] = useState<SimpleQuote>(defaultQuote())
const [saving, setSaving] = useState(false)
const [showRatePicker, setShowRatePicker] = useState(false)
```

### Quote meta row
- **Customer**: combobox — search `clients` by name; shows client name + optional
  company. "Add new client" option opens a minimal inline form (name + email).
- **Quote #**: auto-generated via `generate_quote_number` RPC on first save;
  shows "— (auto)" until first save.
- **Date**: date picker, defaults to today.
- **Valid until**: date picker, defaults to today + 14 days. Editable.

### Header buttons
- **Save draft**: saves/updates the quote without changing status.
  On first save: calls `generate_quote_number`, sets `status = 'draft'`.
- **Send →**: saves then changes `status = 'sent'`, shows a confirmation
  modal ("Mark as sent to [client]?"). Does NOT email yet (Phase 2).
  Button label: "Mark as sent" if quote already has lines + client.

### Lines

Each line renders as `SimpleQuoteLineRow`. See Step 6.

**Add line button**: appends a blank line to the bottom.

**From rate card button**: opens `RateCardPicker`. See Step 7.
Each item selected from the rate card appends a pre-filled line.

Lines are reorderable by drag handle (optional — skip if complex, just
use up/down arrows instead).

### Totals (computed, read-only)
```typescript
const subtotal = lines.reduce((s, l) => s + l.total, 0)
const vat = subtotal * 0.15
const total = subtotal + vat
```

Display with `R ${n.toFixed(2)}` formatting.

### Notes
Textarea, placeholder: "Payment terms, warranty, scope exclusions…"
Saves to `commercial_quotes.notes`.

### Auto-save
Debounce 1500ms on any change → saves draft automatically.
Show a subtle "Saved" indicator (fades after 2s) in the header.
On error: show "Save failed — retry" with a manual Save button.

---

## STEP 6: SimpleQuoteLineRow.tsx

```
[⠿]  [Description text input (flex-1)]  [Qty]  [Unit ▼]  [Unit price]  [Total]  [×]
```

- **Drag handle** `⠿`: for reordering (or omit, use ↑↓ buttons)
- **Description**: plain text input, flex-1. Placeholder: "Describe the work or item…"
- **Qty**: number input, min 0.001, default 1, width 70px, right-aligned
- **Unit**: select from UNITS_OF_MEASURE grouped list (src/lib/units.ts).
  Compact — show just the value, not the full label.
  Common units surfaced first: each, hr, day, job, m, m², m³, kg, L, t
- **Unit price**: number input, prefix "R", right-aligned, width 110px.
  Format: `toFixed(2)`. Placeholder "0.00"
- **Total**: read-only, right-aligned. `(qty × unit_price).toFixed(2)`
  Updates live as qty or unit_price changes.
- **×**: remove line. Shown on hover. Last line cannot be removed (or show
  confirmation).

### onChange → parent
Any change to qty or unit_price recalculates `total` and calls
`onUpdate(tempId, { ...changes, total: qty * unit_price })`.

---

## STEP 7: RateCardPicker.tsx

Small popover or bottom sheet, max-w-lg.

```
┌─ Add from rate card ─────────────────────────────── × ─┐
│  [🔍 Search services, materials, labour rates…      ]   │
│  [All] [Services] [Materials] [Labour] [Parts]          │
│  ─────────────────────────────────────────────────────  │
│  Engine flush service          Service   R 450.00  [+]  │
│  Electrician labour            Labour    R 350/hr  [+]  │
│  6mm copper cable              Material  R 45/m    [+]  │
│  Install DB board              Service   R 1,200   [+]  │
└────────────────────────────────────────────────────────┘
```

- Search: debounced 300ms against `quote_catalogue_items` (name, sku, brand)
- Type filter chips: All / Services / Materials / Labour / Parts
- Each result row: name, type badge, default sell price, [+] button
- [+] appends a pre-filled `SimpleQuoteLine` to the parent:
  - description = item name
  - qty = 1
  - unit = item unit_of_measure
  - unit_price = item sell_price ?? item cost_price ?? 0
  - catalogue_item_id = item.id
- Modal stays open; added row flashes "Added ✓" for 1.5s
- Close: × button or click outside

No variant picker for now — if an item has variants, just add the
first/primary variant. Variant selection is a Phase 2 enhancement.

---

## STEP 8: SAVE / LOAD LOGIC

### Create new quote
```typescript
// On first "Save draft" or auto-save:
const { data: quoteData } = await supabase
  .from('commercial_quotes')
  .insert({
    company_id: companyId,
    client_id: quote.client_id,
    quote_number: null,         // will be set by RPC below
    title: quote.title || null,
    status: 'draft',
    quote_date: quote.date,
    valid_until: quote.valid_until,
    notes: quote.notes,
    created_by: employeeId,
  })
  .select('id')
  .single()

// Generate quote number
await supabase.rpc('generate_quote_number', { p_company_id: companyId })
// Store the returned number on the quote row

// Update URL to /quotes/[id] without page reload
router.replace(`/dashboard/money/quotes/${quoteData.id}`)
```

### Save lines (upsert)
```typescript
// Delete removed lines, upsert existing/new ones
await supabase
  .from('commercial_quote_lines')
  .delete()
  .eq('quote_id', quoteId)
  .not('id', 'in', existingLineIds)

await supabase
  .from('commercial_quote_lines')
  .upsert(lines.map((l, i) => ({
    id: l.id ?? undefined,
    company_id: companyId,
    quote_id: quoteId,
    description: l.description,        // check actual column name
    quantity: l.qty,                   // confirmed column: 'quantity'
    unit_of_measure: l.unit,
    unit_sell_price: l.unit_price,     // confirmed column: 'unit_sell_price'
    catalogue_item_id: l.catalogue_item_id,
    sort_order: i,
  })))
```

### Load existing quote
```typescript
const { data } = await supabase
  .from('commercial_quotes')
  .select(`
    *,
    commercial_quote_lines ( * ),
    clients ( id, name )
  `)
  .eq('id', quoteId)
  .single()
```

Map result to `SimpleQuote` state. Sort lines by `sort_order`.

---

## STEP 9: PAGE FILES

```typescript
// src/app/dashboard/money/quotes/new/page.tsx
import { SimpleQuoteBuilder } from '@/components/quotes/SimpleQuoteBuilder'

export default function NewQuotePage() {
  // get companyId + employeeId from session (same pattern as rest of app)
  return <SimpleQuoteBuilder quoteId={null} companyId={...} employeeId={...} />
}

// src/app/dashboard/money/quotes/[id]/page.tsx
export default function EditQuotePage({ params }: { params: { id: string } }) {
  return <SimpleQuoteBuilder quoteId={params.id} companyId={...} employeeId={...} />
}
```

---

## BUILD ORDER

1. Read existing quote files + confirm column names
2. Create `SimpleQuoteLineRow.tsx`
3. Create `RateCardPicker.tsx`
4. Create `SimpleQuoteBuilder.tsx` (wires everything together)
5. Update page files to use `SimpleQuoteBuilder`
6. Test: create a quote, add lines manually, add from rate card, save, reload
7. `tsc --noEmit` — 0 errors

---

## WHAT IS NOT IN THIS BUILD

- Tabs (Request / Stock & Sourcing / Pricing / Preview)
- RFQ board, side panels, supplier sourcing
- Variant picker (Phase 2)
- PDF generation (Phase 2)
- Email sending (Phase 2)
- PO / image AI extraction (Phase 2)
- Stock level display (Phase 2)

The upload buttons stay in the UI with "Phase 2" labels.
Everything else above: do not build, do not leave TODO comments in the code.
Clean, complete, no stubs.

---

## DELIVERABLES

- [ ] `SimpleQuoteBuilder.tsx` — single-screen layout, meta row, lines, totals, notes
- [ ] `SimpleQuoteLineRow.tsx` — description, qty, unit, unit price, live total, remove
- [ ] `RateCardPicker.tsx` — search catalogue, type filters, add to quote, stay open
- [ ] Customer combobox — search clients by name
- [ ] Auto-generated quote number on first save
- [ ] 1500ms debounced auto-save with "Saved" indicator
- [ ] "Save draft" and "Mark as sent" header buttons
- [ ] Subtotal / VAT / Total computed live
- [ ] Load existing quote from DB (edit flow)
- [ ] `tsc --noEmit` — 0 errors
