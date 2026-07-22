# MIS-2026-00014 — Remaining Medium and Low Gaps

**Mission ID:** MIS-2026-00014  
**Priority:** Medium / Low  
**Affects:** kaisync-web — multiple pages  
**Gap reference:** GAP-23 through GAP-52 (those not covered by MIS-00001 to MIS-00013)  

---

## Summary

This Mission covers all remaining medium and low priority gaps not addressed in the earlier Mission Briefs. These are secondary filters, sub-tabs, minor UI polish, and a few missing data connections.

---

## Grouped Changes

### Group A — Activity Log: Event type filter

**File:** `src/app/dashboard/activity-log/page.tsx`

Add a filter above the timeline:
```typescript
type ActivityFilter = 'all' | 'punches' | 'incidents' | 'leave'
const [filter, setFilter] = useState<ActivityFilter>('all')
```

Render as pill chips: All / Punches / Incidents / Leave  
Filter the combined activity array by event type before rendering.

---

### Group B — Incidents: Severity filter

**File:** `src/app/dashboard/incidents/page.tsx`

Add severity filter:
```typescript
type SeverityFilter = 'all' | 'low' | 'medium' | 'high' | 'critical'
const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
```

Add to the existing filter toolbar. Filter by `incident.severity` in the client-side filter function.

---

### Group C — Contractors: Activity sub-tab + count badges

**File:** `src/app/dashboard/contractors/page.tsx`

Add a sub-tab toggle: Contractors | Activity

For the Activity sub-tab, call `get_contractor_activity_feed(p_company_id, p_contractor_id, p_limit)` — verify this RPC exists first. If it doesn't exist, show an empty state with "Activity feed coming soon."

For action centre count badges, add these to the Action Centre header:
```tsx
{pendingQuotesCount > 0 && <span className="badge-warning">{pendingQuotesCount} quotes</span>}
{pendingBankingCount > 0 && <span className="badge-error">{pendingBankingCount} banking</span>}
{expiringDocsCount > 0 && <span className="badge-warning">{expiringDocsCount} expiring</span>}
```

Calculate from existing `actionItems` array:
```typescript
const pendingQuotesCount = actionItems.filter(a => a.action_type === 'quote_pending').length
const pendingBankingCount = actionItems.filter(a => a.action_type === 'banking_pending').length
const expiringDocsCount = actionItems.filter(a => a.action_type === 'document_expiring').length
```

---

### Group D — Inventory: Low stock alerts

**File:** `src/app/dashboard/inventory/page.tsx`

Add a low stock banner above the inventory list:
```typescript
const lowStockItems = inventory.filter(item =>
  item.reorder_point != null &&
  (item.stock_quantity ?? 0) <= item.reorder_point
)
```

If `lowStockItems.length > 0`, render:
```tsx
<div className="bg-warning-dark border border-warning rounded-lg p-3 mb-3">
  <p className="text-[13px] font-semibold text-warning">
    ⚠ {lowStockItems.length} item{lowStockItems.length > 1 ? 's' : ''} below reorder point
  </p>
  {lowStockItems.map(item => (
    <p key={item.id} className="text-[12px] text-warning mt-1">
      {item.name} — {item.stock_quantity} remaining (reorder at {item.reorder_point})
    </p>
  ))}
</div>
```

Verify `reorder_point` and `stock_quantity` column names in `types/database.ts`.

---

### Group E — Employee Detail: Days Worked KPI + PayrollReadiness

**File:** `src/app/dashboard/employees/[id]/page.tsx`

Add "Days Worked" to the Overview tab KPI row:
```typescript
const daysWorked = new Set(
  punches
    .filter(p => p.punch_out != null)
    .map(p => p.punch_in.split('T')[0])
).size
```

Add as a fourth KPI tile next to Hours, Punches.

For PayrollReadiness — if `payroll_readiness` data is available from the employee record (check if a `payroll_readiness_info` view or computed column exists in `types/database.ts`), show a small warning banner:
```tsx
{employee.bank_account == null && (
  <div className="bg-warning-dark rounded-lg p-3 text-[12px] text-warning">
    ⚠ No banking details — payslip cannot be processed
  </div>
)}
```

---

### Group F — Jobs List: Export CSV

**File:** `src/app/dashboard/jobs/page.tsx`

Wire the existing Export button to a client-side CSV download of `filtered` jobs:
```typescript
function exportJobs() {
  const header = 'ID,Title,Client,Status,Priority,Start,End,Cost'
  const rows = filtered.map(j => [
    j.id.slice(0, 8).toUpperCase(),
    j.title,
    j.clients?.name ?? '',
    j.status,
    j.priority,
    j.scheduled_start ?? '',
    j.scheduled_end ?? '',
    j.estimated_cost ?? '',
  ].join(','))
  downloadCSV([header, ...rows].join('\n'), 'jobs_export.csv')
}
```

---

### Group G — Payroll Detail: Payslip PDF

**File:** `src/app/dashboard/payroll/[id]/page.tsx`

For MVP, implement a print-to-PDF approach rather than a generated PDF:
```typescript
function printPayslip() {
  window.print()
}
```

Add a `<button onClick={printPayslip}>Print / Save PDF</button>` button.

Add a print stylesheet to hide the sidebar and header, and only print the payslip card:
```css
@media print {
  [data-sidebar], [data-header] { display: none !important; }
  [data-payslip-content] { display: block !important; }
}
```

Add `data-payslip-content` attribute to the payslip detail container.

---

### Group H — Settings: Integrations placeholders

**File:** `src/app/dashboard/settings/page.tsx`

Replace the "Not connected" badges with a descriptive note:
```tsx
<p className="text-[12px] text-text-secondary">
  Payroll and accounting integrations are managed from the MAUI admin app.
  Web integration management coming in a future update.
</p>
```

This removes the confusing "Not connected" state without implying the feature exists.

---

## Database Impact

None. All changes are client-side only.

---

## Files to Change

| File | Changes |
|---|---|
| `src/app/dashboard/activity-log/page.tsx` | Event type filter |
| `src/app/dashboard/incidents/page.tsx` | Severity filter |
| `src/app/dashboard/contractors/page.tsx` | Activity sub-tab, count badges |
| `src/app/dashboard/inventory/page.tsx` | Low stock alert banner |
| `src/app/dashboard/employees/[id]/page.tsx` | Days worked KPI, payroll readiness warning |
| `src/app/dashboard/jobs/page.tsx` | Export CSV wired |
| `src/app/dashboard/payroll/[id]/page.tsx` | Print to PDF button |
| `src/app/dashboard/settings/page.tsx` | Integrations placeholder text |

---

## Acceptance Criteria

- [ ] Activity log filters by event type
- [ ] Incidents filter by severity
- [ ] Contractors action centre shows count badges
- [ ] Inventory shows low stock banner for items below reorder point
- [ ] Employee detail shows Days Worked KPI
- [ ] Jobs list Export downloads a CSV
- [ ] Payroll detail Print button triggers browser print dialog
- [ ] Settings integrations section has clear descriptive text
- [ ] No TypeScript errors

---

## Definition of Done

- All 8 file changes complete
- Tested with real data
- No TypeScript errors
