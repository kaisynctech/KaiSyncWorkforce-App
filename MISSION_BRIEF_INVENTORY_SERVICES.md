# MISSION BRIEF — Unified Inventory & Services Catalogue
## For Claude Code | KaiSync Workforce App

---

## OVERVIEW

Replace the separate Price Catalogue and Inventory pages with a single unified **Inventory & Services** page. One item master covers parts (with stock tracking), services (rates only), materials (stockable consumables), and labour (time-based rates).

**Migration first** — apply `supabase/migrations/20260812000100_inventory_services.sql` via Supabase MCP before touching any UI code.

---

## STEP 0: VERIFY EXISTING TABLE STRUCTURE

Before applying the migration, run:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'quote_catalogue_items'
ORDER BY ordinal_position;
```

The migration uses `ADD COLUMN IF NOT EXISTS` guards so it is safe to run, but note any existing column names that may overlap (e.g., if a `unit` column already exists, keep it — the new column is `unit_of_measure`).

---

## STEP 1: APPLY MIGRATION

Apply `supabase/migrations/20260812000100_inventory_services.sql` via Supabase MCP.

Verify after applying:
```sql
-- Should return rows
SELECT id, name FROM catalogue_conditions WHERE is_standard = true ORDER BY sort_order;
-- Should return 0 (no data yet — new tables)
SELECT COUNT(*) FROM catalogue_item_aliases;
SELECT COUNT(*) FROM catalogue_item_suppliers;
```

---

## STEP 2: TYPES — `src/types/inventory.ts` (new file)

```typescript
export type ItemType = 'part' | 'service' | 'material' | 'labour'

export type AliasType =
  | 'part_number'
  | 'oem_number'
  | 'manufacturer_code'
  | 'barcode'
  | 'name'
  | 'superseded_number'

export interface CatalogueCondition {
  id: string
  company_id: string | null
  name: string
  is_standard: boolean
  sort_order: number
  is_active: boolean
}

export interface CatalogueItem {
  id: string
  company_id: string
  name: string
  description: string | null
  item_type: ItemType
  sku: string | null
  brand: string | null
  condition_id: string | null
  condition?: CatalogueCondition
  variant_group_id: string | null
  unit_of_measure: string
  cost_price: number
  sell_price: number
  markup: number | null
  gross_margin_percent: number | null
  is_stockable: boolean
  qty_on_hand: number
  qty_on_order: number
  qty_reserved: number
  qty_available?: number  // computed: qty_on_hand - qty_reserved
  reorder_point: number | null
  reorder_qty: number | null
  bin_location: string | null
  branch_id: string | null
  is_active: boolean
  internal_notes: string | null
  ai_suggested: boolean
  usage_count: number
  created_at: string
  aliases?: CatalogueItemAlias[]
  suppliers?: CatalogueItemSupplier[]
}

export interface CatalogueItemAlias {
  id: string
  company_id: string
  catalogue_item_id: string
  alias_type: AliasType
  alias_value: string
  notes: string | null
  created_at: string
}

export interface CatalogueItemSupplier {
  id: string
  company_id: string
  catalogue_item_id: string
  supplier_id: string
  supplier?: { id: string; name: string }
  supplier_sku: string | null
  unit_cost: number | null
  lead_time_days: number | null
  min_order_qty: number | null
  is_preferred: boolean
  notes: string | null
  last_price_updated_at: string | null
  created_at: string
}
```

---

## STEP 3: UNITS CONSTANT — `src/lib/units.ts` (new file)

```typescript
export interface UnitOption {
  value: string
  label: string
  group: string
}

export const UNITS_OF_MEASURE: UnitOption[] = [
  // Quantity
  { value: 'each',       label: 'Each',                  group: 'Quantity' },
  { value: 'pair',       label: 'Pair',                  group: 'Quantity' },
  { value: 'set',        label: 'Set',                   group: 'Quantity' },
  { value: 'kit',        label: 'Kit',                   group: 'Quantity' },
  { value: 'lot',        label: 'Lot',                   group: 'Quantity' },
  { value: 'box',        label: 'Box',                   group: 'Quantity' },
  { value: 'case',       label: 'Case',                  group: 'Quantity' },
  { value: 'pack',       label: 'Pack',                  group: 'Quantity' },
  { value: 'roll',       label: 'Roll',                  group: 'Quantity' },
  { value: 'sheet',      label: 'Sheet',                 group: 'Quantity' },
  { value: 'bundle',     label: 'Bundle',                group: 'Quantity' },
  { value: 'pallet',     label: 'Pallet',                group: 'Quantity' },
  // Weight
  { value: 'kg',         label: 'Kilogram (kg)',          group: 'Weight' },
  { value: 'g',          label: 'Gram (g)',               group: 'Weight' },
  { value: 'mg',         label: 'Milligram (mg)',         group: 'Weight' },
  { value: 'tonne',      label: 'Tonne',                 group: 'Weight' },
  { value: 'lb',         label: 'Pound (lb)',             group: 'Weight' },
  { value: 'oz',         label: 'Ounce (oz)',             group: 'Weight' },
  // Volume
  { value: 'litre',      label: 'Litre (L)',             group: 'Volume' },
  { value: 'ml',         label: 'Millilitre (ml)',        group: 'Volume' },
  { value: 'm3',         label: 'Cubic metre (m³)',       group: 'Volume' },
  { value: 'gallon',     label: 'Gallon',                group: 'Volume' },
  { value: 'fl_oz',      label: 'Fluid ounce',           group: 'Volume' },
  // Area
  { value: 'm2',         label: 'Square metre (m²)',      group: 'Area' },
  { value: 'cm2',        label: 'Square centimetre (cm²)',group: 'Area' },
  { value: 'ft2',        label: 'Square foot (ft²)',      group: 'Area' },
  // Length
  { value: 'm',          label: 'Metre (m)',              group: 'Length' },
  { value: 'cm',         label: 'Centimetre (cm)',        group: 'Length' },
  { value: 'mm',         label: 'Millimetre (mm)',        group: 'Length' },
  { value: 'km',         label: 'Kilometre (km)',         group: 'Length' },
  { value: 'ft',         label: 'Foot (ft)',              group: 'Length' },
  { value: 'inch',       label: 'Inch (in)',              group: 'Length' },
  { value: 'yard',       label: 'Yard (yd)',              group: 'Length' },
  // Time / Service
  { value: 'hour',       label: 'Hour',                  group: 'Time' },
  { value: 'half_hour',  label: 'Half hour',             group: 'Time' },
  { value: 'day',        label: 'Day',                   group: 'Time' },
  { value: 'week',       label: 'Week',                  group: 'Time' },
  { value: 'month',      label: 'Month',                 group: 'Time' },
  // Job-based
  { value: 'job',        label: 'Job',                   group: 'Job-based' },
  { value: 'service',    label: 'Service',               group: 'Job-based' },
  { value: 'trip',       label: 'Trip',                  group: 'Job-based' },
  { value: 'visit',      label: 'Visit',                 group: 'Job-based' },
]

export function getUnitLabel(value: string): string {
  return UNITS_OF_MEASURE.find(u => u.value === value)?.label ?? value
}
```

---

## STEP 4: UNIFIED PAGE — `src/app/dashboard/inventory/page.tsx`

Replace (or create) the existing inventory page entirely. Check if the file exists first — if so, replace it.

### Page structure

```
Header: "Inventory & Services"                    [+ Add Item]
─────────────────────────────────────────────────────────────
Tabs: All | Parts | Services | Materials | Labour | Brands | Conditions
─────────────────────────────────────────────────────────────
Search bar | Type filter (if on All tab) | Stock filter | Active toggle
─────────────────────────────────────────────────────────────
Items table / Brands tab / Conditions tab
```

### Data loading

```typescript
// Items
const { data: items } = await supabase
  .from('quote_catalogue_items')
  .select(`
    *,
    condition:catalogue_conditions(id, name),
    aliases:catalogue_item_aliases(*),
    suppliers:catalogue_item_suppliers(
      *,
      supplier:contractors(id, name)
    )
  `)
  .eq('company_id', companyId)
  .eq('is_active', showInactive ? undefined : true)  // toggle
  .order('name')

// Conditions (global + company-specific)
const { data: conditions } = await supabase
  .from('catalogue_conditions')
  .select('*')
  .or(`company_id.is.null,company_id.eq.${companyId}`)
  .eq('is_active', true)
  .order('sort_order')
```

### Tabs: All | Parts | Services | Materials | Labour

Filter `items` client-side by `item_type`. Show item count badge on each tab.

### Items table columns

| Column | Parts | Services | Materials | Labour |
|---|---|---|---|---|
| Name | ✓ | ✓ | ✓ | ✓ |
| SKU / Code | ✓ | ✓ | ✓ | ✓ |
| Brand | ✓ | — | ✓ | — |
| Condition | ✓ | — | — | — |
| Unit | ✓ | ✓ | ✓ | ✓ |
| Cost | ✓ | ✓ | ✓ | ✓ |
| Sell Price | ✓ | ✓ | ✓ | ✓ |
| Margin % | ✓ | ✓ | ✓ | ✓ |
| On Hand | ✓ | — | ✓ | — |
| Suppliers | count badge | — | count badge | — |
| Actions | Edit · Duplicate · Deactivate |

For stockable items where `qty_on_hand <= reorder_point`: show a red warning icon in the On Hand cell.

### Brands tab

```typescript
// Derive from items
const brands = useMemo(() => {
  const map = new Map<string, number>()
  items.forEach(i => {
    if (i.brand) map.set(i.brand, (map.get(i.brand) ?? 0) + 1)
  })
  return Array.from(map.entries())
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => a.brand.localeCompare(b.brand))
}, [items])
```

Display as a simple table: Brand name | Item count | [Filter items] button.
Clicking Filter items switches to the All tab with that brand pre-filtered.

### Conditions tab

Table columns: Name | Standard badge | Item count | Active toggle | [Delete if custom + 0 items]

Add custom condition form at bottom: text input + [Add] button.
On submit: `INSERT INTO catalogue_conditions (company_id, name) VALUES (companyId, name)`.
Prevent adding duplicates (case-insensitive check client-side before insert).

---

## STEP 5: ITEM FORM DRAWER — `src/components/inventory/ItemFormDrawer.tsx`

Slide-in drawer (right side), used for both create and edit.

### Form sections

**Section 1 — Classification**
```
Type:  [Part]  [Service]  [Material]  [Labour]   ← radio buttons / segmented control
Name:  _______________________________________________
SKU / Code: _____________________ (optional)
Description: _________________________________________ (textarea)
```

**Section 2 — Part-specific** (shown only when type = 'part' or 'material')
```
Brand:     [__________] ← autocomplete, calls get_brand_suggestions RPC as user types (300ms debounce)
Condition: [dropdown from catalogue_conditions]
Variant group: [optional UUID — "link to related variants"] ← advanced, collapsed by default
```

**Brand autocomplete behaviour:**
- On focus: load top 10 brands for this company (no query)
- On type: debounce 300ms → call `get_brand_suggestions(companyId, query)` → show dropdown
- On select: populate field with selected brand
- On blur with unrecognised value: normalize via `normalize_brand` RPC before saving
- Store brand as the normalized value (initcap, trimmed)

**Section 3 — Pricing**
```
Unit of measure: [grouped select — uses UNITS_OF_MEASURE constant]
Cost price:      R ________
Sell price:      R ________   ← auto-calculates markup when changed
Markup %:        ________%   ← auto-calculates sell price when changed
Margin %:        ________%   ← display only (read-only, computed)
```

Auto-calc logic (same as existing quote builder):
```typescript
// When cost or sell changes:
markup = cost > 0 ? ((sell - cost) / cost) * 100 : 0
margin = sell > 0 ? ((sell - cost) / sell) * 100 : 0
```

**Section 4 — Stock** (shown only when type = 'part' or 'material')
```
Track stock:    [toggle — sets is_stockable]

(shown when is_stockable = true)
Qty on hand:    ________
Reorder point:  ________
Reorder qty:    ________
Bin location:   ________
```

**Section 5 — Aliases** (collapsible, all types)
```
[+ Add alias]
─────────────────────────────────────────────────
Type           Value                  Notes    [×]
Part number    ABC-123                          [×]
OEM number     XYZ-456                          [×]
─────────────────────────────────────────────────
```
Alias types dropdown: Part number, OEM number, Manufacturer code, Barcode, Alternative name, Superseded number

**Section 6 — Suppliers** (collapsible, all types)
```
[+ Add supplier]
─────────────────────────────────────────────────────────────────
Supplier         Their SKU   Unit cost   Lead time   Preferred  [×]
Supplier A Ltd   XYZ-123     R 45.00     3 days      ★          [×]
Supplier B       —           R 52.00     7 days      ☆          [×]
─────────────────────────────────────────────────────────────────
```
- Supplier dropdown: `contractors WHERE partner_kind = 'supplier'`
- Only one can be preferred (clicking star un-stars others client-side)
- Saved via upsert to `catalogue_item_suppliers`

**Section 7 — Notes**
```
Internal notes: _____________________________________ (textarea, not visible on quotes)
```

### Save logic

On save (create):
1. Normalize brand: call `normalize_brand` RPC if brand is set
2. Insert into `quote_catalogue_items`
3. Upsert aliases (delete removed, insert new)
4. Upsert suppliers (delete removed, insert/update new)
5. If a new preferred supplier is set, ensure others have `is_preferred = false`

On save (edit): same as above but UPDATE the item row first.

On duplicate: clone item row with a new id, same company_id, append " (copy)" to name, reset qty_on_hand to 0.

On deactivate: `UPDATE quote_catalogue_items SET is_active = false WHERE id = ...`

---

## STEP 6: REDIRECT — old catalogue route

Create `src/app/dashboard/money/catalogue/page.tsx`:

```tsx
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CatalogueRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/inventory') }, [router])
  return null
}
```

---

## STEP 7: SIDEBAR UPDATES in `src/components/Sidebar.tsx`

### Operations section — update inventory item label
Find the existing inventory item in the Workforce or Operations section:
```typescript
{ label: 'Inventory', href: '/dashboard/inventory', icon: 'inventory_2', flag: 'inventory' }
```
Change label to `'Inventory & Services'`.

### Money section — rename Price Catalogue entry
Find:
```typescript
{ label: 'Price Catalogue', href: '/dashboard/money/catalogue', icon: 'sell', flag: 'commercial' }
```
Change to:
```typescript
{ label: 'Inventory & Services', href: '/dashboard/inventory', icon: 'inventory_2', flag: 'commercial' }
```

Both entries now point to `/dashboard/inventory` — same page, two access points.

---

## PERMISSIONS

Use existing `catalogue.view` permission to gate the page (already seeded in Phase 1).
No new permission keys needed for this phase.

---

## WHAT DOES NOT CHANGE

- `quote_catalogue_items` RLS policy — unchanged (new columns inherit it)
- Smart pricing RPC (`get_price_suggestions`) — still works on existing columns
- Quote builder — still reads from `quote_catalogue_items`; new columns are additive
- BOQ import (Phase 5) — unchanged
- `inventory_items` table — left in place, untouched

---

## BUILD ORDER

1. Apply migration (Supabase MCP)
2. Verify 12 standard conditions are seeded
3. Create `src/types/inventory.ts`
4. Create `src/lib/units.ts`
5. Create `src/components/inventory/ItemFormDrawer.tsx`
6. Replace `src/app/dashboard/inventory/page.tsx`
7. Create `src/app/dashboard/money/catalogue/page.tsx` (redirect)
8. Update `src/components/Sidebar.tsx` (2 label changes)
9. `tsc --noEmit` — 0 errors

---

## DELIVERABLES

- [ ] Migration applied, conditions seeded, new tables exist
- [ ] `src/types/inventory.ts` with all types
- [ ] `src/lib/units.ts` with 40 unit options
- [ ] Unified page at `/dashboard/inventory` with 7 tabs (All/Parts/Services/Materials/Labour/Brands/Conditions)
- [ ] Type-aware item form drawer (brand autocomplete, condition dropdown, stock fields, aliases, suppliers)
- [ ] Brands tab shows all distinct brands with item count
- [ ] Conditions tab shows standard + custom conditions, add custom form
- [ ] `/dashboard/money/catalogue` redirects to `/dashboard/inventory`
- [ ] Sidebar: both Operations and Money entries say "Inventory & Services" → `/dashboard/inventory`
- [ ] Duplicate and deactivate item actions work
- [ ] `tsc --noEmit` — 0 errors
