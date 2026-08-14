# BRIEF — Request Tab: Add "From catalogue" search
## For Claude Code | KaiSync Workforce App

---

## FILE: `src/components/quotes/tabs/RequestTab.tsx`
## NEW FILE: `src/components/quotes/CatalogueSearchModal.tsx`

---

## OVERVIEW

Two ways to add a line to the quote request — they coexist, both populate
the same lines table:

1. **Manual entry row** (already built) — type code/name/qty for items from
   a customer PO or anything not in your catalogue.
2. **From catalogue** (this brief) — search your inventory and pick an item.
   It lands pre-filled: name, SKU, type, unit all come from the catalogue row.

---

## CHANGE 1 — Add "From catalogue" button to entry row

In `RequestTab.tsx`, next to the existing "Add line" button, add:

```tsx
<button
  onClick={() => setShowCatalogueSearch(true)}
  className="... shrink-0"
  title="Search your inventory"
>
  <span className="material-icons text-[16px]">search</span>
  From catalogue
</button>
```

State: `const [showCatalogueSearch, setShowCatalogueSearch] = useState(false)`

When clicked → renders `<CatalogueSearchModal>` (see below).

---

## CHANGE 2 — New file: `src/components/quotes/CatalogueSearchModal.tsx`

### Props

```typescript
interface Props {
  companyId: string
  onSelect: (item: CatalogueSearchResult) => void
  onClose: () => void
}

interface CatalogueSearchResult {
  id: string                    // catalogue_item_id (or variant id if variant)
  variant_id: string | null
  name: string
  sku: string | null
  item_type: 'part' | 'service' | 'material' | 'labour'
  unit_of_measure: string
  qty_on_hand: number
  is_stockable: boolean
  brand: string | null
  condition_name: string | null  // from catalogue_conditions join
  is_variant: boolean            // true if this row is a variant (has variant_group_id)
  has_variants: boolean          // true if item has multiple variants (is a group)
}
```

### Modal structure

Centred overlay, max-w-2xl, max-h-[80vh].

```
┌────────────────────────────────────────────────────────┐
│  Add from catalogue                                ×   │
│────────────────────────────────────────────────────────│
│  🔍 [Search parts, services, materials...          ]   │
│                                                        │
│  [All] [Parts] [Services] [Materials] [Labour]         │
│────────────────────────────────────────────────────────│
│  (scrollable results list)                             │
│                                                        │
│  ┌─ C18221OC ─────────────────────────────────────┐   │
│  │ Sub set, oil & cooler          [Part]   3 in stock │
│  │ CEP / New                                       │   │
│  └────────────────────────────────── [+ Add] ──────┘   │
│                                                        │
│  ┌─ ENG-FLUSH ─────────────────────────────────────┐  │
│  │ Engine flush service           [Service]  —      │   │
│  └────────────────────────────────── [+ Add] ──────┘   │
│                                                        │
│  ┌─ T123 ──────────────────── 2 variants ──────────┐  │
│  │ Test Part                      [Part]            │   │
│  │  └ CAT / New              12 in stock [+ Add]    │   │
│  │  └ Honda / Aftermarket     5 in stock [+ Add]    │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Search query

Debounced 300ms. Searches `quote_catalogue_items` with a join to
`catalogue_conditions` for condition name:

```typescript
const searchItems = useDebouncedCallback(async (query: string) => {
  setLoading(true)

  let q = supabase
    .from('quote_catalogue_items')
    .select(`
      id,
      name,
      sku,
      item_type,
      unit_of_measure,
      qty_on_hand,
      is_stockable,
      brand,
      variant_group_id,
      is_variant_primary,
      condition_id,
      catalogue_conditions ( name )
    `)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('name')
    .limit(50)

  if (typeFilter !== 'all') {
    q = q.eq('item_type', typeFilter)
  }

  if (query.trim()) {
    q = q.or(`name.ilike.%${query}%,sku.ilike.%${query}%,brand.ilike.%${query}%`)
  }

  const { data } = await q
  setResults(processResults(data ?? []))
  setLoading(false)
}, 300)
```

### processResults — group variants

Items with the same `variant_group_id` are grouped under a parent display row.
The parent shows the base name and "N variants" badge. Each variant shows as a
child row with its brand, condition, and individual stock level.

```typescript
function processResults(rows: RawRow[]): DisplayRow[] {
  const groups = new Map<string, RawRow[]>()
  const standalone: RawRow[] = []

  for (const row of rows) {
    if (row.variant_group_id) {
      const g = groups.get(row.variant_group_id) ?? []
      g.push(row)
      groups.set(row.variant_group_id, g)
    } else {
      standalone.push(row)
    }
  }

  const display: DisplayRow[] = []

  // Standalone items
  for (const row of standalone) {
    display.push({ kind: 'item', item: row })
  }

  // Variant groups — show parent header + child variant rows
  for (const [, members] of groups) {
    const primary = members.find(m => m.is_variant_primary) ?? members[0]
    display.push({ kind: 'group', primary, variants: members })
  }

  return display
}
```

### Rendering each result row

**Standalone item:**
```
┌──────────────────────────────────────────────────────────────┐
│ SKU (monospace, small)                           [Part] badge │
│ Item name (medium weight)              3 in stock / service   │
│ Brand / Condition (if part/material)               [+ Add]   │
└──────────────────────────────────────────────────────────────┘
```

**Variant group:**
```
┌──────────────────────────────────── 2 variants ──────────────┐
│ T123                                             [Part] badge │
│ Test Part                                                     │
│   └ CAT · New           12 in stock             [+ Add]      │
│   └ Honda · Aftermarket  5 in stock             [+ Add]      │
└──────────────────────────────────────────────────────────────┘
```

Child variant rows are indented (pl-6), muted left border, smaller text.
Each child has its own "+ Add" button (not the parent).

**Stock display:**
- `is_stockable = true, qty_on_hand > 0`: green `N in stock`
- `is_stockable = true, qty_on_hand = 0`: amber `Out of stock`
- `is_stockable = false`: grey `—` (not tracked)
- Service/Labour: no stock shown at all

### Empty state
- No query typed: `Search your parts, services, materials and labour above`
- Query with no results: `Nothing found for "[query]" — try a different term, or add it manually using the entry row`

### Loading state
- Skeleton rows (3 placeholder lines) while debounce is running

### Type filter chips
```
[All]  [Parts]  [Services]  [Materials]  [Labour]
```
Active chip: accent border + tint. Clicking a chip re-runs the query
with the type filter applied.

---

## CHANGE 3 — onSelect handler back in RequestTab

When user clicks "+ Add" on a result:

```typescript
function handleCatalogueSelect(result: CatalogueSearchResult) {
  const line: RequestLine = {
    tempId: crypto.randomUUID(),
    catalogue_item_id: result.id,
    variant_id: result.variant_id,
    item_name: result.name,
    item_sku: result.sku,
    item_type: result.item_type,
    qty: 1,
    unit_of_measure: result.unit_of_measure,
    service_delivery: null,
    notes: null,
  }

  setRequestLines(prev => [...prev, line])
  // Keep modal open so user can keep adding more items
  // Show a brief "Added ✓" flash on the row that was just added
}
```

**Keep modal open after each add** so the user can pick several items
without reopening. The added item's row in the modal shows a brief
green "Added ✓" flash for 1.5s, then reverts to the normal "+ Add" button.

Close modal: the × button or clicking the overlay.

---

## LINES TABLE UPDATE

Rows added from catalogue display a small `📦 catalogue` source indicator
in a new "Source" column (or as a subtle tag on the row):

| # | Type | Code | Name | Qty | Unit | Source | × |
|---|---|---|---|---|---|---|---|
| 1 | Part | C18221OC | Sub set, oil & cooler | 1 | each | `catalogue` | × |
| 2 | Part | FLT-OIL-2 | — | 2 | each | `manual` | × |
| 3 | Service | — | Engine flush | 1 | job | `manual` | × |

Source badge: small pill, `catalogue` = accent tint, `manual` = grey.
Not a critical column — keep it subtle. Could be a small icon rather than text.

---

## BUILD ORDER

1. Create `src/components/quotes/CatalogueSearchModal.tsx`
2. Update `RequestTab.tsx`:
   - Add `showCatalogueSearch` state + "From catalogue" button
   - Add `handleCatalogueSelect` handler
   - Render `CatalogueSearchModal` when open
   - Update lines table with source indicator
3. `tsc --noEmit` — 0 errors

---

## DELIVERABLES

- [ ] `CatalogueSearchModal` — search input, type filter chips, debounced query
- [ ] Results grouped: standalone items + variant groups with child rows
- [ ] Variant child rows each have their own "+ Add" button
- [ ] "Added ✓" flash on row after adding, modal stays open
- [ ] Stock level shown on stockable items (green/amber)
- [ ] Empty state and loading skeletons
- [ ] "From catalogue" button in RequestTab entry row opens the modal
- [ ] Selected items land in lines table as pre-filled RequestLine (catalogue_item_id set)
- [ ] Source indicator (catalogue vs manual) shown subtly on each row
- [ ] `tsc --noEmit` — 0 errors
