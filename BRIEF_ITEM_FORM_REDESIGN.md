# BRIEF — Item Form: Full-screen Modal + Tabs
## For Claude Code | KaiSync Workforce App

---

## FILE: `src/components/inventory/ItemFormDrawer.tsx`

Three changes only. All save/load logic stays exactly the same.

---

## CHANGE 1 — Rename "Aliases" → "Alternative numbers"

Every instance of "Aliases", "alias", "ALIASES", "Add alias" in this file:

| Old | New |
|---|---|
| Section header `ALIASES` | `ALTERNATIVE NUMBERS` |
| Button `+ Add alias` | `+ Add alternative number` |
| Column header `Alias type` | `Number type` |
| `alias_type` dropdown label | `Type` |
| Any other user-facing "alias" text | "alternative number" |

TypeScript type/variable names (`aliasType`, `aliases`, etc.) do NOT change — only displayed strings.

---

## CHANGE 2 — Full-screen modal instead of side drawer

Replace the slide-in side panel with a centred full-screen modal overlay.

```tsx
// Outer overlay
<div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
  {/* Modal container — full screen with some padding */}
  <div className="bg-background rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

    {/* Header */}
    <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
      <h2 className="text-[16px] font-semibold text-text-primary">
        {item ? 'Edit Item' : 'Add Item'}
      </h2>
      <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
        <span className="material-icons">close</span>
      </button>
    </div>

    {/* Tab bar */}
    <div className="flex border-b border-divider px-6 shrink-0">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            'px-4 py-3 text-[13px] border-b-2 transition-colors -mb-px',
            activeTab === tab.id
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-text-secondary hover:text-text-primary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>

    {/* Tab content — scrollable */}
    <div className="flex-1 overflow-y-auto px-6 py-5">
      {/* render active tab content */}
    </div>

    {/* Footer */}
    <div className="flex justify-end gap-3 px-6 py-4 border-t border-divider shrink-0">
      <button onClick={onClose} className="...">Cancel</button>
      <button onClick={handleSave} className="...">
        {item ? 'Save changes' : 'Add item'}
      </button>
    </div>

  </div>
</div>
```

---

## CHANGE 3 — Organize into 4 tabs

```typescript
const TABS = [
  { id: 'details',      label: 'Details' },
  { id: 'pricing',      label: 'Pricing' },
  { id: 'stock',        label: 'Stock & Suppliers' },
  { id: 'alternatives', label: 'Alternative numbers' },
]
```

Add state: `const [activeTab, setActiveTab] = useState<string>('details')`

### Tab 1 — Details
- Type segmented control (Part / Service / Material / Labour)
- Name (required)
- SKU / Code
- Description (textarea)
- Brand (autocomplete) — shown for Part and Material only
- Condition (dropdown) — shown for Part only
- Unit of measure (grouped select)

### Tab 2 — Pricing
- Cost price
- Sell price
- Markup % (auto-calc from cost ↔ sell)
- Gross margin % (read-only, computed)
- Layout: 2-column grid for the four fields

### Tab 3 — Stock & Suppliers
**Stock section** (shown for Part and Material only):
- Track stock toggle
- When on: Qty on hand, Reorder point, Reorder qty, Bin / Location (2-column grid)

**Suppliers section** (all types):
- Section sub-heading: "Suppliers"
- Same multi-supplier table as before (supplier dropdown, their SKU, unit cost, lead time, preferred star)
- `+ Add supplier` button

**Notes** section at bottom of this tab:
- Internal notes textarea
- "Not visible on quotes or invoices" helper text

### Tab 4 — Alternative numbers
- Same content as old Aliases section
- Table of existing alternatives: Type | Value | Notes | [×]
- `+ Add alternative number` button
- Type options: Part number, OEM number, Manufacturer code, Barcode, Alternative name, Superseded number

---

## VALIDATION

- "Details" tab: show a red dot on the tab label if Name is empty on save attempt
- Required fields: Name (Details tab), Type (Details tab)
- On save attempt with errors: switch to the tab that contains the first error

---

## DELIVERABLES

- [ ] "Aliases" / "Add alias" renamed to "Alternative numbers" / "Add alternative number" throughout
- [ ] Form is a centred full-screen modal (max-w-4xl, max-h-90vh) — not a side drawer
- [ ] 4 tabs: Details · Pricing · Stock & Suppliers · Alternative numbers
- [ ] Notes moved into Stock & Suppliers tab (bottom)
- [ ] All existing save/load/autocomplete logic unchanged
- [ ] Tab with validation error gets a red indicator dot on save attempt
- [ ] `tsc --noEmit` — 0 errors
