# BRIEF — Add Commercial Tiles to Dashboard Overview
## For Claude Code | KaiSync Workforce App

---

## WHAT TO CHANGE

**File:** `kaisync-web/src/app/dashboard/overview/page.tsx`

No migration needed. Additive UI change only.

---

## 1. ADD COMMERCIAL KPI DATA TO `load()`

After resolving `companyId`, check permission and fetch commercial KPIs:

```typescript
// Inside load(), after companyId is resolved:
const { data: canViewQuotes } = await supabase.rpc('user_has_permission', {
  p_company_id: cid,
  p_key: 'quotes.view'
})

if (canViewQuotes) {
  // Open quotes: draft + sent
  const { count: openQuotes } = await supabase
    .from('commercial_quotes')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', cid)
    .in('status', ['draft', 'sent'])

  // Outstanding invoices total
  const { data: invData } = await supabase
    .from('finance_invoices')
    .select('balance_due')
    .eq('company_id', cid)
    .in('status', ['sent', 'partial'])
    .gt('balance_due', 0)

  const outstanding = invData?.reduce((s, i) => s + Number(i.balance_due), 0) ?? 0

  // Overdue count
  const { count: overdueCount } = await supabase
    .from('finance_invoices')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', cid)
    .in('status', ['sent', 'partial'])
    .gt('balance_due', 0)
    .lt('due_date', new Date().toISOString().split('T')[0])

  setCommercialKpi({
    openQuotes:   openQuotes ?? 0,
    outstanding:  outstanding,
    overdue:      overdueCount ?? 0,
  })
  setCanViewCommercial(true)
}
```

Add state at the top of the component:
```typescript
const [canViewCommercial, setCanViewCommercial] = useState(false)
const [commercialKpi, setCommercialKpi] = useState({
  openQuotes: 0,
  outstanding: 0,
  overdue: 0,
})
```

---

## 2. ADD COMMERCIAL TILES TO THE KPI GRID

The existing grid is `<div className="grid grid-cols-3 gap-3">` containing 6 `<KpiTile>` components.

Add 3 more tiles **after** the existing 6, conditionally:

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
      value={`R ${Math.round(commercialKpi.outstanding / 1000)}k`}
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
```

**Note:** `KpiTile` currently expects `value: number` — update its prop type to `value: number | string` to support the formatted currency string:

```typescript
function KpiTile({ icon, label, value, href, iconBg, iconColor }: {
  icon: string; label: string; value: number | string; href: string; iconBg: string; iconColor: string
}) {
```

---

## 3. ADD QUICK-ACTION BUTTONS

The existing quick-action buttons are near line 457–466:
```tsx
<button onClick={() => router.push('/dashboard/employees/new')}>
  + New Employee
</button>
<button onClick={() => router.push('/dashboard/jobs/new')}>
  + New Job
</button>
```

Add two more buttons **after** these, conditionally:

```tsx
{canViewCommercial && (
  <>
    <button
      onClick={() => router.push('/dashboard/money/quotes/new')}
      style={{ /* match existing button style */ }}
    >
      + New Quote
    </button>
    <button
      onClick={() => router.push('/dashboard/money/invoices/new')}
      style={{ /* match existing button style */ }}
    >
      + New Invoice
    </button>
  </>
)}
```

Match the exact inline styles of the existing "New Employee" / "New Job" buttons.

---

## 4. OUTSTANDING VALUE FORMATTING

For the "Outstanding" tile, format based on size:
- < R1,000 → "R {amount}"
- ≥ R1,000 → "R {n}k"  
- ≥ R1,000,000 → "R {n}M"

```typescript
function fmtShort(n: number): string {
  if (n >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `R ${Math.round(n / 1_000)}k`
  return `R ${Math.round(n)}`
}
// Use: value={fmtShort(commercialKpi.outstanding)}
```

---

## DELIVERABLES

- [ ] `canViewCommercial` state + permission check in `load()`
- [ ] 3 commercial KpiTiles added to grid (conditional on permission)
- [ ] `KpiTile` `value` prop updated to `number | string`
- [ ] "New Quote" + "New Invoice" quick-action buttons (conditional)
- [ ] `fmtShort` helper for currency display
- [ ] `tsc --noEmit` — 0 errors
