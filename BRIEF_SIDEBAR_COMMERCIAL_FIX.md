# BRIEF — Fix Money/Supply Missing from Sidebar
## For Claude Code | KaiSync Workforce App

---

## ROOT CAUSE

In `src/lib/company-modules.ts`, line ~322:
```typescript
finance: financeEntitled && payroll,
```

The `finance` flag requires BOTH the `module.finance` SaaS feature AND the Payroll module to be enabled. If either is false, every Money and Supply sidebar item disappears — Quotes, Invoices, Price Catalogue, Credit Notes, RFQs, Purchase Orders, Goods Received, Supplier Invoices all hidden.

The commercial engine (Phases 1–6) is a separate feature that should never be gated behind Payroll.

---

## THE FIX — 2 FILES

### File 1: `src/lib/company-modules.ts`

**Step A — Add `commercial` to the `HrNavFlags` type:**

```typescript
export type HrNavFlags = {
  // ... existing flags unchanged ...
  finance: boolean
  commercial: boolean   // ← ADD THIS
}
```

**Step B — Set `commercial` in `resolveHrNavFlags`:**

```typescript
return {
  // ... all existing flags unchanged ...
  finance: financeEntitled && payroll,   // ← keep as-is (old payroll finance page)
  commercial: true,                       // ← ADD: always visible for company users
}
```

`commercial: true` means it shows for any logged-in company user. The individual pages already gate by `quotes.view` / `invoices.view` permissions — the sidebar flag just needs to stop hiding the entries entirely.

---

### File 2: `src/components/Sidebar.tsx`

Change `flag: 'finance'` → `flag: 'commercial'` on the commercial items only.

**Keep `flag: 'finance'`** on (line ~84):
```typescript
{ label: 'Finance', href: '/dashboard/finance', icon: 'account_balance', flag: 'finance' },
```

**Change to `flag: 'commercial'`** on all of these:
```typescript
{ label: 'Quotes',          href: '/dashboard/money/quotes',               icon: 'request_quote',   flag: 'commercial' },
{ label: 'Price Catalogue', href: '/dashboard/money/catalogue',             icon: 'sell',            flag: 'commercial' },
{ label: 'Invoices',        href: '/dashboard/money/invoices',              icon: 'receipt_long',    flag: 'commercial' },
{ label: 'Credit Notes',    href: '/dashboard/money/credit-notes',          icon: 'undo',            flag: 'commercial' },
// Supply section:
{ label: 'Suppliers',       href: '/dashboard/supply/suppliers',            icon: 'storefront',      flag: 'commercial' },
{ label: 'RFQs',            href: '/dashboard/supply/rfqs',                 icon: 'request_quote',   flag: 'commercial' },
{ label: 'Purchase Orders', href: '/dashboard/supply/purchase-orders',      icon: 'shopping_cart',   flag: 'commercial' },
{ label: 'Goods Received',  href: '/dashboard/supply/goods-received',       icon: 'local_shipping',  flag: 'commercial' },
{ label: 'Supplier Invoices', href: '/dashboard/finance/supplier-invoices', icon: 'receipt',         flag: 'commercial' },
```

Also update `ALL_HR_FLAGS` constant (the fallback used before async flags resolve, around line ~131) to include `commercial: true`:
```typescript
const ALL_HR_FLAGS: HrNavFlags = {
  // ... existing ...
  finance: true,
  commercial: true,   // ← ADD
}
```

---

## WHAT DOES NOT CHANGE

- The old `Finance` link (`/dashboard/finance`) stays on `flag: 'finance'` — it's the payroll-related finance page
- `resolveHrNavFlags` logic for all other flags is untouched
- No migration, no DB changes
- Individual page-level permission checks (`quotes.view`, `invoices.view`) are untouched

---

## DELIVERABLES

- [ ] `HrNavFlags` type has `commercial: boolean`
- [ ] `resolveHrNavFlags` returns `commercial: true`
- [ ] `ALL_HR_FLAGS` has `commercial: true`
- [ ] 9 sidebar items switched from `flag: 'finance'` to `flag: 'commercial'`
- [ ] Money and Supply sections now visible for all company users
- [ ] `tsc --noEmit` — 0 errors
