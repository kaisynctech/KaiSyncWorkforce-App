# BRIEF — Fix Money Section Visibility + Consolidate Under Money
## For Claude Code | KaiSync Workforce App

---

## ROOT CAUSE

In `src/lib/company-modules.ts`, line ~322:
```typescript
finance: financeEntitled && payroll,
```

The `finance` flag requires BOTH the `module.finance` SaaS feature AND the Payroll module. If either is off, every Money sidebar item disappears — Quotes, Invoices, Price Catalogue, Credit Notes, RFQs, Purchase Orders, Goods Received, Supplier Invoices all hidden.

---

## THE FIX — 2 FILES

### File 1: `src/lib/company-modules.ts`

**Add `commercial` to the `HrNavFlags` type:**

```typescript
export type HrNavFlags = {
  // ... existing flags unchanged ...
  finance: boolean
  commercial: boolean   // ← ADD
}
```

**Add `commercial` in `resolveHrNavFlags`:**

```typescript
return {
  // ... all existing unchanged ...
  finance: financeEntitled && payroll,   // keep as-is (payroll finance page)
  commercial: true,                       // always visible for company users
}
```

**Add `commercial` to `ALL_HR_FLAGS` (line ~131):**

```typescript
const ALL_HR_FLAGS: HrNavFlags = {
  // ... existing ...
  finance: true,
  commercial: true,   // ← ADD
}
```

---

### File 2: `src/components/Sidebar.tsx`

**Goal:** One unified Money section containing ALL commercial items. The separate Supply section is removed — its items move under Money.

#### Step 1 — Read the current sidebar structure first

Before editing, read the full sidebar nav array to understand the exact current shape: section labels, item order, icon names, href values.

#### Step 2 — Replace the Money section items

The Money section should contain, in this order:

```typescript
// ── MONEY ─────────────────────────────────────────────────────────
{ label: 'Quotes',            href: '/dashboard/money/quotes',                icon: 'request_quote',   flag: 'commercial' },
{ label: 'Invoices',          href: '/dashboard/money/invoices',               icon: 'receipt_long',    flag: 'commercial' },
{ label: 'Credit Notes',      href: '/dashboard/money/credit-notes',           icon: 'undo',            flag: 'commercial' },
{ label: 'Price Catalogue',   href: '/dashboard/money/catalogue',              icon: 'sell',            flag: 'commercial' },
// ── PROCUREMENT (under Money) ─────────────────────────────────────
{ label: 'RFQs',              href: '/dashboard/supply/rfqs',                  icon: 'compare_arrows',  flag: 'commercial' },
{ label: 'Purchase Orders',   href: '/dashboard/supply/purchase-orders',       icon: 'shopping_cart',   flag: 'commercial' },
{ label: 'Goods Received',    href: '/dashboard/supply/goods-received',        icon: 'local_shipping',  flag: 'commercial' },
{ label: 'Supplier Invoices', href: '/dashboard/finance/supplier-invoices',    icon: 'receipt',         flag: 'commercial' },
{ label: 'Suppliers',         href: '/dashboard/supply/suppliers',             icon: 'storefront',      flag: 'commercial' },
```

All nine items use `flag: 'commercial'`. The hrefs stay the same — only the sidebar grouping changes.

#### Step 3 — Remove the Supply section entirely

Delete the separate Supply section header and its items from the nav array. Everything is now under Money.

#### Step 4 — Keep Finance link unchanged

The old payroll Finance link keeps `flag: 'finance'`:
```typescript
{ label: 'Finance', href: '/dashboard/finance', icon: 'account_balance', flag: 'finance' },
```

---

## WHAT DOES NOT CHANGE

- All page routes/hrefs are unchanged
- `resolveHrNavFlags` logic for all other flags is untouched
- No migration, no DB changes
- Page-level permission checks (`quotes.view`, `invoices.view`, etc.) are untouched

---

## DELIVERABLES

- [ ] `HrNavFlags` type has `commercial: boolean`
- [ ] `resolveHrNavFlags` returns `commercial: true`
- [ ] `ALL_HR_FLAGS` has `commercial: true`
- [ ] All 9 commercial items are under the Money section with `flag: 'commercial'`
- [ ] Supply section removed from sidebar
- [ ] Old Finance link untouched (`flag: 'finance'`)
- [ ] `tsc --noEmit` — 0 errors
