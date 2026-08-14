# BRIEF — Request Tab: Smart inline entry row
## For Claude Code | KaiSync Workforce App

---

## FILE: `src/components/quotes/tabs/RequestTab.tsx`

---

## THE PROBLEM

Tab 1 is data ENTRY — the user is transcribing what the customer asked for.
It must handle parts, services, materials, and labour. Not everything has a
part number. The entry row must adapt to the item type so the right fields
appear and nothing feels wrong.

Catalogue matching (looking up what you have) happens in Tab 2. Tab 1 just
captures the raw request as fast as possible.

---

## REMOVE

- The `Search part number, name, or SKU to add a line...` search input with
  any catalogue dropdown / debounce / autocomplete behaviour
- The large dashed drop zone area
- Keep the two upload buttons (Upload PO / PDF, Upload image) in the action
  bar — add a muted pill label next to them: `AI extraction — Phase 2`
- The Type column from the lines table (resolved in Tab 2)
- The ServiceDeliveryToggle from Tab 1 (moved to Tab 2)

---

## ADD — adaptive inline entry row

```tsx
// Entry row fixed at bottom of the lines area, above "Process items"
<div className="flex gap-2 items-center px-4 py-3 border-t border-divider bg-surface-1 flex-wrap">

  {/* Type selector */}
  <select
    value={newType}
    onChange={e => handleTypeChange(e.target.value)}
    className="... w-28 shrink-0"
  >
    <option value="part">Part</option>
    <option value="service">Service</option>
    <option value="material">Material</option>
    <option value="labour">Labour</option>
  </select>

  {/* Code field — shown for part + material only */}
  {(newType === 'part' || newType === 'material') && (
    <div className="relative w-44 shrink-0">
      <input
        ref={codeInputRef}
        type="text"
        placeholder="Part number / SKU"
        value={newCode}
        onChange={e => { setNewCode(e.target.value); triggerCatalogueCheck(e.target.value) }}
        onKeyDown={handleKeyDown}
        className="... w-full pr-20"
      />
      {/* Catalogue check indicator — right-aligned inside the input */}
      {catalogueStatus === 'found' && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-green-600 font-medium">
          ✓ in catalogue
        </span>
      )}
      {catalogueStatus === 'not_found' && newCode.length > 2 && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-secondary">
          not found
        </span>
      )}
    </div>
  )}

  {/* Description field — always shown; required for service + labour */}
  <input
    type="text"
    placeholder={
      newType === 'part' || newType === 'material'
        ? 'Name / description (optional)'
        : newType === 'service'
        ? 'Service description *'
        : 'Labour description *'
    }
    value={newName}
    onChange={e => setNewName(e.target.value)}
    onKeyDown={handleKeyDown}
    className="... flex-1 min-w-[160px]"
  />

  {/* Qty */}
  <input
    type="number"
    placeholder="Qty"
    min={0.001}
    step="any"
    value={newQty}
    onChange={e => setNewQty(e.target.value)}
    onKeyDown={handleKeyDown}
    className="... w-16 text-right shrink-0"
  />

  {/* Unit */}
  <select
    value={newUnit}
    onChange={e => setNewUnit(e.target.value)}
    className="... w-24 shrink-0"
  >
    {/* Units from src/lib/units.ts UNITS_OF_MEASURE */}
    <option value="each">each</option>
    <option value="job">job</option>
    <option value="hr">hr</option>
    <option value="kg">kg</option>
    <option value="L">L</option>
    <option value="m">m</option>
    {/* etc — render all 40 units from the grouped list */}
  </select>

  <button onClick={addLine} className="... shrink-0">
    <span className="material-icons text-[16px]">add</span> Add line
  </button>
</div>
```

---

## TYPE CHANGE HANDLER

When type changes, smart-default the unit:

```typescript
function handleTypeChange(type: string) {
  setNewType(type as ItemType)
  setNewCode('')        // clear code when switching type
  setCatalogueStatus(null)
  // Smart unit defaults
  if (type === 'service') setNewUnit('job')
  else if (type === 'labour') setNewUnit('hr')
  else setNewUnit('each')
  // Focus the right field
  if (type === 'part' || type === 'material') {
    codeInputRef.current?.focus()
  } else {
    nameInputRef.current?.focus()
  }
}
```

---

## CATALOGUE CHECK (lightweight, non-blocking)

Debounced 400ms. Only fires for part/material when code.length >= 2.
Does NOT block adding the line — purely informational.

```typescript
const triggerCatalogueCheck = useDebouncedCallback(async (code: string) => {
  if (!code || code.length < 2) { setCatalogueStatus(null); return }
  if (newType !== 'part' && newType !== 'material') return

  const { data } = await supabase
    .from('quote_catalogue_items')
    .select('id, name')
    .eq('company_id', companyId)
    .or(`sku.ilike.${code}%,name.ilike.${code}%`)
    .eq('is_active', true)
    .limit(1)

  if (data && data.length > 0) {
    setCatalogueStatus('found')
    // Auto-fill name if description is blank
    if (!newName && data[0].name) setNewName(data[0].name)
  } else {
    setCatalogueStatus('not_found')
  }
}, 400)
```

State: `const [catalogueStatus, setCatalogueStatus] = useState<'found'|'not_found'|null>(null)`

---

## ADD LINE — validation and reset

```typescript
function addLine() {
  const code = newCode.trim()
  const name = newName.trim()

  // Validation
  if (newType === 'part' || newType === 'material') {
    if (!code && !name) { focusWithShake(codeInputRef); return }
  } else {
    // service / labour — description required
    if (!name) { focusWithShake(nameInputRef); return }
  }

  const qty = parseFloat(newQty)
  if (!qty || qty <= 0) { focusWithShake(qtyInputRef); return }

  const line: RequestLine = {
    tempId: crypto.randomUUID(),
    catalogue_item_id: null,
    variant_id: null,
    item_name: name || code,
    item_sku: code || null,
    item_type: newType as ItemType,
    qty,
    unit_of_measure: newUnit,
    service_delivery: null,
    notes: null,
  }

  setRequestLines(prev => [...prev, line])

  // Reset for next line — keep type (user is probably adding more of the same type)
  setNewCode('')
  setNewName('')
  setNewQty('1')
  setCatalogueStatus(null)
  codeInputRef.current?.focus()   // or nameInputRef for service/labour
}
```

Enter key on any field calls `addLine()`:
```typescript
function handleKeyDown(e: React.KeyboardEvent) {
  if (e.key === 'Enter') { e.preventDefault(); addLine() }
}
```

---

## LINES TABLE

Updated columns — Type column added back (now set during entry, not Tab 2):

| Column | Notes |
|---|---|
| # | sequence |
| Type | badge: Part / Service / Material / Labour |
| Code | SKU — shown only for part/material rows; "—" for service/labour |
| Name / description | always shown |
| Qty | editable inline |
| Unit | editable inline (select) |
| Catalogue | small indicator: `✓ in catalogue` (green) / `not found` (grey) / blank if not checked |
| × | remove row |

The Catalogue column populates for rows where a check was done. For rows
added without a check (fast keyboard entry), it stays blank — Tab 2 runs its
own matching regardless.

---

## EMPTY STATE

When `requestLines.length === 0`:

```
┌─────────────────────────────────────────────────────────────┐
│  #   Type   Code   Name / description   Qty   Unit   Cat.   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Add items below — enter part numbers, services,            │
│  materials, or labour that your customer is requesting      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## DELIVERABLES

- [ ] Drop zone removed; upload buttons remain with muted "Phase 2" label
- [ ] Entry row: type selector (Part/Service/Material/Labour) + adaptive fields
- [ ] Code field visible for Part + Material; hidden for Service + Labour
- [ ] Smart unit default on type change (job for service, hr for labour, each otherwise)
- [ ] Background catalogue check (debounced 400ms) — shows "✓ in catalogue" / "not found" inline
- [ ] Auto-fills description from catalogue hit if description field is blank
- [ ] Enter on any entry field calls addLine(), refocuses first field for next entry
- [ ] Type badge shows in lines table
- [ ] Validation: service/labour require description; part/material require code or name; qty > 0
- [ ] `tsc --noEmit` — 0 errors
