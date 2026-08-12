# BRIEF — Add Commercial Tiles to Dashboard Overview
## For Claude Code | KaiSync Workforce App

---

## WHAT TO CHANGE

**File:** `kaisync-web/src/app/dashboard/overview/page.tsx`

No migration needed. Additive UI change only.

---

## 1. STATE

Add at the top of the component:

```typescript
const [canViewCommercial, setCanViewCommercial] = useState(false)
const [canViewProcurement, setCanViewProcurement] = useState(false)
const [commercialKpi, setCommercialKpi] = useState({
  openQuotes:    0,
  outstanding:   0,
  overdue:       0,
  openRfqs:      0,
  openPos:       0,
})
```

---

## 2. FETCH IN `load()`

After resolving `companyId` (`cid`), add:

```typescript
// ── COMMERCIAL PERMISSIONS ────────────────────────────────────────
const { data: canViewQuotes } = await supabase.rpc('user_has_permission', {
  p_company_id: cid,
  p_key: 'quotes.view'
})
const { data: canViewRfq } = await supabase.rpc('user_has_permission', {
  p_company_id: cid,
  p_key: 'rfq.view'
})
const { data: canViewPo } = await supabase.rpc('user_has_permission', {
  p_company_id: cid,
  p_key: 'purchase_orders.view'
})

if (canViewQuotes || canViewRfq || canViewPo) {
  const kpi = { openQuotes: 0, outstanding: 0, overdue: 0, openRfqs: 0, openPos: 0 }

  if (canViewQuotes) {
    // Open quotes: draft + sent
    const { count: openQuotes } = await supabase
      .from('commercial_quotes')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', cid)
      .in('status', ['draft', 'sent'])
    kpi.openQuotes = openQuotes ?? 0

    // Outstanding invoice total
    const { data: invData } = await supabase
      .from('finance_invoices')
      .select('balance_due')
      .eq('company_id', cid)
      .in('status', ['sent', 'partial'])
      .gt('balance_due', 0)
    kpi.outstanding = invData?.reduce((s, i) => s + Number(i.balance_due), 0) ?? 0

    // Overdue count
    const { count: overdueCount } = await supabase
      .from('finance_invoices')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', cid)
      .in('status', ['sent', 'partial'])
      .gt('balance_due', 0)
      .lt('due_date', new Date().toISOString().split('T')[0])
    kpi.overdue = overdueCount ?? 0

    setCanViewCommercial(true)
  }

  if (canViewRfq) {
    const { count: openRfqs } = await supabase
      .from('rfqs')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', cid)
      .in('status', ['draft', 'sent'])
    kpi.openRfqs = openRfqs ?? 0
  }

  if (canViewPo) {
    const { count: openPos } = await supabase
      .from('purchase_orders')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', cid)
      .in('status', ['draft', 'approved', 'sent', 'partially_received'])
    kpi.openPos = openPos ?? 0
    setCanViewProcurement(true)
  }

  setCommercialKpi(kpi)
}
```

---

## 3. KPI TILE GRID — ADD 5 COMMERCIAL TILES

The existing grid is `<div className="grid grid-cols-3 gap-3">` with 6 `<KpiTile>` components.

Add after the existing 6, conditionally:

```tsx
{canViewCommercial && (
  <>
    <KpiTile
      icon="request_quote"
      label="Open Quotes"
      value={commercialKpi.openQuotes}
      href="/dashboard/money/quotes"
      iconBg="#1e1b4b"
      iconColor="#a78bfa"
    />
    <KpiTile
      icon="receipt_long"
      label="Outstanding"
      value={fmtShort(commercialKpi.outstanding)}
      href="/dashboard/money/invoices"
      iconBg="#1c1917"
      iconColor="#fbbf24"
    />
    <KpiTile
      icon="warning_amber"
      label="Overdue"
      value={commercialKpi.overdue}
      href="/dashboard/money/invoices"
      iconBg="#3b0a0a"
      iconColor="#f87171"
    />
  </>
)}
{canViewRfq && (
  <KpiTile
    icon="compare_arrows"
    label="Open RFQs"
    value={commercialKpi.openRfqs}
    href="/dashboard/supply/rfqs"
    iconBg="#0c1a2e"
    iconColor="#60a5fa"
  />
)}
{canViewProcurement && (
  <KpiTile
    icon="shopping_cart"
    label="Open POs"
    value={commercialKpi.openPos}
    href="/dashboard/supply/purchase-orders"
    iconBg="#0f1f0f"
    iconColor="#4ade80"
  />
)}
```

**Note:** The `canViewRfq` boolean needs to be promoted to component state, same as `canViewProcurement`:
```typescript
const [canViewRfq, setCanViewRfq] = useState(false)
// set it in load() alongside setCanViewProcurement(true)
```

---

## 4. UPDATE `KpiTile` VALUE PROP

`KpiTile` currently expects `value: number`. Change to `value: number | string`.

```typescript
function KpiTile({ icon, label, value, href, iconBg, iconColor }: {
  icon: string; label: string; value: number | string; href: string; iconBg: string; iconColor: string
}) {
```

---

## 5. `fmtShort` HELPER

Add near the top of the file (outside the component):

```typescript
function fmtShort(n: number): string {
  if (n >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `R ${Math.round(n / 1_000)}k`
  return `R ${Math.round(n)}`
}
```

---

## 6. QUICK-ACTION BUTTONS

The existing quick-action buttons area (look for "New Employee" / "New Job" buttons) — add after them, conditionally:

```tsx
{canViewCommercial && (
  <>
    <button onClick={() => router.push('/dashboard/money/quotes/new')}
      style={{ /* match existing button style exactly */ }}>
      + New Quote
    </button>
    <button onClick={() => router.push('/dashboard/money/invoices/new')}
      style={{ /* match existing button style exactly */ }}>
      + New Invoice
    </button>
  </>
)}
{canViewRfq && (
  <button onClick={() => router.push('/dashboard/supply/rfqs/new')}
    style={{ /* match existing button style exactly */ }}>
    + New RFQ
  </button>
)}
{canViewProcurement && (
  <button onClick={() => router.push('/dashboard/supply/purchase-orders/new')}
    style={{ /* match existing button style exactly */ }}>
    + New PO
  </button>
)}
```

Match the exact inline styles / className of the existing "New Employee" / "New Job" buttons — copy them, do not guess.

---

## WHAT DOES NOT CHANGE

- Existing 6 KPI tiles untouched
- Existing employee/job quick-action buttons untouched
- No DB changes, no migration

---

## DELIVERABLES

- [ ] 5 new states: `canViewCommercial`, `canViewRfq`, `canViewProcurement`, `commercialKpi`, `fmtShort` helper
- [ ] `load()` fetches 5 KPIs behind permission checks
- [ ] 5 commercial KpiTiles added (Quotes, Outstanding, Overdue, RFQs, POs)
- [ ] `KpiTile` `value` prop updated to `number | string`
- [ ] 4 quick-action buttons added (New Quote, New Invoice, New RFQ, New PO)
- [ ] `tsc --noEmit` — 0 errors
