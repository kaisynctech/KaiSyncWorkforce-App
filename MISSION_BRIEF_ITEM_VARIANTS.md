# MISSION BRIEF — Item Variants
## For Claude Code | KaiSync Workforce App

---

## OVERVIEW

A single part (same name + SKU) can exist in multiple brand / condition combinations,
each with its own independent stock quantity.

Example:
- T123 "Test Part" — CAT / New — 50 in stock
- T123 "Test Part" — Honda / Aftermarket — 20 in stock
- Total displayed in inventory: 70

Design: each variant is its own row in `quote_catalogue_items`, linked by `variant_group_id`.
One row per group carries `is_variant_primary = true` (the original/master).
Non-variant items are untouched (`variant_group_id IS NULL`).

Stock adjustments already work — `record_stock_adjustment` references the specific
variant row (catalogue_item_id), so nothing changes in the RPC.

---

## STEP 1: APPLY MIGRATION

Apply `supabase/migrations/20260812000300_item_variants.sql` via Supabase MCP.

Verify:
```sql
-- Column added
SELECT column_name FROM information_schema.columns
WHERE table_name = 'quote_catalogue_items'
  AND column_name = 'is_variant_primary';
-- → 1 row

-- RPCs created
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_variant_group', 'add_item_variant');
-- → 2 rows
```

---

## STEP 2: TYPES — update `src/types/inventory.ts`

Add to `CatalogueItem`:
```typescript
export interface CatalogueItem {
  // ... existing fields ...
  variant_group_id:   string | null   // already present — confirm it's typed
  is_variant_primary: boolean         // NEW
}
```

Add new types:
```typescript
// Returned by get_variant_group RPC
export interface ItemVariant {
  id:                 string
  name:               string
  sku:                string | null
  brand:              string | null
  condition_id:       string | null
  condition_name:     string | null
  item_type:          ItemType
  unit_of_measure:    string
  sell_price:         number | null
  cost_price:         number | null
  qty_on_hand:        number
  qty_available:      number
  is_stockable:       boolean
  is_variant_primary: boolean
  variant_group_id:   string | null
}
```

---

## STEP 3: INVENTORY PAGE — grouped variant rows

File: `src/app/dashboard/inventory/page.tsx`

### Group items by variant_group_id

After fetching items, group them client-side:

```typescript
type DisplayRow =
  | { kind: 'standalone'; item: CatalogueItem }
  | { kind: 'group';      primary: CatalogueItem; variants: CatalogueItem[]; totalQty: number; expanded: boolean }
  | { kind: 'variant';    item: CatalogueItem; groupId: string }

function buildDisplayRows(items: CatalogueItem[]): Omit<DisplayRow, 'expanded'>[] {
  const groups = new Map<string, CatalogueItem[]>()
  const standalone: CatalogueItem[] = []

  for (const item of items) {
    if (!item.variant_group_id) {
      standalone.push(item)
    } else {
      const g = groups.get(item.variant_group_id) ?? []
      g.push(item)
      groups.set(item.variant_group_id, g)
    }
  }

  const rows: Omit<DisplayRow, 'expanded'>[] = []

  for (const item of standalone) {
    rows.push({ kind: 'standalone', item })
  }

  for (const [, members] of groups) {
    const primary = members.find(m => m.is_variant_primary) ?? members[0]
    const totalQty = members.reduce((sum, m) => sum + (m.qty_on_hand ?? 0), 0)
    rows.push({ kind: 'group', primary, variants: members, totalQty })
  }

  return rows
}
```

Add state: `const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())`

### Rendering

**Group header row** (replaces the individual item row):
```
▶  T123  Test Part                [Part]   70 total   2 variants   [+ Add variant]  [Edit]
```
- Chevron icon (▶ / ▼) toggles expansion — `expandedGroups` set
- Name + SKU from the primary item
- "70 total" = sum of all variants' qty_on_hand in `text-text-secondary text-[12px]`
- "2 variants" badge
- "+ Add variant" button → opens `ItemFormDrawer` in "add variant" mode (see Step 4)
- "Edit" → opens ItemFormDrawer on the primary item

**Expanded variant child rows** (indented, shown when group is expanded):
```
    └─  CAT / New              50 in stock   Bin A-1   [Adjust]  [Edit]  [✕ Remove variant]
    └─  Honda / Aftermarket    20 in stock   Bin B-3   [Adjust]  [Edit]  [✕ Remove variant]
```
- 2rem left indent (`pl-8`)
- Brand + " / " + Condition name (from `condition_id` join — you may need to fetch conditions separately if not already loaded)
- qty_on_hand, bin_location
- Adjust icon button → opens StockAdjustmentModal for that specific variant item
- Edit → opens ItemFormDrawer on that variant item
- Remove variant → deactivates the variant (`is_active = false`) with a confirmation dialog;
  if only 1 variant remains, also clear `variant_group_id` and `is_variant_primary` on that last row (it becomes standalone)

**Standalone rows**: render exactly as before.

---

## STEP 4: ITEM FORM — Variants section

File: `src/components/inventory/ItemFormDrawer.tsx`

### When to show the Variants section

Show only when:
- `item.item_type === 'part'` OR `item.item_type === 'material'`
- AND `editMode` (existing item, not create)

Place the Variants section at the bottom of the **Details tab**, below all other fields,
separated by a divider.

### "Add variant" mode

When opening the form from the "Add variant" button on a group header,
pass a prop `variantSourceId: string | null` (the primary item's id).

If `variantSourceId` is set:
- Lock the Name, SKU, and Type fields (read-only, inherited from source)
- Show only Brand, Condition, and (in Stock tab) stock fields — user fills these in
- Save calls `add_item_variant` RPC instead of the normal insert:

```typescript
if (variantSourceId) {
  const { data: newId, error } = await supabase.rpc('add_item_variant', {
    p_company_id:   companyId,
    p_source_id:    variantSourceId,
    p_brand:        brand || null,
    p_condition_id: conditionId || null,
  })
  if (error) { showError(error.message); return }
  // optionally open the new item to fill in stock/pricing after creation
  onSaved()
  return
}
```

### Variants section (edit mode, existing item in a group)

When editing an existing item that has `variant_group_id IS NOT NULL`:

```
─── Variants ──────────────────────────────────── [+ Add variant]
Brand             Condition       Stock    
CAT               New             50       [Edit]
Honda             Aftermarket     20       [Edit]
```

- "Edit" on a sibling variant opens that variant's ItemFormDrawer
- "+ Add variant" → calls `add_item_variant` with this item as source, then refreshes list
- If item has no `variant_group_id` yet, show:
  ```
  This item has no variants yet.  [+ Add a variant]
  ```
  Clicking "Add a variant" calls `add_item_variant` to create the first variant,
  which will also assign `variant_group_id` to this item and set `is_variant_primary = true`.

Load sibling variants:
```typescript
useEffect(() => {
  if (!item?.id || !item.variant_group_id) return
  supabase.rpc('get_variant_group', {
    p_company_id: companyId,
    p_item_id: item.id,
  }).then(({ data }) => setVariants(data ?? []))
}, [item?.id, item?.variant_group_id])
```

---

## STEP 5: QUOTE BUILDER — variant picker

File: wherever quote line items are added (likely `src/components/quotes/QuoteLineItem.tsx`
or the quote form page — find the part number / item search input).

### When to show the picker

After the user selects an item from the search dropdown (or types a SKU):

```typescript
async function handleItemSelected(selectedItem: CatalogueItem) {
  if (!selectedItem.variant_group_id) {
    // standalone — add directly
    addLineItem(selectedItem)
    return
  }

  // Has variants — fetch the group
  const { data: variants } = await supabase.rpc('get_variant_group', {
    p_company_id: companyId,
    p_item_id: selectedItem.id,
  })

  if (!variants || variants.length <= 1) {
    addLineItem(selectedItem)
    return
  }

  // Show variant picker
  setPendingVariants(variants)
  setShowVariantPicker(true)
}
```

### Variant picker UI

Small modal / popover, max-w-sm:

```
┌────────────────────────────────────────────────────┐
│  Select variant — T123 Test Part               ×   │
│────────────────────────────────────────────────────│
│  ○  CAT  /  New              50 available          │
│  ○  Honda / Aftermarket      20 available          │
│                                                    │
│                         [Cancel]  [Add to quote]   │
└────────────────────────────────────────────────────┘
```

- Radio list of all variants in the group
- Each row: Brand / Condition name · qty_available (green if > 0, amber if 0)
- "Add to quote" disabled until one is selected
- On confirm: `addLineItem(selectedVariant)` using the chosen variant's id as `catalogue_item_id`

State:
```typescript
const [pendingVariants, setPendingVariants] = useState<ItemVariant[]>([])
const [showVariantPicker, setShowVariantPicker] = useState(false)
const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
```

Component name: `VariantPickerModal` — new file `src/components/quotes/VariantPickerModal.tsx`

---

## BUILD ORDER

1. Apply migration
2. Update types in `src/types/inventory.ts`
3. Create `src/components/quotes/VariantPickerModal.tsx`
4. Update `src/app/dashboard/inventory/page.tsx` — grouped variant rows
5. Update `src/components/inventory/ItemFormDrawer.tsx` — Variants section + "add variant" mode
6. Wire `VariantPickerModal` into the quote builder item selection
7. `tsc --noEmit` — 0 errors

---

## KEY RULES

- Non-variant items (variant_group_id IS NULL) are completely unaffected — no regressions
- `record_stock_adjustment` RPC needs NO changes — it already references catalogue_item_id (the specific variant row)
- Stock adjustments, suppliers, aliases are all per-variant (each variant is its own catalogue item row)
- Pricing inherits from source on clone but can be edited independently per variant after creation
- Removing the last variant of a group: clear variant_group_id on that item (becomes standalone) via direct UPDATE

---

## DELIVERABLES

- [ ] Migration applied — `is_variant_primary` column, indexes, `get_variant_group` + `add_item_variant` RPCs
- [ ] `ItemVariant` type added to `src/types/inventory.ts`
- [ ] Inventory page groups variant rows under an expandable header with total qty
- [ ] Item form Details tab shows Variants section (edit mode, parts/materials only)
- [ ] "+ Add variant" opens the form in locked/clone mode, saves via `add_item_variant` RPC
- [ ] `VariantPickerModal` shows brand/condition/stock for each variant, user picks one
- [ ] Quote builder shows picker when selected item has variants
- [ ] `tsc --noEmit` — 0 errors
