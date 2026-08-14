# MISSION BRIEF — Stock Adjustment Log
## For Claude Code | KaiSync Workforce App

---

## OVERVIEW

Every change to a stock level needs a reason and an audit trail. This phase adds:
1. A `StockAdjustmentModal` — simple form to record any stock change
2. A stock history panel inside the `ItemFormDrawer` (Stock & Suppliers tab)
3. An "Adjust" quick-action on every stockable item row in the inventory page

All stock changes go through the `record_stock_adjustment` RPC — never a direct UPDATE.

---

## STEP 1: APPLY MIGRATION

Apply `supabase/migrations/20260812000200_stock_adjustments.sql` via Supabase MCP.

Verify:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'stock_adjustments';
-- should return 1 row

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'record_stock_adjustment';
-- should return 1 row
```

---

## STEP 2: TYPES — add to `src/types/inventory.ts`

```typescript
export type AdjustmentType =
  | 'received'
  | 'returned_by_customer'
  | 'count_correction'
  | 'damaged'
  | 'internal_use'
  | 'transferred_in'
  | 'transferred_out'
  | 'sold'
  | 'other'

export interface StockAdjustment {
  id: string
  company_id: string
  catalogue_item_id: string
  adjusted_by: string | null
  adjusted_by_name?: string       // from view
  adjustment_type: AdjustmentType
  qty_change: number              // signed: positive = added, negative = removed
  qty_before: number
  qty_after: number
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  created_at: string
}

// Returned by record_stock_adjustment RPC
export interface AdjustmentResult {
  adjustment_id: string
  qty_before: number
  qty_after: number
  qty_change: number
}
```

---

## STEP 3: ADJUSTMENT TYPE CONFIG — add to `src/lib/stock.ts` (new file)

```typescript
import type { AdjustmentType } from '@/types/inventory'

export interface AdjustmentTypeConfig {
  value: AdjustmentType
  label: string
  direction: 'in' | 'out' | 'either'  // controls default sign of qty
  colour: string                        // Tailwind text colour class
  icon: string                          // Material Icon name
}

export const ADJUSTMENT_TYPES: AdjustmentTypeConfig[] = [
  { value: 'received',             label: 'Received stock',          direction: 'in',    colour: 'text-green-600',  icon: 'add_circle' },
  { value: 'returned_by_customer', label: 'Customer return',         direction: 'in',    colour: 'text-blue-600',   icon: 'keyboard_return' },
  { value: 'count_correction',     label: 'Stock count correction',  direction: 'either',colour: 'text-amber-600',  icon: 'fact_check' },
  { value: 'damaged',              label: 'Damaged / write-off',     direction: 'out',   colour: 'text-red-600',    icon: 'broken_image' },
  { value: 'internal_use',         label: 'Internal use',            direction: 'out',   colour: 'text-orange-600', icon: 'build' },
  { value: 'transferred_in',       label: 'Transferred in',          direction: 'in',    colour: 'text-teal-600',   icon: 'move_to_inbox' },
  { value: 'transferred_out',      label: 'Transferred out',         direction: 'out',   colour: 'text-teal-600',   icon: 'outbox' },
  { value: 'other',                label: 'Other',                   direction: 'either',colour: 'text-gray-600',   icon: 'tune' },
]

export function getAdjustmentConfig(type: AdjustmentType): AdjustmentTypeConfig {
  return ADJUSTMENT_TYPES.find(t => t.value === type) ?? ADJUSTMENT_TYPES[ADJUSTMENT_TYPES.length - 1]
}

// Format signed qty for display: +5 or -3
export function fmtQtyChange(qty: number): string {
  return qty > 0 ? `+${qty}` : `${qty}`
}
```

---

## STEP 4: `StockAdjustmentModal` — new file `src/components/inventory/StockAdjustmentModal.tsx`

### Props
```typescript
interface Props {
  item: CatalogueItem           // the item being adjusted
  companyId: string
  employeeId: string            // current user's employee id
  onClose: () => void
  onSaved: (newQty: number) => void  // updates parent row optimistically
}
```

### Modal structure

Centred modal, max-w-md.

```
┌─────────────────────────────────────────────────────┐
│ Adjust stock — [Item name]                       ×  │
│─────────────────────────────────────────────────────│
│ Current stock:  20  each                            │
│                                                     │
│ Type  [dropdown — ADJUSTMENT_TYPES]                 │
│                                                     │
│ Quantity  [  5  ]   ← always positive input         │
│           ○ Add stock   ● Remove stock              │
│           (direction radio — auto-set by type,      │
│            locked for in/out types, free for either)│
│                                                     │
│ New total: 15 each   ← live preview                 │
│                                                     │
│ Notes  [________________________]                   │
│        (required when type = 'other' or             │
│         adjustment_type = 'count_correction')       │
│                                                     │
│              [Cancel]  [Record adjustment]          │
└─────────────────────────────────────────────────────┘
```

### Direction logic

```typescript
// When type changes:
useEffect(() => {
  const config = getAdjustmentConfig(type)
  if (config.direction === 'in')  setDirection('add')
  if (config.direction === 'out') setDirection('remove')
  // 'either' — leave direction as user last set it
}, [type])

// Compute signed qty_change:
const qtyChange = direction === 'add' ? qty : -qty

// Live preview:
const newTotal = item.qty_on_hand + qtyChange
```

### Validation
- `qty` must be > 0
- `notes` required when type is `'other'` or `'count_correction'`
- Show error if `newTotal < 0`: "This would bring stock below zero. Add a note to confirm." — allow saving with `p_allow_negative = false` (RPC will reject it unless override). For manual adjustments, do NOT allow negative stock — show an inline error and block save.

### Save
```typescript
const { data, error } = await supabase.rpc('record_stock_adjustment', {
  p_company_id:        companyId,
  p_catalogue_item_id: item.id,
  p_adjusted_by:       employeeId,
  p_adjustment_type:   type,
  p_qty_change:        qtyChange,
  p_notes:             notes || null,
  p_reference_type:    'manual',
  p_reference_id:      null,
  p_allow_negative:    false,
})

if (error) { showError(error.message); return }
onSaved((data as AdjustmentResult).qty_after)
```

---

## STEP 5: STOCK HISTORY PANEL — in `src/components/inventory/ItemFormDrawer.tsx`

In the **Stock & Suppliers** tab, below the stock fields and above the Suppliers section, add:

### Load adjustment history (when editing an existing item)
```typescript
// In the item form's useEffect when item.id is set:
if (item?.id && item.is_stockable) {
  const { data } = await supabase
    .from('stock_adjustment_history')
    .select('*')
    .eq('catalogue_item_id', item.id)
    .order('created_at', { ascending: false })
    .limit(20)
  setAdjustments(data ?? [])
}
```

### Render

```
─── Stock history ────────────────────────────────── [Adjust stock ↑]
Date          Type                 Change    Balance  By
14 Aug 2026   Received stock       +20       20       Nyarie N.
13 Aug 2026   Count correction     -2        0        Nyarie N.
(empty state: "No stock movements yet")
```

- "Adjust stock" button in the section header → opens `StockAdjustmentModal`
- After `onSaved`: refresh adjustment list + update `item.qty_on_hand` in form state
- `qty_change` displayed with `fmtQtyChange()` — green for positive, red for negative
- Show last 20 rows; if more exist show "View all movements" text (no separate page yet)
- Only show this section when `item.is_stockable === true` AND `item.id` exists (edit mode only, not create)

---

## STEP 6: INVENTORY PAGE — quick-action on stockable item rows

In `src/app/dashboard/inventory/page.tsx`, on each row where `item.is_stockable === true`:

Add an **"Adjust"** button to the row actions (alongside Edit · Duplicate · Deactivate):

```tsx
{item.is_stockable && (
  <button
    onClick={() => { setAdjustingItem(item); setShowAdjustModal(true) }}
    className="text-text-secondary hover:text-primary transition-colors text-[12px]"
    title="Adjust stock"
  >
    <span className="material-icons text-[16px]">tune</span>
  </button>
)}
```

Add state:
```typescript
const [adjustingItem, setAdjustingItem] = useState<CatalogueItem | null>(null)
const [showAdjustModal, setShowAdjustModal] = useState(false)
```

Render modal:
```tsx
{showAdjustModal && adjustingItem && (
  <StockAdjustmentModal
    item={adjustingItem}
    companyId={companyId}
    employeeId={employee.id}
    onClose={() => { setShowAdjustModal(false); setAdjustingItem(null) }}
    onSaved={(newQty) => {
      setItems(prev => prev.map(i =>
        i.id === adjustingItem.id ? { ...i, qty_on_hand: newQty } : i
      ))
      setShowAdjustModal(false)
      setAdjustingItem(null)
    }}
  />
)}
```

---

## BUILD ORDER

1. Apply migration
2. Add types to `src/types/inventory.ts`
3. Create `src/lib/stock.ts`
4. Create `src/components/inventory/StockAdjustmentModal.tsx`
5. Update `src/components/inventory/ItemFormDrawer.tsx` (history panel + Adjust button)
6. Update `src/app/dashboard/inventory/page.tsx` (Adjust quick-action on rows)
7. `tsc --noEmit` — 0 errors

---

## DELIVERABLES

- [ ] Migration applied — `stock_adjustments` table + `record_stock_adjustment` RPC + `stock_adjustment_history` view
- [ ] Types added to `src/types/inventory.ts`
- [ ] `src/lib/stock.ts` with ADJUSTMENT_TYPES config + helpers
- [ ] `StockAdjustmentModal` — type dropdown, qty input, direction control, live preview, notes, save via RPC
- [ ] Item form Stock & Suppliers tab — shows last 20 adjustments, "Adjust stock" button
- [ ] Inventory page row — "Adjust" icon button on stockable items
- [ ] Qty on hand updates optimistically after adjustment (no full page reload)
- [ ] `tsc --noEmit` — 0 errors
